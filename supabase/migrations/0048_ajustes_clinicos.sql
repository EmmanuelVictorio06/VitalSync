-- ============================================================================
-- VitalSync — Fase 1+2 dos ajustes clínicos do piloto (ago/2026):
--
--   (1) Pressão Arterial passa a ENTRAR no semáforo, avaliada por sistólica E
--       diastólica separadamente (vale o pior status entre as duas). Substitui
--       a antiga regra sistólica-única provisória (M-06), agora CONFIRMADA
--       pela equipe médica. Espelha packages/shared/src/clinical/thresholds.ts.
--   (2) Dispneia passa de escala 0–10 para 3 níveis: 0 = sem dispneia (GREEN),
--       1 = leve (YELLOW), 2 = moderada/intensa (RED). Não há backfill: registros
--       antigos (0–10) mantêm o clinical_status já gravado.
--   (3) Nova pergunta "Ingestão hídrica" (consegue tomar líquidos normalmente?):
--       Não → YELLOW. Coluna nova `water_intake_ok`.
--   (4) Colunas novas de suporte à Fase 2 do wizard do paciente:
--       `drain_output_ml` (débito do dreno, ml) e `noticed_wound_change`
--       (paciente sinalizou alteração na cicatriz ao acordar, manhã).
--
-- INVESTIGAÇÃO do bug relatado ("alerta amarelo disparando com PA 120×80"):
-- conferido `eval_clinical_status` (criada em 0021, chamada sem alteração até
-- a 0047) e `process-vital-record/index.ts` (função legada/paralela) — NENHUM
-- dos dois avalia p_systolic/p_diastolic hoje; a PA é apenas GRAVADA, nunca
-- decide o status. Não há regra sistólica-única viva no banco ou nas Edge
-- Functions (grep confirmado em supabase/ e frontend/). Ou seja, o alerta
-- relatado não pode ter vindo do pipeline atual (pós-0021) — é anterior a essa
-- migration, ou uma leitura equivocada do card (PA aparece no card mas nunca
-- disparou nada). Esta migration é o que ATIVA de fato a PA no cálculo; a
-- verificação abaixo comprova 120×80 → GREEN.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0047.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Colunas novas em vital_sign_records.
-- ----------------------------------------------------------------------------
alter table public.vital_sign_records add column if not exists water_intake_ok boolean;
alter table public.vital_sign_records add column if not exists drain_output_ml int;
alter table public.vital_sign_records add column if not exists noticed_wound_change boolean;

comment on column public.vital_sign_records.water_intake_ok is
  'Ingestão hídrica: "está conseguindo tomar líquidos normalmente?". Não = amarelo.';
comment on column public.vital_sign_records.drain_output_ml is
  'Débito do dreno em ml, informado quando has_drain = true (medição noturna).';
comment on column public.vital_sign_records.noticed_wound_change is
  'Manhã: paciente sinalizou ter notado algo diferente na cicatriz ao acordar. A foto correspondente (wound_photo_path) é opcional.';

-- ----------------------------------------------------------------------------
-- 2) eval_clinical_status — acrescenta PA (sistólica+diastólica) e ingestão
--    hídrica. Assinatura muda (11 → 14 args): drop explícito evita ficar com
--    duas sobrecargas.
-- ----------------------------------------------------------------------------
drop function if exists public.eval_clinical_status(
  numeric, int, int, int, int, boolean, int, boolean, boolean, int, int);

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
  p_prev_steps        int,
  p_systolic          int,
  p_diastolic         int,
  p_water_intake_ok   boolean
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
  -- Dispneia (3 níveis, confirmado ago/2026): 0=GREEN · 1=YELLOW · 2=RED
  s_dysp int := case when p_dyspnea is null then -1
                     when p_dyspnea >= 2 then 2
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
  -- Pressão arterial (confirmado ago/2026): pior status entre sistólica e
  -- diastólica, avaliadas separadamente.
  -- Sistólica: RED ≤89 · YELLOW 90–99 · GREEN 100–129 · YELLOW 130–139 · RED ≥140
  s_sys int := case when p_systolic is null then -1
                    when p_systolic <= 89 or p_systolic >= 140 then 2
                    when p_systolic <= 99 or p_systolic >= 130 then 1 else 0 end;
  -- Diastólica: RED ≤49 · YELLOW 50–59 · GREEN 60–89 · YELLOW 90–99 · RED ≥100
  s_dia int := case when p_diastolic is null then -1
                    when p_diastolic <= 49 or p_diastolic >= 100 then 2
                    when p_diastolic <= 59 or p_diastolic >= 90  then 1 else 0 end;
  s_bp int := greatest(s_sys, s_dia);
  -- Ingestão hídrica: Não → YELLOW.
  s_water int := case when p_water_intake_ok is null then -1
                      when p_water_intake_ok then 0 else 1 end;
begin
  -- Pior severidade. O piso 0 garante que dimensões não avaliadas (-1) nunca
  -- elevem o status.
  v_sev := greatest(0, s_temp, s_spo2, s_hr, s_dysp, s_vom, s_bleed, s_pain, s_diur, s_step, s_bp, s_water);
  status := case v_sev when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;
  vtype  := 'Sinais vitais';

  -- Tipo = primeira dimensão (por prioridade clínica) que atinge a pior severidade.
  if v_sev > 0 then
    vtype := case
      when s_bleed = v_sev then 'Sangramento'
      when s_bp    = v_sev then 'Pressão arterial'
      when s_temp  = v_sev then 'Temperatura'
      when s_spo2  = v_sev then 'Saturação'
      when s_hr    = v_sev then 'Frequência cardíaca'
      when s_dysp  = v_sev then 'Dispneia'
      when s_vom   = v_sev then 'Vômito'
      when s_pain  = v_sev then 'Dor'
      when s_diur  = v_sev then 'Diurese'
      when s_water = v_sev then 'Ingestão hídrica'
      when s_step  = v_sev then 'Passos'
      else 'Sinais vitais' end;
  end if;

  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) submit_vital_record — repassa PA + hídrica ao eval_clinical_status e
--    grava as 3 colunas novas. Assinatura muda (18 → 21 args): drop explícito
--    da assinatura antiga evita duas sobrecargas. Corpo idêntico ao da 0047
--    (regra "uma medição por período por dia", fuso America/Sao_Paulo) +
--    os 3 parâmetros novos no final.
-- ----------------------------------------------------------------------------
drop function if exists public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean);

create or replace function public.submit_vital_record(
  p_token               text,
  p_period              text,
  p_temperature         numeric  default null,
  p_oxygen_saturation   int      default null,
  p_systolic            int      default null,
  p_diastolic           int      default null,
  p_heart_rate          int      default null,
  p_pain                int      default null,
  p_dyspnea             int      default null,
  p_urination_count     int      default null,
  p_vomiting_count      int      default null,
  p_has_bleeding        boolean  default false,
  p_steps               int      default null,
  p_wound_photo_path    text     default null,
  p_has_drain           boolean  default false,
  p_drain_photo_path    text     default null,
  p_urinated_normally   boolean  default null,
  p_had_vomit           boolean  default null,
  p_water_intake_ok     boolean  default null,
  p_drain_output_ml     int      default null,
  p_noticed_wound_change boolean default null
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

  -- Avaliação clínica única (PA e hídrica agora ENTRAM no cálculo — confirmado ago/2026).
  select s.status, s.vtype into v_status, v_type
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps, p_systolic, p_diastolic, p_water_intake_ok
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
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test,
      water_intake_ok, drain_output_ml, noticed_wound_change
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false),
      p_water_intake_ok,
      case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
      p_noticed_wound_change
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
      is_test = excluded.is_test,
      water_intake_ok = excluded.water_intake_ok,
      drain_output_ml = case when excluded.has_drain then excluded.drain_output_ml else null end,
      noticed_wound_change = excluded.noticed_wound_change
    returning id into v_record_id;
  else
    -- Toggle desligado: insert puro. `do nothing` fecha a corrida entre a
    -- checagem acima e o insert (duplo-clique/duas abas): se outro envio chegou
    -- primeiro, nenhuma linha volta e recusamos com a mesma mensagem.
    insert into public.vital_sign_records (
      patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
      systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
      urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test,
      water_intake_ok, drain_output_ml, noticed_wound_change
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false),
      p_water_intake_ok,
      case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
      p_noticed_wound_change
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

grant execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean,
  boolean, int, boolean
) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) VERIFICAÇÃO (rode após aplicar):
--
--    -- deve retornar EXATAMENTE uma linha (pronargs = 21):
--    select proname, pronargs from pg_proc where proname = 'submit_vital_record';
--
--    -- deve retornar GREEN (comprova o fim do bug relatado com 120×80):
--    select status from public.eval_clinical_status(
--      36.5, 98, 80, 0, 0, true, 4, false, false, null, null, 120, 80, true);
--
--    -- demais casos de referência (sistólica/diastólica, pior dos dois):
--    -- 135×92 → YELLOW · 145×85 → RED · 95×55 → YELLOW · 88×48 → RED
-- ----------------------------------------------------------------------------
