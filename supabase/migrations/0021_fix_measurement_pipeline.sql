-- ============================================================================
-- VitalSync — Fase 2: pipeline medição → status → alerta (C-01 + C-02 + M-01 + M-07)
--
-- Consolida o banco numa única migration coerente:
--   • M-01: persiste os booleanos de diurese/vômito (sem ambiguidade);
--   • C-02: função ÚNICA de avaliação clínica eval_clinical_status() espelhando
--           packages/shared/src/clinical/thresholds.ts (PA EXCLUÍDA — M-06);
--   • C-01: UMA única submit_vital_record (elimina as duas sobrecargas), com
--           dreno + is_test + type + notify + os novos booleanos;
--   • M-07: monitoring_day limitado a 1..10 (coerente com @vitalsync/shared).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0020.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) M-01 — colunas booleanas não-ambíguas + backfill conservador.
-- ----------------------------------------------------------------------------
alter table public.vital_sign_records add column if not exists urinated_normally boolean;
alter table public.vital_sign_records add column if not exists had_vomit         boolean;

-- Backfill compatível: infere dos dados antigos sem alterar o comportamento do
-- histórico (mantém urination_count/vomiting_count como estão).
update public.vital_sign_records
   set urinated_normally = (urination_count is not null)
 where urinated_normally is null;
update public.vital_sign_records
   set had_vomit = (coalesce(vomiting_count, 0) > 0)
 where had_vomit is null;

comment on column public.vital_sign_records.urinated_normally is
  'Resposta Sim/Não de "urinou normalmente". A contagem (urination_count) é opcional.';
comment on column public.vital_sign_records.had_vomit is
  'Resposta Sim/Não de vômito. A contagem (vomiting_count) é opcional.';

-- ----------------------------------------------------------------------------
-- 2) C-02 — avaliação clínica ÚNICA, espelhando thresholds.ts.
--    Severidade auxiliar: -1 não avaliado, 0 GREEN, 1 YELLOW, 2 RED.
--    PRESSÃO ARTERIAL fica de fora do disparo. -- PENDENTE VALIDAÇÃO MÉDICA (M-06)
-- ----------------------------------------------------------------------------
create or replace function public.eval_clinical_status(
  p_temperature       numeric,
  p_oxygen_saturation int,
  p_heart_rate        int,
  p_pain              int,
  p_dyspnea           int,
  p_urinated_normally boolean,
  p_urination_count   int,
  p_had_vomit         boolean,
  p_has_bleeding      boolean,
  p_steps             int,
  p_prev_steps        int
) returns table(status public.clinical_status, vtype text)
language plpgsql immutable set search_path = public as $$
declare
  v_sev int;
  -- Temperatura: GREEN <37,8 · YELLOW 37,8–38,4 · RED ≥38,5
  s_temp int := case when p_temperature is null then -1
                     when p_temperature >= 38.5 then 2
                     when p_temperature >= 37.8 then 1 else 0 end;
  -- Saturação: GREEN >94 · YELLOW 92,1–94 · RED ≤92
  s_spo2 int := case when p_oxygen_saturation is null then -1
                     when p_oxygen_saturation <= 92 then 2
                     when p_oxygen_saturation <= 94 then 1 else 0 end;
  -- Frequência cardíaca: GREEN ≤110 · YELLOW 111–119 · RED ≥120
  s_hr   int := case when p_heart_rate is null then -1
                     when p_heart_rate >= 120 then 2
                     when p_heart_rate >= 111 then 1 else 0 end;
  -- Dispneia: GREEN 0 · YELLOW 1–5 · RED ≥6
  s_dysp int := case when p_dyspnea is null then -1
                     when p_dyspnea >= 6 then 2
                     when p_dyspnea >= 1 then 1 else 0 end;
  -- Vômito / Sangramento: Sim → RED
  s_vom   int := case when p_had_vomit    is true then 2 else 0 end;
  s_bleed int := case when p_has_bleeding is true then 2 else 0 end;
  -- Dor: GREEN 0–6 · YELLOW 7–8 · RED ≥9
  s_pain int := case when p_pain is null then -1
                     when p_pain >= 9 then 2
                     when p_pain >= 7 then 1 else 0 end;
  -- Diurese: com contagem → ≤1 RED / 2–3 YELLOW / ≥4 GREEN; sem contagem →
  -- "urinou normalmente" true=GREEN, false=YELLOW.
  s_diur int := case
                  when p_urination_count is not null then
                       case when p_urination_count <= 1 then 2
                            when p_urination_count <= 3 then 1 else 0 end
                  when p_urinated_normally is not null then
                       case when p_urinated_normally then 0 else 1 end
                  else -1 end;
  -- Passos: queda ≥50% RED · ≥25% YELLOW (relativo ao dia anterior).
  s_step int := case when p_steps is null or p_prev_steps is null or p_prev_steps <= 0 then -1
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.5 then 2
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.25 then 1
                     else 0 end;
begin
  -- Pior severidade. O piso 0 garante que dimensões não avaliadas (-1) nunca
  -- elevem o status.
  v_sev := greatest(0, s_temp, s_spo2, s_hr, s_dysp, s_vom, s_bleed, s_pain, s_diur, s_step);
  status := case v_sev when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;
  vtype  := 'Sinais vitais';

  -- Tipo = primeira dimensão (por prioridade) que atinge a pior severidade.
  if v_sev > 0 then
    vtype := case
      when s_bleed = v_sev then 'Sangramento'
      when s_temp  = v_sev then 'Temperatura'
      when s_spo2  = v_sev then 'Saturação'
      when s_hr    = v_sev then 'Frequência cardíaca'
      when s_dysp  = v_sev then 'Dispneia'
      when s_vom   = v_sev then 'Vômito'
      when s_pain  = v_sev then 'Dor'
      when s_diur  = v_sev then 'Diurese'
      when s_step  = v_sev then 'Passos'
      else 'Sinais vitais' end;
  end if;

  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) C-01 — submit_vital_record ÚNICA. Remove AS DUAS sobrecargas e cria uma só
--    (16 args existentes + p_urinated_normally + p_had_vomit = 18).
-- ----------------------------------------------------------------------------
drop function if exists public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text);
drop function if exists public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text);

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

  -- Vômito efetivo: usa o booleano; se ausente, infere da contagem (compat.).
  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  -- Passos do dia anterior (regra relativa): última medição com passos antes de hoje.
  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.record_date < current_date
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

  -- monitoring_day coerente com @vitalsync/shared (1..10).  (M-07)
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

grant execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) M-07 — get_patient_by_token: monitoring_day também limitado a 1..10
--    (sem alterar within_window).
-- ----------------------------------------------------------------------------
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
         then least(10, greatest(1, (current_date - p.hospital_discharge_date) + 1)) end as monitoring_day,
    (p.status = 'ACTIVE'
       and p.hospital_discharge_date is not null
       and current_date <= p.hospital_discharge_date + 10) as within_window
  from public.patients p
  where p.secure_token = p_token and p.status = 'ACTIVE';
$$;

grant execute on function public.get_patient_by_token(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) VERIFICAÇÃO (rode após aplicar):
--    select proname, pronargs from pg_proc where proname = 'submit_vital_record';
--    → deve retornar EXATAMENTE uma linha (pronargs = 18).
-- ----------------------------------------------------------------------------
