-- ============================================================================
-- Ciclo de vida do alerta (Seção 4) + triagem de enfermagem (Seção 5).
--
-- Transação única com ROLLBACK — cria os próprios alvos, envelhece timestamps
-- à mão (não dá para esperar o relógio) e chama as funções de cron por SQL.
-- Saída: PASS/FAIL via NOTICE; avalie com grep -c FAIL.
-- ============================================================================
begin;

create temp table _ids on commit drop as select email, id::text as id from public.profiles;
grant select on _ids to public;
create function pg_temp.entrar(p_email text) returns void language sql as
$$ select set_config('request.jwt.claims',
     json_build_object('sub', (select id from _ids where email = p_email), 'role', 'authenticated')::text, true) $$;

-- Alvos: um amarelo fresco (equipe 1) e o vermelho do seed.
create temp table _t on commit drop as
select
  (select p.id from public.patients p where p.name = 'Elena Ricci') as pac_amarelo,
  (select a.id from public.clinical_alerts a join public.patients p on p.id = a.patient_id
    where a.status = 'RED' limit 1) as alerta_red;
grant select on _t to public;

insert into public.clinical_alerts (patient_id, team_id, status, type, description)
select p.id, p.team_id, 'YELLOW', 'Temperatura', 'alvo de teste do ciclo'
from public.patients p where p.id = (select pac_amarelo from _t);

create temp table _a on commit drop as
select a.id as alerta from public.clinical_alerts a
 where a.description = 'alvo de teste do ciclo';
grant select on _a to public;

-- ---------------- C01: claim + idempotência do dono --------------------------
set local role authenticated;
select pg_temp.entrar('enfermagem@vitalsync.com');
do $$
declare n int;
begin
  perform public.alert_set_in_analysis((select alerta from _a));
  perform public.alert_set_in_analysis((select alerta from _a));  -- dono repete: sem erro, sem duplicar
  select count(*) into n from public.attendance_confirmations
   where alert_id = (select alerta from _a) and status = 'IN_ANALYSIS';
  if n = 1 then raise notice 'PASS  C01 claim ok e idempotente (1 evento IN_ANALYSIS, não %)', n;
  else raise notice 'FAIL  C01 timeline com % eventos IN_ANALYSIS', n; end if;
end $$;
reset role;

-- ---------------- C02: só o dono do lock finaliza ----------------------------
set local role authenticated;
select pg_temp.entrar('medico@vitalsync.com');
do $$
begin
  perform public.alert_mark_attended((select alerta from _a), null, 'tentativa de furar o lock');
  raise notice 'FAIL  C02 não-dono finalizou alerta travado';
exception when others then
  raise notice 'PASS  C02 lock respeitado: %', sqlerrm;
end $$;
reset role;

-- ---------------- C03: dono libera de volta à fila ---------------------------
set local role authenticated;
select pg_temp.entrar('enfermagem@vitalsync.com');
do $$
declare v text;
begin
  perform public.alert_release_analysis((select alerta from _a));
  select attendance_status into v from public.clinical_alerts where id = (select alerta from _a);
  if v = 'PENDING' then raise notice 'PASS  C03 release devolve à fila (PENDING)';
  else raise notice 'FAIL  C03 attendance=%', v; end if;
end $$;
reset role;

-- ---------------- C04: TTL do lock (0063) ------------------------------------
update public.clinical_alerts
   set attendance_status='IN_ANALYSIS',
       in_analysis_by=(select id::uuid from _ids where email='medico@vitalsync.com'),
       in_analysis_at=now() - interval '20 minutes'
 where id = (select alerta from _a);
do $$
declare n int; v text;
begin
  n := public.release_stale_alert_locks();
  select attendance_status into v from public.clinical_alerts where id = (select alerta from _a);
  if v = 'PENDING' and n >= 1 then raise notice 'PASS  C04 lock vencido (20min) liberado pelo TTL';
  else raise notice 'FAIL  C04 liberados=% attendance=%', n, v; end if;
end $$;

-- ---------------- C05–C06: escalonamento preserva a severidade ---------------
set local role authenticated;
select pg_temp.entrar('enfermagem@vitalsync.com');
do $$
declare v_status text; v_esc timestamptz; v_att text;
begin
  perform public.alert_escalate_to_red((select alerta from _a), 'Paciente com queixa persistente após contato.');
  select status::text, escalated_at, attendance_status into v_status, v_esc, v_att
    from public.clinical_alerts where id = (select alerta from _a);
  if v_status = 'YELLOW' and v_esc is not null and v_att = 'PENDING'
    then raise notice 'PASS  C05 escalado SEM alterar status (segue YELLOW; métricas do estudo intactas)';
    else raise notice 'FAIL  C05 status=% escalated=% attendance=%', v_status, v_esc, v_att; end if;
end $$;
do $$
begin
  perform public.alert_escalate_to_red((select alerta from _a), 'de novo');
  raise notice 'FAIL  C06 escalou duas vezes';
exception when others then
  raise notice 'PASS  C06 idempotente: %', sqlerrm;
end $$;

-- ---------------- C07–C09: vermelho é do médico ------------------------------
do $$
begin
  perform public.alert_escalate_to_red((select alerta_red from _t), 'tentativa');
  raise notice 'FAIL  C07 escalou um vermelho';
exception when others then
  raise notice 'PASS  C07 vermelho não é escalável: %', sqlerrm;
end $$;
do $$
begin
  perform public.alert_mark_attended((select alerta_red from _t), null, 'tentativa');
  raise notice 'FAIL  C08 enfermeira finalizou vermelho';
exception when others then
  raise notice 'PASS  C08 enfermeira bloqueada no vermelho: %', sqlerrm;
end $$;
do $$
declare n int;
begin
  perform public.alert_register_contact((select alerta_red from _t), 'Liguei; orientei ir ao PS.');
  select count(*) into n from public.attendance_confirmations
   where alert_id = (select alerta_red from _t) and status = 'CONTACT';
  if n = 1 then raise notice 'PASS  C09 contato registrado no vermelho sem finalizar';
  else raise notice 'FAIL  C09 eventos CONTACT=%', n; end if;
end $$;
reset role;

-- ---------------- C10: médico segue finalizando vermelho ---------------------
set local role authenticated;
select pg_temp.entrar('medico@vitalsync.com');
do $$
declare v text;
begin
  perform public.alert_mark_attended((select alerta_red from _t), null, 'Paciente avaliado por telemedicina.');
  select attendance_status into v from public.clinical_alerts where id = (select alerta_red from _t);
  if v = 'ATTENDED' then raise notice 'PASS  C10 médico da equipe finaliza vermelho normalmente';
  else raise notice 'FAIL  C10 attendance=%', v; end if;
end $$;
reset role;

-- ---------------- C11–C12: reaferição 2h + unicidade por período -------------
update public.clinical_alerts
   set recheck_due_at = now() + interval '2 hours', recheck_completed_at = null
 where id = (select alerta from _a);
do $$
declare v_token text; v_done timestamptz;
begin
  select secure_token into v_token from public.patients where id = (select pac_amarelo from _t);
  perform public.submit_vital_record(v_token, 'NIGHT', 36.5, 98, 120, 80, 80, 0, 0, 4, 0, false, 2000);
  select recheck_completed_at into v_done from public.clinical_alerts where id = (select alerta from _a);
  if v_done is not null then raise notice 'PASS  C11 nova medição fecha a reaferição pendente';
  else raise notice 'FAIL  C11 recheck_completed_at continua nulo'; end if;

  begin
    perform public.submit_vital_record(v_token, 'NIGHT', 36.6, 98, 120, 80, 80, 0, 0, 4, 0, false, 2000);
    raise notice 'FAIL  C12 segunda medição do mesmo período foi aceita';
  exception when others then
    raise notice 'PASS  C12 repetição do período recusada (0047): %', sqlerrm;
  end;
end $$;

-- ---------------- C13–C16: oferta, expiração e disputa -----------------------
update public.app_settings set data = data || '{"autoRouting": true}'::jsonb where section = 'nursing';

insert into public.clinical_alerts (patient_id, team_id, status, type, description)
select p.id, p.team_id, 'YELLOW', 'Dor', 'alvo de oferta'
from public.patients p where p.name = 'Beatriz Silva';
create temp table _o on commit drop as
select a.id as alerta from public.clinical_alerts a where a.description = 'alvo de oferta';
grant select on _o to public;

do $$
declare v uuid;
begin
  select assigned_nurse_id into v from public.clinical_alerts where id = (select alerta from _o);
  if v = (select id::uuid from _ids where email='enfermagem@vitalsync.com')
    then raise notice 'PASS  C13 amarelo novo já OFERTADO à única enfermeira livre (trigger + flag)';
    else raise notice 'FAIL  C13 assigned=%', coalesce(v::text,'ninguém'); end if;
end $$;

set local role authenticated;
select pg_temp.entrar('enfermagem2@vitalsync.com');
do $$
begin
  perform public.nurse_claim_alert((select alerta from _o));
  raise notice 'FAIL  C14 segunda enfermeira atropelou oferta vigente de outra';
exception when others then
  raise notice 'PASS  C14 oferta vigente respeitada: %', sqlerrm;
end $$;
reset role;

update public.clinical_alerts set offer_expires_at = now() - interval '1 minute'
 where id = (select alerta from _o);
do $$
declare n int; temoferta boolean;
begin
  n := public.reoffer_expired_alerts();
  select exists (select 1 from public.attendance_confirmations
                  where alert_id = (select alerta from _o) and status = 'OFFER_EXPIRED') into temoferta;
  if temoferta then raise notice 'PASS  C15 oferta vencida registrada e alerta devolvido/reofertado (nunca some)';
  else raise notice 'FAIL  C15 sem evento OFFER_EXPIRED'; end if;
end $$;

-- Limpeza como postgres: um UPDATE como authenticated afetaria 0 linhas (RLS)
-- e deixaria a re-oferta do C15 vigente — foi o que o 1º run deste script provou.
update public.clinical_alerts set assigned_nurse_id = null, offer_expires_at = null
 where id = (select alerta from _o);

set local role authenticated;
select pg_temp.entrar('enfermagem2@vitalsync.com');
do $$
declare v uuid;
begin
  perform public.nurse_claim_alert((select alerta from _o));
  select in_analysis_by into v from public.clinical_alerts where id = (select alerta from _o);
  if v = (select id::uuid from _ids where email='enfermagem2@vitalsync.com')
    then raise notice 'PASS  C16 fila aberta: qualquer enfermeira do pool assume e trava';
    else raise notice 'FAIL  C16 lock=%', v; end if;
exception when others then
  raise notice 'FAIL  C16 claim da fila aberta falhou: %', sqlerrm;
end $$;
reset role;

-- ---------------- C17–C19: WIP, SLA e escalonamento automático ---------------
update public.app_settings set data = data || '{"wipLimit": 0}'::jsonb where section = 'nursing';
insert into public.clinical_alerts (patient_id, team_id, status, type, description)
select p.id, p.team_id, 'YELLOW', 'Dor', 'alvo de sla'
from public.patients p where p.name = 'Julian Bass';
create temp table _s on commit drop as
select a.id as alerta from public.clinical_alerts a where a.description = 'alvo de sla';
grant select on _s to public;

do $$
declare v uuid;
begin
  select assigned_nurse_id into v from public.clinical_alerts where id = (select alerta from _s);
  if v is null then raise notice 'PASS  C17 com WIP=0 ninguém está livre → fila aberta (sem oferta)';
  else raise notice 'FAIL  C17 ofertado a % mesmo com WIP 0', v; end if;
end $$;

update public.clinical_alerts set created_at = now() - interval '2 hours' where id = (select alerta from _s);
do $$
declare v timestamptz;
begin
  perform public.reoffer_expired_alerts();
  select sla_breached_at into v from public.clinical_alerts where id = (select alerta from _s);
  if v is not null then raise notice 'PASS  C18 SLA de fila marcado (2h em aberto com plantão ativo)';
  else raise notice 'FAIL  C18 sla_breached_at nulo'; end if;
end $$;

update public.clinical_alerts set created_at = now() - interval '9 hours' where id = (select alerta from _s);
do $$
declare v_status text; v_auto boolean; v_por uuid;
begin
  perform public.reoffer_expired_alerts();
  select status::text, auto_escalated, escalated_by into v_status, v_auto, v_por
    from public.clinical_alerts where id = (select alerta from _s);
  if v_status = 'YELLOW' and v_auto and v_por is null
    then raise notice 'PASS  C19 SLA máximo: escalou SOZINHO (status segue YELLOW; autor = sistema)';
    else raise notice 'FAIL  C19 status=% auto=% por=%', v_status, v_auto, v_por; end if;
end $$;

-- ---------------- C20–C21: medição esquecida — nunca em silêncio -------------
do $$
declare n1 int; n2 int;
begin
  set local role service_role;
  update public.profiles set status='INACTIVE' where email='cirurgiao2@vitalsync.com';
  reset role;
  update public.nurse_pools set is_active = false;

  n1 := public.enqueue_missed_measurement_alerts('MORNING');
  if exists (select 1 from public.missed_measurement_logs ml
              join public.patients p on p.id = ml.patient_id
             where p.name = 'Paciente EquipeTres' and ml.status = 'NO_RECIPIENT')
    then raise notice 'PASS  C20 sem pool e sem equipe → NO_RECIPIENT explícito (nunca silêncio)';
    else raise notice 'FAIL  C20 nenhum NO_RECIPIENT registrado'; end if;

  n2 := public.enqueue_missed_measurement_alerts('MORNING');
  if n2 = 0 then raise notice 'PASS  C21 enqueue idempotente no dia (segunda chamada = 0)';
  else raise notice 'FAIL  C21 segunda chamada enfileirou %', n2; end if;
end $$;

rollback;
