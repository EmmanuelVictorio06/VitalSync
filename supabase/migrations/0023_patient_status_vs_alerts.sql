-- ============================================================================
-- VitalSync — Fase 4 / C-07: current_status do paciente considera alertas ativos
--
-- PROBLEMA: current_status era sobrescrito pela ÚLTIMA medição. Manhã RED (gera
-- alerta) + noite GREEN → paciente vira GREEN mesmo com alerta pendente; some
-- dos filtros/listas críticas.
--
-- REGRA A (escolhida): current_status = PIOR entre
--   (status da última medição)  e  (pior alerta PENDENTE não atendido).
-- Resolvida no banco → todas as telas (dashboard, monitoramento, equipes) que
-- leem current_status ficam coerentes automaticamente, sem mudança de frontend.
--
-- Mecanismo:
--   • recompute_patient_status(uuid): recalcula e grava current_status.
--   • submit_vital_record: troca o "update ... = v_status" por recompute (após
--     criar o alerta), para o caso "medição GREEN + alerta antigo pendente".
--   • trigger em clinical_alerts (ao atender/ignorar) → recompute (normaliza
--     quando o alerta deixa de estar pendente). As RPCs de atendimento não mudam.
--   • backfill de todos os pacientes ativos.
--
-- "Não atendido" = clinical_alerts.attended = false (PENDING/IN_ANALYSIS),
-- consistente com as consultas existentes.
--
-- ADITIVA e IDEMPOTENTE. Rode no SQL Editor após o 0021.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Recalcula current_status = pior(última medição, pior alerta pendente).
-- ----------------------------------------------------------------------------
create or replace function public.recompute_patient_status(p_patient uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last  public.clinical_status;
  v_alert public.clinical_status;
  sev_last  int;
  sev_alert int;
  v_worst public.clinical_status;
begin
  -- status da última medição (GREEN se ainda não houver medição)
  select clinical_status into v_last
    from public.vital_sign_records
    where patient_id = p_patient
    order by record_date desc, period desc
    limit 1;
  v_last := coalesce(v_last, 'GREEN');

  -- pior status entre os alertas PENDENTES (não atendidos)
  select case
           when bool_or(status = 'RED')    then 'RED'
           when bool_or(status = 'YELLOW') then 'YELLOW'
           else 'GREEN'
         end
    into v_alert
    from public.clinical_alerts
    where patient_id = p_patient and attended = false;
  v_alert := coalesce(v_alert, 'GREEN');

  sev_last  := case v_last  when 'RED' then 2 when 'YELLOW' then 1 else 0 end;
  sev_alert := case v_alert when 'RED' then 2 when 'YELLOW' then 1 else 0 end;
  v_worst   := case greatest(sev_last, sev_alert) when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;

  update public.patients set current_status = v_worst where id = p_patient;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) submit_vital_record — usa recompute (em vez de gravar só a última medição).
--    Mesma assinatura do 0021; a única mudança é a atualização do status, que
--    passa a considerar alertas pendentes (inclusive o recém-criado).
-- ----------------------------------------------------------------------------
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
  v_patient    public.patients;
  v_status     public.clinical_status := 'GREEN';
  v_type       text := 'Sinais vitais';
  v_day        int;
  v_prev_steps int;
  v_had_vomit  boolean;
  v_record_id  uuid;
  v_alert_id   uuid;
begin
  select * into v_patient from public.patients where secure_token = p_token and status = 'ACTIVE';
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.record_date < current_date
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select s.status, s.vtype into v_status, v_type
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps
    ) s;

  v_day := case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (current_date - v_patient.hospital_discharge_date) + 1))
                else null end;

  insert into public.vital_sign_records (
    patient_id, period, monitoring_day, temperature, oxygen_saturation,
    systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
    urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
    wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test
  ) values (
    v_patient.id, p_period::public.measurement_period, v_day, p_temperature, p_oxygen_saturation,
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

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false))
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  -- C-07: status = pior entre última medição e alertas pendentes (inclui o novo).
  perform public.recompute_patient_status(v_patient.id);

  return v_status::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Trigger: ao ATENDER/IGNORAR um alerta (attended/attendance_status mudam),
--    recalcula o status do paciente — assim ele normaliza quando não há mais
--    alerta pendente. As RPCs de atendimento (0008) não precisam mudar.
-- ----------------------------------------------------------------------------
create or replace function public.trg_alert_recompute_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_patient_status(coalesce(NEW.patient_id, OLD.patient_id));
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_alert_recompute_status on public.clinical_alerts;
create trigger trg_alert_recompute_status
  after update of attended, attendance_status on public.clinical_alerts
  for each row execute function public.trg_alert_recompute_status();

-- ----------------------------------------------------------------------------
-- 4) Backfill: aplica a regra a todos os pacientes ativos já existentes.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.patients where deleted_at is null loop
    perform public.recompute_patient_status(r.id);
  end loop;
end $$;
