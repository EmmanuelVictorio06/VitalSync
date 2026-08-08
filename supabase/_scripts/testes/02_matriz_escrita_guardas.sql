-- ============================================================================
-- Matriz de ESCRITA + guardas internas de RPC (Seções 2.2 e 2.3).
--
-- O que se prova aqui é o BLOQUEIO, não o sucesso. Atenção à diferença de
-- comportamento (armadilha nº 2 do plano):
--   • UPDATE/INSERT barrado por RLS → 0 linhas afetadas OU erro 42501;
--   • RPC `security definer` barrada → EXCEÇÃO com mensagem.
-- Cada asserção diz qual dos dois espera.
--
-- Transação única com ROLLBACK. Saída: PASS/FAIL; avalie com grep -c FAIL.
-- ============================================================================
begin;

create temp table _ids on commit drop as select email, id::text as id from public.profiles;
grant select on _ids to public;
create temp table _alvo on commit drop as
  select (select a.id from public.clinical_alerts a join public.patients p on p.id=a.patient_id
           where p.name <> 'Paciente EquipeTres' and a.status='YELLOW' limit 1) as alerta_amarelo,
         (select p.id from public.patients p where p.name <> 'Paciente EquipeTres' limit 1) as paciente_eq1;
grant select on _alvo to public;

create function pg_temp.chk(cond boolean, nome text) returns text language sql as
$$ select case when cond then 'PASS  '||nome else 'FAIL  '||nome end $$;
create function pg_temp.entrar(p_email text) returns void language sql as
$$ select set_config('request.jwt.claims',
     json_build_object('sub', (select id from _ids where email = p_email), 'role', 'authenticated')::text, true) $$;

-- ---------------- E01: UPDATE direto em clinical_alerts (associado) ----------
-- O frontend nunca escreve direto; a RLS precisa devolver 0 linhas afetadas.
set local role authenticated;
select pg_temp.entrar('medico@vitalsync.com');
do $$
declare n int;
begin
  update public.clinical_alerts set description = 'ADULTERADO' where true;
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  E01 update direto em clinical_alerts afeta 0 linhas (RLS)';
  else raise notice 'FAIL  E01 update direto AFETOU % linha(s) — frontend poderia adulterar alerta', n;
  end if;
exception when insufficient_privilege then
  raise notice 'PASS  E01 update direto em clinical_alerts rejeitado com 42501';
end $$;

-- ---------------- E02: escalonamento do próprio role/status (regressão 0073) --
do $$
declare v_role text; v_status text;
begin
  update public.profiles set role = 'ADMIN', status = 'INACTIVE'
   where id::text = (select id from _ids where email='medico@vitalsync.com');
  select role::text, status::text into v_role, v_status
    from public.profiles where id::text = (select id from _ids where email='medico@vitalsync.com');
  if v_role = 'ASSOCIATED_DOCTOR' and v_status = 'ACTIVE'
    then raise notice 'PASS  E02 role/status próprios revertidos pelo trigger (sem escalonamento)';
    else raise notice 'FAIL  E02 BRECHA: role=% status=%', v_role, v_status;
  end if;
end $$;

-- ---------------- E03: profiles_public é só do trigger ----------------------
do $$
begin
  insert into public.profiles_public (id, name) values (gen_random_uuid(), 'intruso');
  raise notice 'FAIL  E03 cliente conseguiu escrever em profiles_public';
exception when others then
  raise notice 'PASS  E03 escrita de cliente em profiles_public rejeitada (%)', sqlstate;
end $$;
reset role;

-- ---------------- E04/E05: anon não escreve em tabelas clínicas -------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  insert into public.patients (name, team_id) values ('hacker', (select id from public.medical_teams limit 1));
  raise notice 'FAIL  E04 anon inseriu paciente';
exception when others then
  raise notice 'PASS  E04 anon barrado em patients (%)', sqlstate;
end $$;
do $$
begin
  insert into public.vital_sign_records (patient_id, period) values ((select paciente_eq1 from _alvo), 'MORNING');
  raise notice 'FAIL  E05 anon inseriu medição';
exception when others then
  raise notice 'PASS  E05 anon barrado em vital_sign_records (%)', sqlstate;
end $$;
reset role;

-- ---------------- G01: TEAM_MANAGER é read-only nas ações de alerta ----------
set local role authenticated;
select pg_temp.entrar('gerente@vitalsync.com');
do $$
begin
  perform public.alert_set_in_analysis((select alerta_amarelo from _alvo));
  raise notice 'FAIL  G01 gerente conseguiu agir sobre alerta';
exception when others then
  if sqlerrm = 'MANAGER_READ_ONLY'
    then raise notice 'PASS  G01 gerente bloqueado com MANAGER_READ_ONLY';
    else raise notice 'FAIL  G01 gerente bloqueado, mas com erro inesperado: %', sqlerrm;
  end if;
end $$;
reset role;

-- ---------------- G02: SUPORTE não age em alerta ----------------------------
set local role authenticated;
select pg_temp.entrar('suporte@vitalsync.com');
do $$
begin
  perform public.alert_set_in_analysis((select alerta_amarelo from _alvo));
  raise notice 'FAIL  G02 suporte conseguiu agir sobre alerta';
exception when others then
  raise notice 'PASS  G02 suporte bloqueado (%)', sqlerrm;
end $$;
-- G03: suporte não lança medição pela equipe
do $$
begin
  perform public.staff_insert_vital_record((select paciente_eq1 from _alvo), 'MORNING', 36.5, 98);
  raise notice 'FAIL  G03 suporte lançou medição';
exception when others then
  raise notice 'PASS  G03 suporte barrado em staff_insert_vital_record (%)', sqlerrm;
end $$;
-- G04: suporte não abre plantão de enfermagem
do $$
begin
  perform public.nurse_open_shift();
  raise notice 'FAIL  G04 suporte abriu plantão';
exception when others then
  raise notice 'PASS  G04 suporte barrado em nurse_open_shift (%)', sqlerrm;
end $$;
reset role;

-- ---------------- G05: cirurgião de OUTRA equipe não age no alerta ----------
set local role authenticated;
select pg_temp.entrar('cirurgiao2@vitalsync.com');
do $$
begin
  perform public.alert_set_in_analysis((select alerta_amarelo from _alvo));
  raise notice 'FAIL  G05 cirurgião2 agiu em alerta de equipe alheia';
exception when others then
  raise notice 'PASS  G05 cirurgião2 barrado em alerta de equipe alheia (%)', sqlerrm;
end $$;
-- G06: nem apaga paciente de equipe alheia
do $$
begin
  perform public.soft_delete_patient((select paciente_eq1 from _alvo));
  raise notice 'FAIL  G06 cirurgião2 excluiu paciente alheio';
exception when others then
  raise notice 'PASS  G06 cirurgião2 barrado em soft_delete de paciente alheio (%)', sqlerrm;
end $$;
reset role;

-- ---------------- G07: RPCs administrativas exigem admin --------------------
set local role authenticated;
select pg_temp.entrar('medico@vitalsync.com');
do $$
begin
  perform public.homologation_set_mode(true);
  raise notice 'FAIL  G07 não-admin ligou o modo homologação';
exception when others then
  raise notice 'PASS  G07 homologation_set_mode exige admin (%)', sqlerrm;
end $$;
reset role;

rollback;

-- ---------------- G08: varredura de grants (armadilha da 0022) ---------------
-- Nenhuma função administrativa/de escrita clínica pode ser EXECUTÁVEL por anon.
select case when count(*) = 0
  then 'PASS  G08 anon não executa nenhuma RPC administrativa/clínica'
  else 'FAIL  G08 anon pode executar: '||string_agg(proname, ', ')
end
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'admin_clear_test_data','admin_delete_user','admin_get_users_overview','admin_link_team_manager',
    'admin_set_user_password','admin_unlink_team_manager','admin_update_user_email',
    'alert_escalate_to_red','alert_ignore','alert_mark_attended','alert_register_contact',
    'alert_release_analysis','alert_resend_notification','alert_set_in_analysis','alert_update_observation',
    'create_professional_invite','homologation_set_mode','homologation_set_recipients','homologation_stats',
    'nurse_claim_alert','nurse_close_shift','nurse_decline_alert','nurse_my_shift','nurse_open_shift',
    'nurse_pause_shift','nurse_resume_shift','soft_delete_patient','staff_insert_vital_record',
    'surgeon_create_team','get_patient_by_token','submit_vital_record',
    'release_stale_alert_locks','reoffer_expired_alerts','offer_yellow_alert',
    'enqueue_missed_measurement_alerts','retry_failed_notifications','alarm_exhausted_notifications'
  )
  and has_function_privilege('anon', p.oid, 'EXECUTE');
