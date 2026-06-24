-- ============================================================================
-- VitalSync — Dreno + fotos de acompanhamento separadas
--
-- O paciente informa se possui dreno. A foto da CICATRIZ OPERATÓRIA continua em
-- vital_sign_records.wound_photo_path; a foto do DRENO ganha coluna própria.
-- Abordagem por colunas (simples) — espelha o fluxo RPC anônimo existente.
-- Rode no SQL Editor após o 0008.
-- ============================================================================

alter table public.vital_sign_records
  add column if not exists has_drain        boolean not null default false,
  add column if not exists drain_photo_path text;

-- Recria a RPC do paciente com os novos parâmetros (assinatura muda → drop antes).
drop function if exists public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text
);

create or replace function public.submit_vital_record(
  p_token             text,
  p_period            text,
  p_temperature       numeric default null,
  p_oxygen_saturation int     default null,
  p_systolic          int     default null,
  p_diastolic         int     default null,
  p_heart_rate        int     default null,
  p_pain              int     default null,
  p_dyspnea           int     default null,
  p_urination_count   int     default null,
  p_vomiting_count    int     default null,
  p_has_bleeding      boolean default false,
  p_steps             int     default null,
  p_wound_photo_path  text    default null,
  p_has_drain         boolean default false,
  p_drain_photo_path  text    default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient public.patients;
  v_status  public.clinical_status := 'GREEN';
  v_day     int;
  v_record_id uuid;
begin
  select * into v_patient from public.patients where secure_token = p_token and status = 'ACTIVE';
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  -- Cálculo simplificado do status (espelha o frontend; ajuste fino no futuro).
  -- Obs.: a presença de dreno NÃO altera o status clínico nem gera alerta.
  if coalesce(p_temperature, 0) >= 38.5 or coalesce(p_oxygen_saturation, 100) < 92
     or coalesce(p_pain, 0) >= 8 or coalesce(p_has_bleeding, false) then
    v_status := 'RED';
  elsif coalesce(p_temperature, 0) >= 37.8 or coalesce(p_oxygen_saturation, 100) < 94
     or coalesce(p_pain, 0) >= 5 then
    v_status := 'YELLOW';
  end if;

  v_day := case when v_patient.hospital_discharge_date is not null
                then greatest(1, (current_date - v_patient.hospital_discharge_date) + 1) end;

  insert into public.vital_sign_records (
    patient_id, period, monitoring_day, temperature, oxygen_saturation,
    systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
    urination_count, vomiting_count, has_bleeding, steps, wound_photo_path,
    has_drain, drain_photo_path, clinical_status
  ) values (
    v_patient.id, p_period::public.measurement_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_vomiting_count, coalesce(p_has_bleeding, false), p_steps, p_wound_photo_path,
    coalesce(p_has_drain, false),
    -- Se não há dreno, nunca persiste caminho de foto do dreno.
    case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
    v_status
  )
  on conflict (patient_id, record_date, period) do update set
    temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
    systolic_pressure = excluded.systolic_pressure, diastolic_pressure = excluded.diastolic_pressure,
    heart_rate = excluded.heart_rate, pain_level = excluded.pain_level, dyspnea_level = excluded.dyspnea_level,
    urination_count = excluded.urination_count, vomiting_count = excluded.vomiting_count,
    has_bleeding = excluded.has_bleeding, steps = excluded.steps,
    wound_photo_path = coalesce(excluded.wound_photo_path, public.vital_sign_records.wound_photo_path),
    has_drain = excluded.has_drain,
    -- Mudou para "não possui dreno" → limpa a foto do dreno; senão preserva a anterior.
    drain_photo_path = case when excluded.has_drain
      then coalesce(excluded.drain_photo_path, public.vital_sign_records.drain_photo_path)
      else null end,
    clinical_status = excluded.clinical_status
  returning id into v_record_id;

  update public.patients set current_status = v_status where id = v_patient.id;

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, description)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status,
      case when v_status = 'RED' then 'Alerta vermelho: sinais vitais críticos.'
           else 'Atenção: sinais vitais limítrofes.' end);
    -- TODO (produção): invocar a Edge Function send-whatsapp-alert aqui.
  end if;

  return v_status::text;
end;
$$;

grant execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text
) to anon, authenticated;
