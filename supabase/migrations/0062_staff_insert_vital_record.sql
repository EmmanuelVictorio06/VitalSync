-- ============================================================================
-- Migration: 0062_staff_insert_vital_record
--
-- Permite que a EQUIPE (Profissional de Enfermagem, Cirurgião ou Médico
-- Associado — decisão confirmada com o Emmanuel; Gerente e Suporte ficam de
-- fora) registre, em nome do paciente, o período de HOJE que ele esqueceu de
-- enviar, depois que a janela de medição já fechou. Decisão confirmada: sem
-- lançamento retroativo de dias anteriores (só o dia corrente).
--
-- staff_insert_vital_record é uma ADAPTAÇÃO de submit_vital_record (0053) —
-- reaproveita TAL QUAL o cálculo de dia de monitoramento, o fechamento de
-- reaferição pendente, os lookups de v_prev_steps/v_prev_pain, a chamada a
-- eval_clinical_status (mesmos 15 args, mesma ordem — fonte única das regras
-- clínicas, não reimplementar) e a criação de clinical_alerts +
-- notify_team_of_alert quando o status não é GREEN.
--
-- Diferenças deliberadas em relação a submit_vital_record:
--   1) Autenticação por auth.uid() (não token de paciente) + checagem
--      explícita de papel — is_team_member() sozinho não distingue role, só
--      presença ativa na equipe.
--   2) Gate de janela fechada: só aceita o período se o horário atual
--      (America/Sao_Paulo) já passou do fim da janela (10:00/20:00).
--   3) Sem reenvio/overwrite: qualquer registro já existente para
--      (patient_id, record_date, period) bloqueia — isto é só para
--      preencher uma lacuna real, nunca para sobrescrever.
--   4) Sem fotos de ferida/dreno: o upload por token (Storage) não está
--      disponível para staff autenticado — ver docs/PONTOS_PENDENTES.md.
--   5) Grava source='STAFF' + entered_by_profile_id, e ao final resolve as
--      linhas pendentes de missed_measurement_logs (0060/0061) daquele
--      patient_id/period/hoje.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0061.
-- ============================================================================

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

  if not public.is_team_member(v_patient.team_id) then
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

  -- Encerra o esquecimento para TODOS os destinatários alertados deste
  -- patient_id/period/hoje. WhatsApp ainda PENDING vira CANCELLED; os já
  -- SENT permanecem como estavam (só resolved_at/resolved_by mudam).
  update public.missed_measurement_logs
     set resolved_at = now(),
         resolved_by = auth.uid(),
         status = case when status = 'PENDING' then 'CANCELLED' else status end
   where patient_id = p_patient_id
     and period = v_period
     and missed_date = v_today
     and resolved_at is null;

  return v_status::text;
end;
$$;

-- Função nova nasce com EXECUTE para PUBLIC por padrão (mesma armadilha
-- documentada na 0022 para submit_vital_record) — revoga explicitamente e
-- concede só para authenticated (staff logado; nada de anon/service_role
-- aqui, diferente do fluxo por token).
revoke execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, boolean, boolean, boolean, boolean, int, boolean
) from public;
revoke execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, boolean, boolean, boolean, boolean, int, boolean
) from anon;
grant execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, boolean, boolean, boolean, boolean, int, boolean
) to authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar, com um paciente/equipe de teste que tenha
-- um membro NURSING_PROFESSIONAL ativo):
--
--    -- antes do fechamento da janela (deve levantar exceção de janela aberta):
--    select public.staff_insert_vital_record('<patient_id>', 'MORNING', 36.5, 98);
--
--    -- depois do fechamento (deve gravar source='STAFF' e resolver
--    -- missed_measurement_logs, se houver linha pendente):
--    select source, entered_by_profile_id from public.vital_sign_records
--      where patient_id = '<patient_id>' order by created_at desc limit 1;
--    select status, resolved_at, resolved_by from public.missed_measurement_logs
--      where patient_id = '<patient_id>' order by created_at desc limit 1;
-- ----------------------------------------------------------------------------
