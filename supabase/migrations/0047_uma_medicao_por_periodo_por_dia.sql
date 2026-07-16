-- ============================================================================
-- VitalSync — Regra "uma medição por período por dia" no fluxo do paciente.
--
-- Antes: submit_vital_record fazia upsert incondicional (on conflict do update),
-- sobrescrevendo silenciosamente a medição anterior do mesmo período.
--
-- Agora: a RPC lê o toggle de admin `allowResendSamePeriod` (app_settings,
-- seção security) e, quando desligado (default), recusa um segundo envio no
-- mesmo período do dia com mensagem amigável — sem sobrescrever. Quando ligado,
-- o comportamento de upsert é mantido (paciente pode reenviar/corrigir).
--
-- O "dia" passa a ser calculado no fuso America/Sao_Paulo (não current_date
-- cru em UTC): o record_date é gravado explicitamente com o dia local, de modo
-- que a checagem de existência, a unique (patient_id, record_date, period) e a
-- medição da noite (21h–00h locais viravam "amanhã" em UTC) fiquem coerentes.
--
-- Assinatura inalterada (18 args) — create or replace preserva os grants.
-- Constraint unique e enum measurement_period NÃO mudam. Lógica clínica e de
-- alertas intacta — só a decisão insert-vs-erro foi envolvida em torno dela.
-- ============================================================================

create or replace function public.submit_vital_record(
  p_token             text,
  p_period            text,
  p_temperature       numeric  default null,
  p_oxygen_saturation int      default null,
  p_systolic          int      default null,
  p_diastolic         int      default null,
  p_heart_rate        int      default null,
  p_pain              int      default null,
  p_dyspnea           int      default null,
  p_urination_count   int      default null,
  p_vomiting_count    int      default null,
  p_has_bleeding      boolean  default false,
  p_steps             int      default null,
  p_wound_photo_path  text     default null,
  p_has_drain         boolean  default false,
  p_drain_photo_path  text     default null,
  p_urinated_normally boolean  default null,
  p_had_vomit         boolean  default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient      public.patients;
  v_status       public.clinical_status := 'GREEN';
  v_type         text := 'Sinais vitais';
  v_day          int;
  v_prev_steps   int;
  v_had_vomit    boolean;
  v_record_id    uuid;
  v_alert_id     uuid;
  v_period       public.measurement_period;
  -- "Hoje" no fuso do paciente (America/Sao_Paulo), não em UTC.
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_allow_resend boolean := false;
  v_msg_repetida text;
begin
  select * into v_patient from public.patients where secure_token = p_token and status = 'ACTIVE';
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  v_period := p_period::public.measurement_period;

  -- Toggle de admin: permite reenviar/corrigir no mesmo período? (default false)
  select coalesce((s.data ->> 'allowResendSamePeriod')::boolean, false)
    into v_allow_resend
    from public.app_settings s
   where s.section = 'security';
  v_allow_resend := coalesce(v_allow_resend, false);

  v_msg_repetida := case when v_period = 'MORNING'
    then 'A medição da manhã de hoje já foi registrada. A próxima medição é à noite, antes de dormir.'
    else 'A medição da noite de hoje já foi registrada. A próxima medição é amanhã de manhã, ao acordar.' end;

  -- Uma medição por período por dia (dia local): sem o toggle, recusa em vez
  -- de sobrescrever.
  if not v_allow_resend
     and exists (
       select 1 from public.vital_sign_records vsr
        where vsr.patient_id = v_patient.id
          and vsr.record_date = v_today
          and vsr.period = v_period
     )
  then
    raise exception '%', v_msg_repetida;
  end if;

  -- Vômito efetivo: usa o booleano; se ausente, infere da contagem (compat.).
  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  -- Passos do dia anterior (regra relativa): última medição com passos antes de
  -- hoje (dia local).
  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.record_date < v_today
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  -- Avaliação clínica única (PA fora — M-06).
  select s.status, s.vtype into v_status, v_type
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps
    ) s;

  -- monitoring_day coerente com @vitalsync/shared (1..10), no dia local. (M-07)
  v_day := case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (v_today - v_patient.hospital_discharge_date) + 1))
                else null end;

  if v_allow_resend then
    -- Toggle ligado: mantém o upsert (reenvio corrige a medição do período).
    insert into public.vital_sign_records (
      patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
      systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
      urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false)
    )
    on conflict (patient_id, record_date, period) do update set
      temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
      systolic_pressure = excluded.systolic_pressure, diastolic_pressure = excluded.diastolic_pressure,
      heart_rate = excluded.heart_rate, pain_level = excluded.pain_level, dyspnea_level = excluded.dyspnea_level,
      urination_count = excluded.urination_count, urinated_normally = excluded.urinated_normally,
      vomiting_count = excluded.vomiting_count, had_vomit = excluded.had_vomit,
      has_bleeding = excluded.has_bleeding, steps = excluded.steps,
      wound_photo_path = coalesce(excluded.wound_photo_path, public.vital_sign_records.wound_photo_path),
      has_drain = excluded.has_drain,
      drain_photo_path = case when excluded.has_drain
        then coalesce(excluded.drain_photo_path, public.vital_sign_records.drain_photo_path)
        else null end,
      clinical_status = excluded.clinical_status,
      is_test = excluded.is_test
    returning id into v_record_id;
  else
    -- Toggle desligado: insert puro. `do nothing` fecha a corrida entre a
    -- checagem acima e o insert (duplo-clique/duas abas): se outro envio chegou
    -- primeiro, nenhuma linha volta e recusamos com a mesma mensagem.
    insert into public.vital_sign_records (
      patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
      systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
      urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false)
    )
    on conflict (patient_id, record_date, period) do nothing
    returning id into v_record_id;

    if v_record_id is null then
      raise exception '%', v_msg_repetida;
    end if;
  end if;

  update public.patients set current_status = v_status where id = v_patient.id;

  -- GREEN nunca gera alerta. YELLOW/RED criam alerta com type + is_test e notificam.
  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false))
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  return v_status::text;
end;
$$;
