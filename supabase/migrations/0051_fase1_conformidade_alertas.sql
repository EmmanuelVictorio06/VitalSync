-- ============================================================================
-- VitalSync — Fase 1 de conformidade com o Fluxo Operacional do estudo piloto
-- (Santa Casa de Curitiba). Espelha em SQL as mudanças de
-- packages/shared/src/clinical/{thresholds,status}.ts:
--
--   1) Ingestão hídrica "não" passa de AMARELO para VERMELHO (protocolo 5.7.3:
--      "incapacidade de ingerir líquidos via oral" é critério vermelho).
--   2) Passos: referência passa a ser de ~48h (não mais "dia anterior"), corte
--      único de 50% = AMARELO. Não há mais vermelho ISOLADO de passos — o
--      vermelho de passos só existe combinado (ver item 4).
--   3) PA sistólica: NENHUMA mudança de valor. O protocolo diz vermelho só em
--      PAS>160 (sem faixa amarela alta); o código usa vermelho ≥140 desde a
--      confirmação médica de ago/2026 (migration 0048). Divergência registrada
--      em docs/PONTOS_PENDENTES.md — aguardando confirmação de qual regra vale.
--   4) Critérios COMBINADOS de vermelho (novos), mesmo quando nenhum sinal
--      isolado chegaria a vermelho sozinho:
--        a) queda ≥50% dos passos (48h) E (FC>110 OU aumento ≥3 pontos na dor
--           vs. a medição anterior);
--        b) 2–3 micções/dia E (FC≥110 OU SpO2≤92 OU Temp≥38 OU queda ≥50% dos
--           passos).
--   5) SpO2: nenhuma mudança de valor (a fronteira exata em 92 é ambígua no
--      próprio protocolo — ver docs/PONTOS_PENDENTES.md).
--
-- `eval_clinical_status` ganha o parâmetro `p_prev_pain` (dor da medição
-- anterior, para o critério combinado de dor). Assinatura muda de 14 para 15
-- args — drop explícito evita duas sobrecargas. `submit_vital_record` mantém
-- a MESMA assinatura (21 args): só o corpo muda, para calcular a referência de
-- passos em ~48h (em vez do último registro) e buscar a dor da medição
-- anterior, repassando os dois ao eval_clinical_status.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0050.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) eval_clinical_status — hídrica RED, passos só amarelo (48h), critérios
--    combinados de vermelho.
-- ----------------------------------------------------------------------------
drop function if exists public.eval_clinical_status(
  numeric, int, int, int, int, boolean, int, boolean, boolean, int, int, int, int, boolean);

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
  p_water_intake_ok   boolean,
  p_prev_pain         int
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
  -- Dispneia (3 níveis): GREEN 0 · YELLOW 1 · RED 2
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
  -- Passos: queda ≥50% vs. referência de ~48h atrás (p_prev_steps) = AMARELO.
  -- Não há mais vermelho isolado — só combinado (s_comb abaixo).
  s_step int := case when p_steps is null or p_prev_steps is null or p_prev_steps <= 0 then -1
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.5 then 1
                     else 0 end;
  -- Pressão arterial (confirmado ago/2026 — ver nota no topo sobre a
  -- divergência com o protocolo, item 1.3): pior status entre sistólica e
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
  -- Ingestão hídrica (protocolo 5.7.3, alterado nesta migration): Não → RED.
  s_water int := case when p_water_intake_ok is null then -1
                      when p_water_intake_ok then 0 else 2 end;
  -- ---- Critérios COMBINADOS (protocolo 5.7.2/5.7.3) ----
  steps_severe_drop boolean := p_steps is not null and p_prev_steps is not null and p_prev_steps > 0
                               and (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.5;
  hr_gt_110  boolean := p_heart_rate is not null and p_heart_rate > 110;
  hr_ge_110  boolean := p_heart_rate is not null and p_heart_rate >= 110;
  pain_increase_3 boolean := p_pain is not null and p_prev_pain is not null and (p_pain - p_prev_pain) >= 3;
  diuresis_2_3 boolean := p_urination_count is not null and p_urination_count between 2 and 3;
  spo2_le_92 boolean := p_oxygen_saturation is not null and p_oxygen_saturation <= 92;
  temp_ge_38 boolean := p_temperature is not null and p_temperature >= 38;
  combined1 boolean := steps_severe_drop and (hr_gt_110 or pain_increase_3);
  combined2 boolean := diuresis_2_3 and (hr_ge_110 or spo2_le_92 or temp_ge_38 or steps_severe_drop);
  s_comb int := case when combined1 or combined2 then 2 else -1 end;
begin
  -- Pior severidade. O piso 0 garante que dimensões não avaliadas (-1) nunca
  -- elevem o status.
  v_sev := greatest(0, s_temp, s_spo2, s_hr, s_dysp, s_vom, s_bleed, s_pain, s_diur, s_step, s_bp, s_water, s_comb);
  status := case v_sev when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;
  vtype  := 'Sinais vitais';

  -- Tipo = primeira dimensão (por prioridade clínica) que atinge a pior severidade.
  -- Critério combinado tem prioridade logo após sangramento (é um vermelho
  -- explícito do protocolo, mais informativo que apontar só o sinal isolado).
  if v_sev > 0 then
    vtype := case
      when s_bleed = v_sev then 'Sangramento'
      when s_comb  = v_sev then 'Critério combinado'
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
-- 2) submit_vital_record — mesma assinatura (21 args). Corpo muda para buscar
--    a referência de passos em ~48h (2 dias atrás, não o último registro) e a
--    dor da medição anterior, repassando os dois ao eval_clinical_status.
-- ----------------------------------------------------------------------------
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
  v_prev_pain    int;
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

  -- Passos de referência (protocolo: ~48h atrás, não o último registro).
  -- Passos só são coletados à noite, então "48h atrás" é o registro de 2+
  -- dias atrás (a penúltima noite), não o de ontem.
  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.record_date <= v_today - 2
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  -- Dor da medição anterior (qualquer período), para o critério combinado de
  -- aumento ≥3 pontos. A medição atual ainda não foi inserida, então "a mais
  -- recente já existente" é exatamente a anterior a esta.
  select vsr.pain_level into v_prev_pain
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.pain_level is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  -- Avaliação clínica única.
  select s.status, s.vtype into v_status, v_type
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps, p_systolic, p_diastolic, p_water_intake_ok, v_prev_pain
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

-- ----------------------------------------------------------------------------
-- 3) VERIFICAÇÃO (rode após aplicar):
--
--    -- deve retornar EXATAMENTE uma linha (pronargs = 15):
--    select proname, pronargs from pg_proc where proname = 'eval_clinical_status';
--
--    -- hídrica "não" agora é RED (era YELLOW):
--    select status from public.eval_clinical_status(
--      36.5, 98, 80, 0, 0, true, 4, false, false, null, null, 120, 80, false, null);
--    -- esperado: RED
--
--    -- combinado: queda de passos ≥50% + FC>110 → RED:
--    select status, vtype from public.eval_clinical_status(
--      36.5, 98, 111, 0, 0, true, 4, false, false, 400, 1000, 120, 80, true, null);
--    -- esperado: RED, 'Critério combinado'
--
--    -- passos ≥50% ISOLADO (FC normal, sem dor prévia) → YELLOW, não RED:
--    select status from public.eval_clinical_status(
--      36.5, 98, 80, 0, 0, true, 4, false, false, 400, 1000, 120, 80, true, null);
--    -- esperado: YELLOW
-- ----------------------------------------------------------------------------
