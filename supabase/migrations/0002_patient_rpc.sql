-- ============================================================================
-- VitalSync — Fluxo do PACIENTE (anônimo, via secure_token)
--
-- O paciente não faz login. Em vez de Edge Functions (que exigem CLI/Docker),
-- usamos funções RPC SECURITY DEFINER: validam o token e operam com privilégio,
-- expondo SÓ o necessário ao papel `anon`. Rode no SQL Editor após o 0001.
-- ============================================================================

-- Dados públicos do paciente a partir do token (para abrir a tela de registro).
create or replace function public.get_patient_by_token(p_token text)
returns table (
  id uuid,
  name text,
  birth_date date,
  surgery_date date,
  hospital_discharge_date date,
  current_status public.clinical_status,
  monitoring_day int,
  within_window boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.name, p.birth_date, p.surgery_date, p.hospital_discharge_date, p.current_status,
    case when p.hospital_discharge_date is not null
         then greatest(1, (current_date - p.hospital_discharge_date) + 1) end as monitoring_day,
    (p.status = 'ACTIVE'
       and p.hospital_discharge_date is not null
       and current_date <= p.hospital_discharge_date + 10) as within_window
  from public.patients p
  where p.secure_token = p_token and p.status = 'ACTIVE';
$$;

-- Envio da medição: valida o token, calcula o status, grava e cria o alerta.
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
  p_wound_photo_path  text    default null
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
    urination_count, vomiting_count, has_bleeding, steps, wound_photo_path, clinical_status
  ) values (
    v_patient.id, p_period::public.measurement_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_vomiting_count, coalesce(p_has_bleeding, false), p_steps, p_wound_photo_path, v_status
  )
  on conflict (patient_id, record_date, period) do update set
    temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
    systolic_pressure = excluded.systolic_pressure, diastolic_pressure = excluded.diastolic_pressure,
    heart_rate = excluded.heart_rate, pain_level = excluded.pain_level, dyspnea_level = excluded.dyspnea_level,
    urination_count = excluded.urination_count, vomiting_count = excluded.vomiting_count,
    has_bleeding = excluded.has_bleeding, steps = excluded.steps,
    wound_photo_path = coalesce(excluded.wound_photo_path, public.vital_sign_records.wound_photo_path),
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

-- Permite ao paciente anônimo chamar apenas estas duas funções.
grant execute on function public.get_patient_by_token(text) to anon, authenticated;
grant execute on function public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text) to anon, authenticated;

-- Storage: o paciente (anon) pode FAZER UPLOAD da foto (não pode LER).
-- Em produção, restringir o prefixo do path ao paciente do token.
drop policy if exists patient_photos_anon_write on storage.objects;
create policy patient_photos_anon_write on storage.objects for insert to anon
  with check (bucket_id = 'patient-photos');
