-- ============================================================================
-- Migration: 0075_regras_clinicas_editaveis
--
-- OBJETIVO: tornar as FAIXAS CLÍNICAS SIMPLES (verde/amarelo/vermelho por
-- intervalo numérico) editáveis pelo ADMIN em runtime, sem deploy — do mesmo
-- jeito que `app_settings` já faz com os parâmetros operacionais (0063).
--
-- >>> REGRA DE OURO DESTA MIGRATION <<<
-- NENHUM valor clínico muda. A tabela nova nasce SEMEADA com exatamente os
-- valores de `packages/shared/src/clinical/thresholds.ts` (ALERT_THRESHOLDS),
-- inclusive os limites "estranhos" (37.79, 94.01, 92.1) que existem para
-- fechar as bordas das faixas. O bloco 9 desta migration ABORTA o `db push`
-- se `eval_clinical_status` devolver qualquer status diferente do atual numa
-- bateria de valores de borda.
--
-- O QUE FICA EDITÁVEL (8 métricas de faixa simples):
--   temperature · spo2 · bloodPressureSystolic · bloodPressureDiastolic ·
--   heartRate · diuresis · pain · dyspnea
--
-- O QUE CONTINUA EM CÓDIGO (NÃO editável por esta tela):
--   • critérios COMBINADOS de vermelho (queda de passos ≥50% + FC>110 ou dor
--     +3 pontos; diurese 2–3 + FC≥110/SpO2≤92/temp≥38/queda de passos);
--   • STEPS_RULES (queda ≥50% vs. referência de 48h);
--   • BINARY_RULES (vômito e sangramento → vermelho);
--   • WATER_INTAKE_RULE (não conseguir ingerir líquidos → vermelho);
--   • o fallback da diurese sem contagem (`urinated_normally`).
--   Esses critérios não são "faixa numérica de uma variável" — mudá-los é
--   mudar a ESTRUTURA da regra, não um número. Seguem em `thresholds.ts` +
--   corpo de `eval_clinical_status`.
--
-- MUDANÇA DE VOLATILIDADE (proposital): `eval_clinical_status` deixa de ser
-- IMMUTABLE e passa a STABLE, porque agora lê a tabela de faixas. Ela não é
-- usada em índice nem em coluna gerada (verificado: só é chamada de dentro de
-- `submit_vital_record` e `staff_insert_vital_record`), então a troca é segura.
-- `create or replace` aceita mudar volatilidade sem drop (assinatura idêntica
-- à da 0053: 15 argumentos, mesmo RETURNS TABLE).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0074.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Defaults em código SQL — espelho fiel de ALERT_THRESHOLDS.
--    Servem para (a) semear a tabela e (b) fallback caso a linha da métrica
--    seja apagada por engano. Formato idêntico ao do TS: array ORDENADO de
--    {status, min?, max?}, limites INCLUSIVOS, primeira faixa que casa vence.
-- ----------------------------------------------------------------------------
create or replace function public.clinical_threshold_defaults(p_metric text)
returns jsonb
language sql immutable set search_path = public as $$
  select case p_metric
    -- Temperatura: GREEN <37,8 · YELLOW 37,8–38,4 · RED ≥38,5
    when 'temperature' then
      '[{"status":"GREEN","max":37.79},
        {"status":"YELLOW","min":37.8,"max":38.4},
        {"status":"RED","min":38.5}]'::jsonb
    -- Saturação: GREEN >94 · YELLOW 92,1–94 · RED ≤92
    when 'spo2' then
      '[{"status":"GREEN","min":94.01},
        {"status":"YELLOW","min":92.1,"max":94},
        {"status":"RED","max":92}]'::jsonb
    -- Sistólica: RED ≤89 · YELLOW 90–99 · GREEN 100–129 · YELLOW 130–139 · RED ≥140
    when 'bloodPressureSystolic' then
      '[{"status":"RED","max":89},
        {"status":"YELLOW","min":90,"max":99},
        {"status":"GREEN","min":100,"max":129},
        {"status":"YELLOW","min":130,"max":139},
        {"status":"RED","min":140}]'::jsonb
    -- Diastólica: RED ≤49 · YELLOW 50–59 · GREEN 60–89 · YELLOW 90–99 · RED ≥100
    when 'bloodPressureDiastolic' then
      '[{"status":"RED","max":49},
        {"status":"YELLOW","min":50,"max":59},
        {"status":"GREEN","min":60,"max":89},
        {"status":"YELLOW","min":90,"max":99},
        {"status":"RED","min":100}]'::jsonb
    -- Frequência cardíaca: GREEN ≤110 · YELLOW 111–119 · RED ≥120
    when 'heartRate' then
      '[{"status":"GREEN","max":110},
        {"status":"YELLOW","min":111,"max":119},
        {"status":"RED","min":120}]'::jsonb
    -- Diurese (micções/dia): GREEN ≥4 · YELLOW 2–3 · RED ≤1
    when 'diuresis' then
      '[{"status":"GREEN","min":4},
        {"status":"YELLOW","min":2,"max":3},
        {"status":"RED","max":1}]'::jsonb
    -- Dor (0–10): GREEN 0–6 · YELLOW 7–8 · RED ≥9
    when 'pain' then
      '[{"status":"GREEN","min":0,"max":6},
        {"status":"YELLOW","min":7,"max":8},
        {"status":"RED","min":9}]'::jsonb
    -- Dispneia (0/1/2): GREEN 0 · YELLOW 1 · RED ≥2
    when 'dyspnea' then
      '[{"status":"GREEN","min":0,"max":0},
        {"status":"YELLOW","min":1,"max":1},
        {"status":"RED","min":2}]'::jsonb
  end;
$$;

comment on function public.clinical_threshold_defaults(text) is
  'Faixas clínicas padrão (espelho de ALERT_THRESHOLDS em @vitalsync/shared). Semeiam clinical_threshold_settings e servem de fallback se a linha sumir.';

-- ----------------------------------------------------------------------------
-- 2) Domínio plausível de cada métrica — usado pela VALIDAÇÃO para provar que
--    as faixas cobrem todo valor de entrada possível, sem buraco.
--    O passo é a menor granularidade que o campo realmente aceita (0,1 para
--    temperatura/saturação; 1 para os inteiros).
-- ----------------------------------------------------------------------------
create or replace function public.clinical_metric_domain(p_metric text)
returns table (dmin numeric, dmax numeric, dstep numeric)
language sql immutable set search_path = public as $$
  select d.mn, d.mx, d.st
    from (values
      ('temperature',            30::numeric, 45::numeric,  0.1::numeric),
      ('spo2',                   50::numeric, 100::numeric, 0.1::numeric),
      ('bloodPressureSystolic',  40::numeric, 300::numeric, 1::numeric),
      ('bloodPressureDiastolic', 20::numeric, 200::numeric, 1::numeric),
      ('heartRate',              20::numeric, 300::numeric, 1::numeric),
      ('diuresis',                0::numeric, 30::numeric,  1::numeric),
      ('pain',                    0::numeric, 10::numeric,  1::numeric),
      ('dyspnea',                 0::numeric, 2::numeric,   1::numeric)
    ) as d(k, mn, mx, st)
   where d.k = p_metric;
$$;

comment on function public.clinical_metric_domain(text) is
  'Domínio plausível + granularidade de cada métrica de faixa simples. Só existe para a validação de cobertura da RPC admin_set_clinical_threshold.';

-- ----------------------------------------------------------------------------
-- 3) Tabela das faixas editáveis (uma linha por métrica).
-- ----------------------------------------------------------------------------
create table if not exists public.clinical_threshold_settings (
  metric_key         text primary key,
  label              text not null,
  rules              jsonb not null,
  pending_validation boolean not null default false,
  pending_note       text,
  sort_order         int not null default 0,
  updated_by         uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now()
);

comment on table public.clinical_threshold_settings is
  'Faixas clínicas verde/amarelo/vermelho editáveis pelo ADMIN em runtime. Espelha ALERT_THRESHOLDS de @vitalsync/shared; é a FONTE VIVA lida por classify_by_bands/eval_clinical_status. Escrita só via admin_set_clinical_threshold.';
comment on column public.clinical_threshold_settings.rules is
  'Array ORDENADO de {status, min?, max?} — limites inclusivos, primeira faixa que casa vence (mesma semântica de evaluateRange no TS).';
comment on column public.clinical_threshold_settings.pending_validation is
  'true = faixa provisória, aguardando confirmação médica (espelha PENDING_MEDICAL_VALIDATION).';

alter table public.clinical_threshold_settings enable row level security;

-- Leitura para qualquer usuário logado (a aba Configurações → Regras Clínicas
-- é visível a todos os papéis). Escrita: NENHUMA policy — só a RPC definer.
drop policy if exists clinical_thresholds_read on public.clinical_threshold_settings;
create policy clinical_thresholds_read
  on public.clinical_threshold_settings for select to authenticated using (true);

revoke all on public.clinical_threshold_settings from anon, authenticated;
grant select on public.clinical_threshold_settings to authenticated;

-- SEED: valores EXATOS de ALERT_THRESHOLDS. `do nothing` para não sobrescrever
-- edição já feita pelo admin caso a migration seja reaplicada.
insert into public.clinical_threshold_settings (metric_key, label, rules, pending_validation, pending_note, sort_order)
values
  ('temperature',            'Temperatura',           public.clinical_threshold_defaults('temperature'),            false, null, 1),
  ('spo2',                   'Saturação (SpO2)',      public.clinical_threshold_defaults('spo2'),                   false, null, 2),
  ('bloodPressureSystolic',  'Pressão sistólica',     public.clinical_threshold_defaults('bloodPressureSystolic'),  false, null, 3),
  ('bloodPressureDiastolic', 'Pressão diastólica',    public.clinical_threshold_defaults('bloodPressureDiastolic'), false, null, 4),
  ('heartRate',              'Frequência cardíaca',   public.clinical_threshold_defaults('heartRate'),              false, null, 5),
  ('diuresis',               'Diurese (micções/dia)', public.clinical_threshold_defaults('diuresis'),               false, null, 6),
  ('pain',                   'Dor',                   public.clinical_threshold_defaults('pain'),                   false, null, 7),
  ('dyspnea',                'Dispneia',              public.clinical_threshold_defaults('dyspnea'),                false, null, 8)
on conflict (metric_key) do nothing;

-- ----------------------------------------------------------------------------
-- 4) Leitura das faixas + classificador.
--    SECURITY DEFINER porque `eval_clinical_status` roda dentro de funções
--    definer e também no contexto do pg_cron/service_role — o classificador
--    não pode depender de quem está logado (mesma razão de nursing_setting_num).
-- ----------------------------------------------------------------------------
create or replace function public.clinical_rules_for(p_metric text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.rules from public.clinical_threshold_settings s where s.metric_key = p_metric),
    public.clinical_threshold_defaults(p_metric)
  );
$$;

/**
 * Severidade numérica do status, na mesma escala usada por eval_clinical_status:
 * GREEN=0, YELLOW=1, RED=2 e NULL=-1 ("métrica não informada / não se aplica").
 */
create or replace function public.clinical_status_severity(p_status public.clinical_status)
returns int
language sql immutable set search_path = public as $$
  select case p_status when 'RED' then 2 when 'YELLOW' then 1 when 'GREEN' then 0 else -1 end;
$$;

/**
 * Classifica um valor pelas faixas VIVAS da métrica.
 * Semântica idêntica a `evaluateRange` (status.ts): percorre na ordem, limites
 * inclusivos, primeira faixa que casa vence; sem faixa correspondente → GREEN.
 * Valor nulo → NULL (o chamador traduz para "não se aplica").
 */
create or replace function public.classify_by_bands(p_metric text, p_value numeric)
returns public.clinical_status
language sql stable security definer set search_path = public as $$
  select case
    when p_value is null then null::public.clinical_status
    else coalesce(
      (
        select (r.rule ->> 'status')::public.clinical_status
          from jsonb_array_elements(public.clinical_rules_for(p_metric)) with ordinality as r(rule, ord)
         where ((r.rule ->> 'min') is null or p_value >= (r.rule ->> 'min')::numeric)
           and ((r.rule ->> 'max') is null or p_value <= (r.rule ->> 'max')::numeric)
         order by r.ord
         limit 1
      ),
      'GREEN'::public.clinical_status
    )
  end;
$$;

comment on function public.classify_by_bands(text, numeric) is
  'Classifica um valor pelas faixas vivas de clinical_threshold_settings (fallback nos defaults em código). Primeira faixa que casa vence, limites inclusivos.';

revoke execute on function public.clinical_rules_for(text) from public, anon;
revoke execute on function public.classify_by_bands(text, numeric) from public, anon;
grant execute on function public.clinical_rules_for(text) to authenticated;
grant execute on function public.classify_by_bands(text, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) eval_clinical_status — MESMA assinatura e MESMO retorno da 0053.
--    Única mudança: as 8 métricas de faixa simples passam a chamar
--    classify_by_bands em vez dos literais. Critérios combinados, binários,
--    passos, ingestão hídrica, vtype e yellow_count ficam INTACTOS.
--    IMMUTABLE → STABLE (agora lê tabela). Ver cabeçalho.
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
  p_prev_steps        int,
  p_systolic          int,
  p_diastolic         int,
  p_water_intake_ok   boolean,
  p_prev_pain         int
) returns table(
  status public.clinical_status,
  vtype text,
  yellow_count int,
  isolated_by_steps_or_diuresis boolean
)
language plpgsql stable set search_path = public as $$
declare
  v_sev int;
  -- ---- Faixas simples: EDITÁVEIS pelo admin (clinical_threshold_settings) ----
  -- clinical_status_severity devolve -1 quando a métrica não foi informada,
  -- preservando a semântica de "não se aplica" das versões anteriores.
  s_temp int := public.clinical_status_severity(public.classify_by_bands('temperature', p_temperature));
  s_spo2 int := public.clinical_status_severity(public.classify_by_bands('spo2', p_oxygen_saturation));
  s_hr   int := public.clinical_status_severity(public.classify_by_bands('heartRate', p_heart_rate));
  s_dysp int := public.clinical_status_severity(public.classify_by_bands('dyspnea', p_dyspnea));
  s_pain int := public.clinical_status_severity(public.classify_by_bands('pain', p_pain));
  s_sys  int := public.clinical_status_severity(public.classify_by_bands('bloodPressureSystolic', p_systolic));
  s_dia  int := public.clinical_status_severity(public.classify_by_bands('bloodPressureDiastolic', p_diastolic));
  -- Pressão arterial: pior status entre sistólica e diastólica (0048).
  s_bp int := greatest(s_sys, s_dia);
  -- Diurese: com contagem → faixa editável; sem contagem → fallback binário
  -- "urinou normalmente" (regra ESTRUTURAL, segue em código).
  s_diur int := case
                  when p_urination_count is not null then
                       public.clinical_status_severity(public.classify_by_bands('diuresis', p_urination_count))
                  when p_urinated_normally is not null then
                       case when p_urinated_normally then 0 else 1 end
                  else -1 end;
  -- ---- Regras NÃO editáveis (seguem em thresholds.ts + aqui) ----
  -- Vômito / Sangramento: Sim → RED (BINARY_RULES).
  s_vom   int := case when p_had_vomit    is true then 2 else 0 end;
  s_bleed int := case when p_has_bleeding is true then 2 else 0 end;
  -- Passos: queda ≥50% vs. referência de ~48h atrás (p_prev_steps) = AMARELO.
  -- Não há vermelho isolado — só combinado (s_comb abaixo).
  s_step int := case when p_steps is null or p_prev_steps is null or p_prev_steps <= 0 then -1
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.5 then 1
                     else 0 end;
  -- Ingestão hídrica (protocolo 5.7.3): Não → RED.
  s_water int := case when p_water_intake_ok is null then -1
                      when p_water_intake_ok then 0 else 2 end;
  -- ---- Critérios COMBINADOS (protocolo 5.7.2/5.7.3) — em código ----
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
  v_sev := greatest(0, s_temp, s_spo2, s_hr, s_dysp, s_vom, s_bleed, s_pain, s_diur, s_step, s_bp, s_water, s_comb);
  status := case v_sev when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;
  vtype  := 'Sinais vitais';

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

  -- Contagem de critérios amarelos (5.7.2): amarelo isolado x ≥2 critérios têm
  -- conduta diferente (ver Detalhes do Alerta no frontend). s_vom/s_bleed nunca
  -- valem 1 (são binários 0/2) e por isso não entram na contagem.
  yellow_count := (case when s_temp=1 then 1 else 0 end)
                + (case when s_spo2=1 then 1 else 0 end)
                + (case when s_hr=1   then 1 else 0 end)
                + (case when s_dysp=1 then 1 else 0 end)
                + (case when s_pain=1 then 1 else 0 end)
                + (case when s_diur=1 then 1 else 0 end)
                + (case when s_step=1 then 1 else 0 end)
                + (case when s_bp=1   then 1 else 0 end);
  isolated_by_steps_or_diuresis := yellow_count = 1 and (s_step = 1 or s_diur = 1);

  return next;
end;
$$;

-- `eval_clinical_status` nasceu (0021) com EXECUTE para PUBLIC, o que a deixava
-- chamável por `anon` via PostgREST — ninguém a chama assim (o paciente passa
-- por `submit_vital_record`, que é SECURITY DEFINER). Como ela agora depende de
-- `classify_by_bands` (definer, só authenticated), alinhamos os privilégios em
-- vez de deixar um caminho anon que quebraria com "permission denied".
revoke execute on function public.eval_clinical_status(
  numeric, int, int, int, int, boolean, int, boolean, boolean, int, int, int, int, boolean, int
) from public, anon;
grant execute on function public.eval_clinical_status(
  numeric, int, int, int, int, boolean, int, boolean, boolean, int, int, int, int, boolean, int
) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) VALIDAÇÃO das faixas — o coração da segurança clínica desta feature.
--    Uma faixa mal editada é pior do que faixa nenhuma: valor sem status vira
--    verde silencioso. Por isso a RPC PROVA, por varredura do domínio, que:
--      (a) todo status é GREEN/YELLOW/RED;
--      (b) todo valor plausível cai em ALGUMA faixa (sem buraco);
--      (c) toda faixa é alcançável (não é sombreada por uma anterior —
--          é assim que sobreposição contraditória aparece);
--      (d) os três status existem (verde, amarelo e vermelho).
--    Levanta exceção em PT-BR — a mensagem chega crua na tela.
-- ----------------------------------------------------------------------------
create or replace function public.validate_clinical_rules(p_metric text, p_rules jsonb)
returns void
language plpgsql stable set search_path = public as $$
declare
  v_n        int;
  v_dmin     numeric;
  v_dmax     numeric;
  v_dstep    numeric;
  v_bad      text;
  v_hole     numeric;
  v_unreach  int;
  v_missing  text;
begin
  select d.dmin, d.dmax, d.dstep into v_dmin, v_dmax, v_dstep
    from public.clinical_metric_domain(p_metric) d;
  if v_dmin is null then
    raise exception 'A métrica "%" não tem faixas editáveis (regra definida em código).', p_metric;
  end if;

  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'As faixas precisam ser uma lista.';
  end if;
  v_n := jsonb_array_length(p_rules);
  if v_n = 0 then
    raise exception 'Informe pelo menos uma faixa.';
  end if;

  -- (a) formato de cada faixa
  select string_agg(msg, ' ') into v_bad from (
    select case
      when jsonb_typeof(e.value) <> 'object'
        then format('A faixa %s não é válida.', e.ord)
      when coalesce(e.value ->> 'status', '') not in ('GREEN', 'YELLOW', 'RED')
        then format('A faixa %s tem um status inválido (use Verde, Amarelo ou Vermelho).', e.ord)
      when e.value ? 'min' and jsonb_typeof(e.value -> 'min') not in ('number', 'null')
        then format('O valor mínimo da faixa %s precisa ser um número.', e.ord)
      when e.value ? 'max' and jsonb_typeof(e.value -> 'max') not in ('number', 'null')
        then format('O valor máximo da faixa %s precisa ser um número.', e.ord)
      when (e.value ->> 'min') is not null and (e.value ->> 'max') is not null
           and (e.value ->> 'min')::numeric > (e.value ->> 'max')::numeric
        then format('Na faixa %s o mínimo é maior que o máximo.', e.ord)
      when exists (
             select 1 from jsonb_object_keys(e.value) k where k not in ('status', 'min', 'max')
           )
        then format('A faixa %s tem campos desconhecidos (use apenas status, mínimo e máximo).', e.ord)
      else null end as msg
      from jsonb_array_elements(p_rules) with ordinality as e(value, ord)
  ) t where msg is not null;
  if v_bad is not null then
    raise exception '%', v_bad;
  end if;

  -- (d) os três status precisam existir
  select string_agg(f.rotulo, ', ') into v_missing
    from (values ('GREEN', 'Verde'), ('YELLOW', 'Amarelo'), ('RED', 'Vermelho')) as f(st, rotulo)
   where not exists (
     select 1 from jsonb_array_elements(p_rules) e where e.value ->> 'status' = f.st
   );
  if v_missing is not null then
    raise exception 'Faltam faixas para: %. Toda métrica precisa ter as três faixas (Verde, Amarelo e Vermelho).', v_missing;
  end if;

  -- (b) e (c): varre o domínio plausível e checa cobertura + alcançabilidade.
  with amostras as (
    select generate_series(v_dmin, v_dmax, v_dstep) as v
  ),
  casadas as (
    select a.v,
           (select min(r.ord)
              from jsonb_array_elements(p_rules) with ordinality as r(rule, ord)
             where ((r.rule ->> 'min') is null or a.v >= (r.rule ->> 'min')::numeric)
               and ((r.rule ->> 'max') is null or a.v <= (r.rule ->> 'max')::numeric)) as first_ord
      from amostras a
  )
  select (select min(c.v) from casadas c where c.first_ord is null),
         (select min(s.ord)::int
            from generate_series(1, v_n) as s(ord)
           where not exists (select 1 from casadas c where c.first_ord = s.ord))
    into v_hole, v_unreach;

  if v_hole is not null then
    raise exception 'As faixas deixam valores sem classificação (por exemplo, %). Cubra todo o intervalo de % a % sem buracos.',
      v_hole, v_dmin, v_dmax;
  end if;

  if v_unreach is not null then
    raise exception 'A faixa % nunca será aplicada: uma faixa anterior já cobre todos os valores dela. Reordene ou ajuste os limites.',
      v_unreach;
  end if;
end;
$$;

comment on function public.validate_clinical_rules(text, jsonb) is
  'Prova por varredura do domínio que as faixas cobrem todo valor plausível, sem buraco e sem faixa sombreada. Chamada por admin_set_clinical_threshold antes de gravar.';

-- ----------------------------------------------------------------------------
-- 7) RPCs da tela.
-- ----------------------------------------------------------------------------

/** Faixas vivas + metadados de edição (quem alterou e quando). Toda a tela. */
create or replace function public.get_clinical_thresholds()
returns table (
  metric_key         text,
  label              text,
  rules              jsonb,
  pending_validation boolean,
  pending_note       text,
  sort_order         int,
  updated_at         timestamptz,
  updated_by_name    text
)
language sql stable security definer set search_path = public as $$
  select s.metric_key, s.label, s.rules, s.pending_validation, s.pending_note,
         s.sort_order, s.updated_at, p.name
    from public.clinical_threshold_settings s
    left join public.profiles p on p.id = s.updated_by
   order by s.sort_order, s.metric_key;
$$;

/** Texto curto de uma lista de faixas — usado no audit_logs (antes → depois). */
create or replace function public.clinical_rules_to_text(p_rules jsonb)
returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(
    (case r.rule ->> 'status'
       when 'GREEN' then 'Verde' when 'YELLOW' then 'Amarelo' when 'RED' then 'Vermelho'
       else coalesce(r.rule ->> 'status', '?') end)
    || ' ' ||
    case
      when (r.rule ->> 'min') is not null and (r.rule ->> 'max') is not null then
        case when (r.rule ->> 'min') = (r.rule ->> 'max')
             then '= ' || (r.rule ->> 'min')
             else (r.rule ->> 'min') || '–' || (r.rule ->> 'max') end
      when (r.rule ->> 'min') is not null then '≥ ' || (r.rule ->> 'min')
      when (r.rule ->> 'max') is not null then '≤ ' || (r.rule ->> 'max')
      else 'qualquer valor' end,
    ' · ' order by r.ord), '—')
    from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) with ordinality as r(rule, ord);
$$;

/**
 * Grava as faixas de UMA métrica. Só ADMIN. Valida antes; audita depois.
 * O frontend nunca faz update direto em clinical_threshold_settings.
 */
create or replace function public.admin_set_clinical_threshold(p_metric text, p_rules jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old   jsonb;
  v_label text;
begin
  if not public.is_admin() then
    raise exception 'Apenas o Administrador pode alterar as regras clínicas.';
  end if;

  select s.rules, s.label into v_old, v_label
    from public.clinical_threshold_settings s
   where s.metric_key = p_metric;
  if not found then
    raise exception 'A métrica "%" não é editável por esta tela (regra definida em código).', p_metric;
  end if;

  perform public.validate_clinical_rules(p_metric, p_rules);

  if v_old = p_rules then
    return;  -- nada mudou: não polui a auditoria
  end if;

  update public.clinical_threshold_settings
     set rules = p_rules, updated_by = auth.uid(), updated_at = now()
   where metric_key = p_metric;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  select coalesce(p.name, '—'), coalesce(p.role::text, '—'), 'SETTINGS_CHANGE',
         format('Regra clínica "%s": %s → %s',
                v_label,
                public.clinical_rules_to_text(v_old),
                public.clinical_rules_to_text(p_rules))
    from (select 1) x
    left join public.profiles p on p.id = auth.uid();
end;
$$;

revoke execute on function public.get_clinical_thresholds() from public, anon;
revoke execute on function public.validate_clinical_rules(text, jsonb) from public, anon;
revoke execute on function public.admin_set_clinical_threshold(text, jsonb) from public, anon;
grant execute on function public.get_clinical_thresholds() to authenticated;
grant execute on function public.admin_set_clinical_threshold(text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) Auto-teste: as faixas SEMEADAS têm que passar na própria validação.
--    Se um dia alguém "corrigir" um default e criar buraco, o db push quebra
--    aqui em vez de silenciar um valor sem status em produção.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select metric_key, rules from public.clinical_threshold_settings loop
    begin
      perform public.validate_clinical_rules(r.metric_key, r.rules);
    exception when others then
      raise exception '0075: a faixa semeada de "%" não passa na validação: %', r.metric_key, sqlerrm;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 9) REGRESSÃO CLÍNICA (crítico) — o comportamento tem que ser IDÊNTICO ao da
--    0053 para todos os valores de borda. Cada linha isola UMA métrica (as
--    demais entram nulas), então o resultado esperado é o status daquela faixa.
--    Qualquer divergência ABORTA a migration.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(format('%s=%s deu %s (esperado %s)', t.metrica, t.valor, e.status, t.esperado), '; ' order by t.metrica, t.valor)
    into v_bad
    from (values
      -- Temperatura: GREEN <37,8 · YELLOW 37,8–38,4 · RED ≥38,5
      ('temperature', 36.5::numeric, 'GREEN'),
      ('temperature', 37.79,         'GREEN'),
      ('temperature', 37.8,          'YELLOW'),
      ('temperature', 38.4,          'YELLOW'),
      ('temperature', 38.5,          'RED'),
      ('temperature', 40.0,          'RED'),
      -- Saturação: GREEN >94 · YELLOW 92,1–94 · RED ≤92
      ('spo2', 98, 'GREEN'),
      ('spo2', 95, 'GREEN'),
      ('spo2', 94, 'YELLOW'),
      ('spo2', 93, 'YELLOW'),
      ('spo2', 92, 'RED'),
      ('spo2', 90, 'RED'),
      -- Frequência cardíaca: GREEN ≤110 · YELLOW 111–119 · RED ≥120
      ('heartRate', 70,  'GREEN'),
      ('heartRate', 110, 'GREEN'),
      ('heartRate', 111, 'YELLOW'),
      ('heartRate', 119, 'YELLOW'),
      ('heartRate', 120, 'RED'),
      -- Sistólica: RED ≤89 · YELLOW 90–99 · GREEN 100–129 · YELLOW 130–139 · RED ≥140
      ('bloodPressureSystolic', 80,  'RED'),
      ('bloodPressureSystolic', 89,  'RED'),
      ('bloodPressureSystolic', 90,  'YELLOW'),
      ('bloodPressureSystolic', 99,  'YELLOW'),
      ('bloodPressureSystolic', 100, 'GREEN'),
      ('bloodPressureSystolic', 129, 'GREEN'),
      ('bloodPressureSystolic', 130, 'YELLOW'),
      ('bloodPressureSystolic', 139, 'YELLOW'),
      ('bloodPressureSystolic', 140, 'RED'),
      ('bloodPressureSystolic', 150, 'RED'),
      -- Diastólica: RED ≤49 · YELLOW 50–59 · GREEN 60–89 · YELLOW 90–99 · RED ≥100
      ('bloodPressureDiastolic', 45,  'RED'),
      ('bloodPressureDiastolic', 49,  'RED'),
      ('bloodPressureDiastolic', 50,  'YELLOW'),
      ('bloodPressureDiastolic', 59,  'YELLOW'),
      ('bloodPressureDiastolic', 60,  'GREEN'),
      ('bloodPressureDiastolic', 89,  'GREEN'),
      ('bloodPressureDiastolic', 90,  'YELLOW'),
      ('bloodPressureDiastolic', 99,  'YELLOW'),
      ('bloodPressureDiastolic', 100, 'RED'),
      -- Dor: GREEN 0–6 · YELLOW 7–8 · RED ≥9
      ('pain', 0,  'GREEN'),
      ('pain', 6,  'GREEN'),
      ('pain', 7,  'YELLOW'),
      ('pain', 8,  'YELLOW'),
      ('pain', 9,  'RED'),
      ('pain', 10, 'RED'),
      -- Dispneia: GREEN 0 · YELLOW 1 · RED 2
      ('dyspnea', 0, 'GREEN'),
      ('dyspnea', 1, 'YELLOW'),
      ('dyspnea', 2, 'RED'),
      -- Diurese (micções/dia): GREEN ≥4 · YELLOW 2–3 · RED ≤1
      ('diuresis', 6, 'GREEN'),
      ('diuresis', 4, 'GREEN'),
      ('diuresis', 3, 'YELLOW'),
      ('diuresis', 2, 'YELLOW'),
      ('diuresis', 1, 'RED'),
      ('diuresis', 0, 'RED')
    ) as t(metrica, valor, esperado)
    cross join lateral public.eval_clinical_status(
      case when t.metrica = 'temperature'            then t.valor end,       -- p_temperature
      case when t.metrica = 'spo2'                   then t.valor::int end,  -- p_oxygen_saturation
      case when t.metrica = 'heartRate'              then t.valor::int end,  -- p_heart_rate
      case when t.metrica = 'pain'                   then t.valor::int end,  -- p_pain
      case when t.metrica = 'dyspnea'                then t.valor::int end,  -- p_dyspnea
      null::boolean,                                                          -- p_urinated_normally
      case when t.metrica = 'diuresis'               then t.valor::int end,  -- p_urination_count
      null::boolean,                                                          -- p_had_vomit
      null::boolean,                                                          -- p_has_bleeding
      null::int,                                                              -- p_steps
      null::int,                                                              -- p_prev_steps
      case when t.metrica = 'bloodPressureSystolic'  then t.valor::int end,  -- p_systolic
      case when t.metrica = 'bloodPressureDiastolic' then t.valor::int end,  -- p_diastolic
      null::boolean,                                                          -- p_water_intake_ok
      null::int                                                               -- p_prev_pain
    ) as e
   where e.status::text <> t.esperado;

  if v_bad is not null then
    raise exception '0075 REGRESSÃO CLÍNICA: eval_clinical_status mudou de comportamento → %', v_bad;
  end if;
end $$;

-- Regressão dos critérios COMBINADOS e binários (que NÃO viraram table-driven):
-- se a refatoração tivesse mexido neles, estes casos mudariam.
do $$
declare v_status text; v_type text; v_yellow int; v_isolated boolean;
begin
  -- Queda de passos ≥50% + FC>110 → RED por "Critério combinado"
  select e.status::text, e.vtype into v_status, v_type
    from public.eval_clinical_status(null, null, 111, null, null, null, null, null, null,
                                     400, 1000, null, null, null, null) e;
  if v_status <> 'RED' or v_type <> 'Critério combinado' then
    raise exception '0075: critério combinado passos+FC quebrou (% / %).', v_status, v_type;
  end if;

  -- Diurese 2–3 + temperatura ≥38 → RED combinado
  select e.status::text into v_status
    from public.eval_clinical_status(38.0, null, null, null, null, null, 3, null, null,
                                     null, null, null, null, null, null) e;
  if v_status <> 'RED' then
    raise exception '0075: critério combinado diurese+temperatura quebrou (%).', v_status;
  end if;

  -- Sangramento → RED; ingestão hídrica não → RED
  select e.status::text, e.vtype into v_status, v_type
    from public.eval_clinical_status(null, null, null, null, null, null, null, null, true,
                                     null, null, null, null, null, null) e;
  if v_status <> 'RED' or v_type <> 'Sangramento' then
    raise exception '0075: regra binária de sangramento quebrou (% / %).', v_status, v_type;
  end if;

  select e.status::text, e.vtype into v_status, v_type
    from public.eval_clinical_status(null, null, null, null, null, null, null, null, null,
                                     null, null, null, null, false, null) e;
  if v_status <> 'RED' or v_type <> 'Ingestão hídrica' then
    raise exception '0075: regra de ingestão hídrica quebrou (% / %).', v_status, v_type;
  end if;

  -- Sem contagem de micções, "não urinou normalmente" continua AMARELO isolado
  select e.status::text, e.yellow_count, e.isolated_by_steps_or_diuresis
    into v_status, v_yellow, v_isolated
    from public.eval_clinical_status(null, null, null, null, null, false, null, null, null,
                                     null, null, null, null, null, null) e;
  if v_status <> 'YELLOW' or v_yellow <> 1 or not v_isolated then
    raise exception '0075: fallback de diurese sem contagem quebrou (%, %, %).', v_status, v_yellow, v_isolated;
  end if;

  -- Amarelo isolado por PA continua com yellow_count = 1 e isolated = false
  select e.status::text, e.yellow_count, e.isolated_by_steps_or_diuresis
    into v_status, v_yellow, v_isolated
    from public.eval_clinical_status(null, null, null, null, null, null, null, null, null,
                                     null, null, 135, null, null, null) e;
  if v_status <> 'YELLOW' or v_yellow <> 1 or v_isolated then
    raise exception '0075: contagem de amarelos quebrou (%, %, %).', v_status, v_yellow, v_isolated;
  end if;
end $$;

-- A validação REJEITA faixa com buraco e faixa sombreada (prova que a rede de
-- segurança da edição funciona).
do $$
declare v_rejeitou boolean;
begin
  v_rejeitou := false;
  begin
    -- buraco: 37,8 a 37,89 fica sem status
    perform public.validate_clinical_rules('temperature',
      '[{"status":"GREEN","max":37.79},{"status":"YELLOW","min":37.9,"max":38.4},{"status":"RED","min":38.5}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0075: a validação deveria ter rejeitado faixas com buraco.';
  end if;

  v_rejeitou := false;
  begin
    -- faixa amarela ausente
    perform public.validate_clinical_rules('pain',
      '[{"status":"GREEN","max":8},{"status":"RED","min":9}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0075: a validação deveria ter exigido as três faixas.';
  end if;

  v_rejeitou := false;
  begin
    -- faixa vermelha sombreada pela verde anterior (sobreposição contraditória)
    perform public.validate_clinical_rules('pain',
      '[{"status":"GREEN","min":0,"max":10},{"status":"YELLOW","min":7,"max":8},{"status":"RED","min":9}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0075: a validação deveria ter rejeitado faixa inalcançável.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rodar no SQL Editor depois do `supabase db push`)
-- ----------------------------------------------------------------------------
--
--   -- 1) As 8 métricas foram semeadas com os valores de thresholds.ts:
--   select metric_key, label, public.clinical_rules_to_text(rules), pending_validation
--     from public.clinical_threshold_settings order by sort_order;
--   --> Temperatura: "Verde ≤ 37.79 · Amarelo 37.8–38.4 · Vermelho ≥ 38.5" etc.
--
--   -- 2) Volatilidade e privilégios:
--   select p.proname, p.provolatile, p.prosecdef,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('eval_clinical_status', 'classify_by_bands',
--                        'get_clinical_thresholds', 'admin_set_clinical_threshold');
--   --> eval_clinical_status: provolatile = 's' (era 'i')
--   --> admin_set_clinical_threshold / get_clinical_thresholds: anon = false, auth = true
--
--   -- 3) A regressão clínica já rodou no push (blocos 8 e 9 acima). Para
--   --    conferir manualmente uma borda:
--   select status, vtype from public.eval_clinical_status(
--     37.8, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
--   --> YELLOW / Temperatura
--
--   -- 4) EDIÇÃO PELO ADMIN muda o cálculo de verdade (logado como ADMIN):
--   select status from public.eval_clinical_status(
--     null, null, null, null, null, null, null, null, null, null, null, 150, null, null, null);
--   --> RED (regra atual: vermelho ≥140)
--
--   select public.admin_set_clinical_threshold('bloodPressureSystolic',
--     '[{"status":"RED","max":89},
--       {"status":"YELLOW","min":90,"max":99},
--       {"status":"GREEN","min":100,"max":150},
--       {"status":"YELLOW","min":151,"max":160},
--       {"status":"RED","min":161}]'::jsonb);
--
--   select status from public.eval_clinical_status(
--     null, null, null, null, null, null, null, null, null, null, null, 150, null, null, null);
--   --> GREEN (150 deixou de ser vermelho — a edição valeu sem deploy)
--
--   -- Volte ao valor de produção:
--   select public.admin_set_clinical_threshold('bloodPressureSystolic',
--            public.clinical_threshold_defaults('bloodPressureSystolic'));
--
--   -- 5) Auditoria das duas edições acima:
--   select created_at, actor_name, action, entity from public.audit_logs
--    where entity like 'Regra clínica%' order by created_at desc limit 5;
--   --> 2 linhas SETTINGS_CHANGE com "antes → depois"
--
--   -- 6) Não-admin é barrado (logado como enfermeiro/cirurgião):
--   select public.admin_set_clinical_threshold('pain',
--            public.clinical_threshold_defaults('pain'));
--   --> ERROR: Apenas o Administrador pode alterar as regras clínicas.
--
--   -- 7) Buraco é rejeitado (logado como ADMIN):
--   select public.admin_set_clinical_threshold('temperature',
--     '[{"status":"GREEN","max":37.79},
--       {"status":"YELLOW","min":37.9,"max":38.4},
--       {"status":"RED","min":38.5}]'::jsonb);
--   --> ERROR: As faixas deixam valores sem classificação (por exemplo, 37.8)...
--
--   -- 8) Leitura pela tela:
--   select * from public.get_clinical_thresholds();
-- ----------------------------------------------------------------------------
