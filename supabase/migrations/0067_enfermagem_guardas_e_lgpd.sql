-- ============================================================================
-- Migration: 0067_enfermagem_guardas_e_lgpd  (Triagem de Enfermagem — Fase 1.4/1.5)
--
-- Três coisas, todas girando em torno das MESMAS RPCs (por isso numa migration
-- só — cada função é reescrita UMA vez, com todas as mudanças juntas):
--
--   A) ESCOPO DO POOL nas guardas internas. As políticas de RLS já foram
--      estendidas na 0066, mas as RPCs `security definer` IGNORAM RLS e
--      repetem a checagem no corpo (`is_admin() or is_team_member(...)`).
--      Sem esta migration, o enfermeiro do pool VÊ o alerta e não consegue
--      agir sobre ele. Reescritas: alert_set_in_analysis, alert_mark_attended,
--      alert_ignore, alert_release_analysis (bases 0044/0045) e
--      staff_insert_vital_record (base 0062).
--
--   B) RESTRIÇÃO "SÓ AMARELOS" — é MUDANÇA DE COMPORTAMENTO, não simplificação.
--      Até aqui, um enfermeiro membro de equipe podia finalizar qualquer alerta
--      (is_team_member não distingue role_in_team — ver 0054). Agora o
--      enfermeiro NÃO finaliza alertas RED: esses são do médico. Ele continua
--      podendo VER o vermelho (contexto clínico) e REGISTRAR CONTATO na
--      timeline (nova RPC `alert_register_contact`), sem finalizar.
--
--   C) LGPD — `patient_access_logs`. Ampliar o escopo (0066) remove a RLS por
--      equipe como controle técnico de minimização de acesso. A contrapartida
--      obrigatória é a trilha de QUEM LEU QUAL PACIENTE. Alimentada pelas RPCs
--      de triagem. Base legal: dado de saúde, art. 11 da LGPD — exige DPA com
--      o hospital (controlador). Ver docs/FLUXO_ENFERMAGEM.md.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0066.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Trilha de acesso a paciente (LGPD).
-- ----------------------------------------------------------------------------
create table if not exists public.patient_access_logs (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  context    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_access_logs_patient on public.patient_access_logs(patient_id, created_at desc);
create index if not exists idx_patient_access_logs_profile on public.patient_access_logs(profile_id, created_at desc);

comment on table public.patient_access_logs is
  'Trilha LGPD: quem acessou qual paciente e em que contexto. Contrapartida obrigatória da ampliação de escopo da 0066 (pool de enfermagem).';

alter table public.patient_access_logs enable row level security;

-- Só o Admin audita. O profissional NÃO apaga nem edita a própria trilha
-- (escrita exclusivamente via log_patient_access, SECURITY DEFINER).
drop policy if exists patient_access_logs_admin on public.patient_access_logs;
create policy patient_access_logs_admin on public.patient_access_logs for select to authenticated
  using (public.is_admin());

create or replace function public.log_patient_access(p_patient uuid, p_context text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_patient is null then return; end if;
  insert into public.patient_access_logs (profile_id, patient_id, context)
  values (auth.uid(), p_patient, coalesce(p_context, 'desconhecido'));
end;
$$;

grant execute on function public.log_patient_access(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Helpers das guardas — evitam repetir a mesma expressão em 5 funções.
-- ----------------------------------------------------------------------------

/** Acesso de escrita a um alerta: equipe, Admin ou enfermeiro do pool. */
create or replace function public.can_act_on_alert(p_team uuid, p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.is_team_member(p_team)
      or public.is_nurse_for_patient(p_patient);
$$;

/**
 * Bloqueia o enfermeiro de FINALIZAR alerta vermelho (§3.4). O Admin segue
 * como exceção administrativa; médicos não são afetados.
 */
create or replace function public.nurse_may_finalize(p_status public.clinical_status)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or not public.is_nurse(auth.uid())
      or p_status <> 'RED';
$$;

grant execute on function public.can_act_on_alert(uuid, uuid) to authenticated;
grant execute on function public.nurse_may_finalize(public.clinical_status) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) alert_set_in_analysis — base 0044 + escopo do pool + trilha LGPD.
--    O claim ATÔMICO (`update ... where in_analysis_by is null`) é preservado
--    exatamente: é ele que decide a corrida entre dois enfermeiros.
-- ----------------------------------------------------------------------------
create or replace function public.alert_set_in_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Idempotente: o dono do lock pode chamar de novo sem erro.
  if v_alert.in_analysis_by = auth.uid() then return; end if;

  -- Claim atômico: só trava se ninguém travou antes (corrida decidida pelo banco).
  update public.clinical_alerts
    set attendance_status = 'IN_ANALYSIS',
        in_analysis_by = auth.uid(),
        in_analysis_at = now(),
        updated_at = now()
    where id = p_alert and in_analysis_by is null;
  if not found then
    raise exception 'Alerta já está em análise por outro profissional.';
  end if;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IN_ANALYSIS', null);
  perform public.audit_alert_action('ALERT_IN_ANALYSIS', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta em análise');
end; $$;

-- ----------------------------------------------------------------------------
-- 4) alert_mark_attended — base 0045 + escopo do pool + bloqueio de vermelho.
-- ----------------------------------------------------------------------------
create or replace function public.alert_mark_attended(p_alert uuid, p_professional uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Descreva brevemente a conduta ou observação do atendimento.';
  end if;

  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;

  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- §3.4: vermelho é do médico da equipe.
  if not public.nurse_may_finalize(v_alert.status) then
    raise exception 'Alertas vermelhos são atendidos pelo médico da equipe. Registre o contato e, se precisar, avise a equipe.';
  end if;

  -- Trava de responsabilidade (0045): só o dono do lock (ou Admin) finaliza.
  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin() then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta. Libere-o de volta à fila para assumir o atendimento.';
  end if;

  if v_alert.attendance_status = 'ATTENDED' or v_alert.attended = true then
    raise exception 'Este alerta já foi atendido.';
  end if;

  if v_alert.attendance_status = 'IGNORED' then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'ATTENDED',
        attended = true,
        attended_by = coalesce(p_professional, auth.uid()),
        attended_at = now(),
        in_analysis_by = null,
        in_analysis_at = null,
        updated_at = now()
    where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, coalesce(p_professional, auth.uid()), 'ATTENDED', p_observation);

  perform public.audit_alert_action('ALERT_ATTENDED', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta atendido');
end; $$;

-- ----------------------------------------------------------------------------
-- 5) alert_ignore — base 0045 + escopo do pool + bloqueio de vermelho.
-- ----------------------------------------------------------------------------
create or replace function public.alert_ignore(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe a justificativa para ignorar o alerta.';
  end if;
  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  if not public.nurse_may_finalize(v_alert.status) then
    raise exception 'Alertas vermelhos são atendidos pelo médico da equipe. Registre o contato e, se precisar, avise a equipe.';
  end if;

  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin() then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta. Libere-o de volta à fila para assumir o atendimento.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'IGNORED', ignored_reason = p_reason,
        attended = true, attended_by = auth.uid(), attended_at = now(),
        in_analysis_by = null, in_analysis_at = null, updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IGNORED', p_reason);
  perform public.audit_alert_action('ALERT_IGNORED', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta ignorado');
end; $$;

-- ----------------------------------------------------------------------------
-- 6) alert_release_analysis — base 0044 + escopo do pool.
-- ----------------------------------------------------------------------------
create or replace function public.alert_release_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;
  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  if v_alert.attendance_status <> 'IN_ANALYSIS' or v_alert.in_analysis_by is null then
    raise exception 'Este alerta não está em análise.';
  end if;

  if v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin()
     and not public.is_main_surgeon_of(v_alert.team_id) then
    raise exception 'Somente o profissional que colocou em análise (ou Admin/Cirurgião Principal) pode liberar este alerta.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'PENDING',
        in_analysis_by = null,
        in_analysis_at = null,
        updated_at = now()
    where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'RELEASED', null);
  perform public.audit_alert_action('ALERT_RELEASED', v_alert.patient_id);
end; $$;

-- ----------------------------------------------------------------------------
-- 7) alert_register_contact — registra o contato ativo SEM finalizar o alerta.
--    É o que permite ao enfermeiro documentar a ligação num alerta VERMELHO
--    (que ele não pode fechar) e deixar o histórico pronto para o médico.
-- ----------------------------------------------------------------------------
create or replace function public.alert_register_contact(p_alert uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_note), '') = '' then
    raise exception 'Descreva o que foi conversado com o paciente.';
  end if;

  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  if v_alert.attendance_status in ('ATTENDED', 'IGNORED') then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  -- 'CONTACT' não entra em "Meus Atendimentos" (o serviço filtra ATTENDED/
  -- IGNORED) — aparece só na timeline, que é o objetivo.
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'CONTACT', p_note);

  perform public.audit_alert_action('ALERT_CONTACT', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: contato ativo com o paciente');
end; $$;

grant execute on function public.alert_register_contact(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) staff_insert_vital_record — base 0062, reescrita com UMA mudança:
--    a guarda de acesso passa a aceitar o enfermeiro do pool. Todo o resto
--    (gate de janela fechada, unicidade, eval_clinical_status, alertas) é
--    idêntico — a pipeline clínica não muda.
-- ----------------------------------------------------------------------------
create or replace function public.staff_insert_vital_record(
  p_patient_id           uuid,
  p_period               text,
  p_temperature          numeric  default null,
  p_oxygen_saturation    int      default null,
  p_systolic             int      default null,
  p_diastolic            int      default null,
  p_heart_rate           int      default null,
  p_pain                 int      default null,
  p_dyspnea              int      default null,
  p_urination_count      int      default null,
  p_vomiting_count       int      default null,
  p_has_bleeding         boolean  default false,
  p_steps                int      default null,
  p_has_drain            boolean  default false,
  p_urinated_normally    boolean  default null,
  p_had_vomit            boolean  default null,
  p_water_intake_ok      boolean  default null,
  p_drain_output_ml      int      default null,
  p_noticed_wound_change boolean  default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient      public.patients;
  v_actor_role   public.user_role;
  v_status       public.clinical_status := 'GREEN';
  v_type         text := 'Sinais vitais';
  v_yellow_count int;
  v_isolated     boolean;
  v_recheck_due  timestamptz;
  v_day          int;
  v_prev_steps   int;
  v_prev_pain    int;
  v_had_vomit    boolean;
  v_record_id    uuid;
  v_alert_id     uuid;
  v_period       public.measurement_period;
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time     time := (now() at time zone 'America/Sao_Paulo')::time;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select role into v_actor_role from public.profiles where id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR', 'NURSING_PROFESSIONAL') then
    raise exception 'Apenas cirurgião, médico associado ou profissional de enfermagem podem registrar medição em nome do paciente.';
  end if;

  select * into v_patient from public.patients where id = p_patient_id and status = 'ACTIVE';
  if not found then raise exception 'Paciente não encontrado ou inativo.'; end if;

  -- ÚNICA mudança em relação à 0062: o enfermeiro do pool também tem acesso.
  if not (public.is_team_member(v_patient.team_id) or public.is_nurse_for_patient(p_patient_id)) then
    raise exception 'Você não tem acesso a este paciente.';
  end if;

  v_period := p_period::public.measurement_period;

  if v_period = 'MORNING' and v_now_time < time '10:00' then
    raise exception 'A janela da manhã de hoje ainda está aberta — peça ao paciente para registrar diretamente.';
  elsif v_period = 'NIGHT' and v_now_time < time '20:00' then
    raise exception 'A janela da noite de hoje ainda está aberta — peça ao paciente para registrar diretamente.';
  end if;

  if exists (
    select 1 from public.vital_sign_records vsr
     where vsr.patient_id = p_patient_id
       and vsr.record_date = v_today
       and vsr.period = v_period
  ) then
    raise exception 'Este período já foi registrado.';
  end if;

  update public.clinical_alerts
     set recheck_completed_at = now()
   where patient_id = p_patient_id
     and recheck_due_at is not null
     and recheck_completed_at is null;

  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = p_patient_id
     and vsr.record_date <= v_today - 2
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select vsr.pain_level into v_prev_pain
    from public.vital_sign_records vsr
   where vsr.patient_id = p_patient_id
     and vsr.pain_level is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select s.status, s.vtype, s.yellow_count, s.isolated_by_steps_or_diuresis
    into v_status, v_type, v_yellow_count, v_isolated
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps, p_systolic, p_diastolic, p_water_intake_ok, v_prev_pain
    ) s;

  v_recheck_due := case when v_status = 'YELLOW' and v_yellow_count = 1 then now() + interval '2 hours' else null end;

  v_day := case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (v_today - v_patient.hospital_discharge_date) + 1))
                else null end;

  insert into public.vital_sign_records (
    patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
    systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
    urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
    has_drain, clinical_status, is_test, water_intake_ok, drain_output_ml,
    noticed_wound_change, source, entered_by_profile_id
  ) values (
    p_patient_id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
    coalesce(p_has_drain, false), v_status, coalesce(v_patient.is_test, false), p_water_intake_ok,
    case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
    p_noticed_wound_change, 'STAFF', auth.uid()
  )
  on conflict (patient_id, record_date, period) do nothing
  returning id into v_record_id;

  if v_record_id is null then
    raise exception 'Este período já foi registrado.';
  end if;

  update public.patients set current_status = v_status where id = p_patient_id;

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test, recheck_due_at)
    values (p_patient_id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false), v_recheck_due)
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  update public.missed_measurement_logs
     set resolved_at = now(),
         resolved_by = auth.uid(),
         status = case when status = 'PENDING' then 'CANCELLED' else status end
   where patient_id = p_patient_id
     and period = v_period
     and missed_date = v_today
     and resolved_at is null;

  perform public.log_patient_access(p_patient_id, 'lançamento de medição em nome do paciente');

  return v_status::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- cenário 9 do PR: enfermeiro tenta finalizar um vermelho → bloqueado.
--   select public.alert_mark_attended('<alerta RED>', null, 'tentativa');
--   --> ERRO: 'Alertas vermelhos são atendidos pelo médico da equipe...'
--
--   -- mas pode registrar contato no mesmo vermelho:
--   select public.alert_register_contact('<alerta RED>', 'Paciente orientado a procurar o PS.');
--   select status, observation from public.attendance_confirmations where alert_id = '<alerta RED>';
--
--   -- amarelo continua finalizável pelo enfermeiro do pool (sem ser da equipe):
--   select public.alert_set_in_analysis('<alerta YELLOW>');
--   select public.alert_mark_attended('<alerta YELLOW>', null, 'Contato feito, orientada hidratação.');
--
--   -- trilha LGPD registrada:
--   select context, created_at from public.patient_access_logs order by created_at desc limit 5;
-- ----------------------------------------------------------------------------
