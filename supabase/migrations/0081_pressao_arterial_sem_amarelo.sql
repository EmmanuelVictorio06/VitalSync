-- ============================================================================
-- Migration: 0081_pressao_arterial_sem_amarelo
--
-- DECISÃO MÉDICA (set/2026): a PRESSÃO ARTERIAL deixa de ter faixa AMARELA.
-- Objetivo declarado: reduzir ruído na triagem de enfermagem.
--
--   Sistólica:   RED ≤ 89 · GREEN 90–139 · RED ≥ 140
--   Diastólica:  RED ≤ 49 · GREEN 50–99  · RED ≥ 100
--
-- Os limites de VERMELHO são idênticos aos de hoje — nenhum valor que hoje é
-- vermelho deixa de ser. A mudança é só a remoção das duas faixas amarelas de
-- cada métrica, com o verde absorvendo elas. Na prática: 134/92 deixa de gerar
-- alerta (hoje vira amarelo e cai na fila da enfermagem); 168/104 segue
-- VERMELHO exatamente como antes.
--
-- NENHUMA outra métrica muda (temperatura, saturação, FC, dor, dispneia e
-- diurese seguem iguais) — o bloco 5 prova isso.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA MIGRATION MEXE NA VALIDAÇÃO (bloco 2) — leia antes de estranhar
-- ---------------------------------------------------------------------------
-- `validate_clinical_rules` (0075, bloco 6) exigia que as TRÊS faixas
-- existissem em toda métrica. Com a PA sem amarelo, a RPC
-- `admin_set_clinical_threshold` RECUSARIA a edição pela tela com "Faltam
-- faixas para: Amarelo" — ou seja, sem esta mudança a decisão médica é
-- impossível de aplicar, inclusive manualmente.
--
-- A exigência vira: VERDE e VERMELHO obrigatórios, AMARELO opcional. Amarelo é
-- uma decisão clínica ("existe zona de atenção nesta métrica?"), não uma
-- obrigação estrutural. As checagens que de fato protegem contra o verde
-- silencioso — cobertura do domínio sem buraco e faixa inalcançável — ficam
-- INTACTAS, e são elas que impedem que um valor fique sem classificação.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA MIGRATION TAMBÉM ESCREVE NA TABELA VIVA (bloco 3)
-- ---------------------------------------------------------------------------
-- Trocar só `clinical_threshold_defaults()` NÃO corrigiria ambiente novo: num
-- `db reset` a 0075 roda antes e já semeia `clinical_threshold_settings` com o
-- amarelo da PA (`on conflict do nothing`), então a linha nasceria com a regra
-- velha e só o fallback mudaria. Por isso o bloco 3 re-semeia as duas linhas
-- de PA — mas SOMENTE se elas ainda estiverem byte-idênticas ao default antigo
-- da 0075, prova de que nenhum ADMIN as editou. Linha customizada é preservada
-- e a migration avisa por `raise notice`.
--
-- A escrita é auditada em `audit_logs` como ação do sistema (`actor_name` =
-- 'Sistema (migration 0081)'), mantendo o rastro que a RPC
-- `admin_set_clinical_threshold` garantiria. A RPC não pôde ser usada porque
-- exige `is_admin()` e a migration roda como `postgres`.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO MUDA (proposital)
-- ---------------------------------------------------------------------------
-- • `eval_clinical_status` NÃO é reescrita. O termo `s_bp = 1` do `yellow_count`
--   continua lá e NÃO é código morto: `s_bp` vem de `classify_by_bands`, que lê
--   a tabela. Se um dia o ADMIN devolver uma faixa amarela à PA pela tela, o
--   termo volta a contar sozinho. Removê-lo quebraria o desenho table-driven da
--   0075. Ver o `comment on function` no bloco 4.
-- • Os critérios COMBINADOS de vermelho (protocolo 5.7.2/5.7.3) não usam pressão
--   arterial — só passos, FC, dor, diurese, SpO2 e temperatura. Conferido no
--   corpo de `eval_clinical_status` (0075): nem `combined1` nem `combined2`
--   referenciam `p_systolic`/`p_diastolic`. Nada a fazer.
-- • Alertas JÁ GERADOS não mudam: `status` é imutável por invariante e alimenta
--   as métricas do estudo (0055). A regra nova vale daqui pra frente.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0080.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Defaults — só as duas métricas de PA mudam. As outras 6 são cópia literal
--    da 0075 (o bloco 5 prova que continuam idênticas).
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
    -- Sistólica (set/2026): RED ≤89 · GREEN 90–139 · RED ≥140 — SEM amarelo.
    when 'bloodPressureSystolic' then
      '[{"status":"RED","max":89},
        {"status":"GREEN","min":90,"max":139},
        {"status":"RED","min":140}]'::jsonb
    -- Diastólica (set/2026): RED ≤49 · GREEN 50–99 · RED ≥100 — SEM amarelo.
    when 'bloodPressureDiastolic' then
      '[{"status":"RED","max":49},
        {"status":"GREEN","min":50,"max":99},
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
  'Faixas clínicas padrão (espelho de ALERT_THRESHOLDS em @vitalsync/shared). Semeiam clinical_threshold_settings e servem de fallback se a linha sumir. Desde a 0081 a pressão arterial não tem faixa amarela.';

-- ----------------------------------------------------------------------------
-- 2) Validação: VERDE e VERMELHO obrigatórios, AMARELO opcional.
--    Cópia da 0075 com UMA mudança — a checagem (d). Cobertura sem buraco (b) e
--    faixa inalcançável (c) continuam iguais: são elas a rede de segurança.
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

  -- (d) VERDE e VERMELHO são obrigatórios; AMARELO é opcional.
  -- Mudou na 0081: a pressão arterial passou a ser verde/vermelho puro por
  -- decisão médica (set/2026), e a exigência das três faixas impedia gravar
  -- essa regra. Amarelo é uma decisão clínica por métrica ("existe zona de
  -- atenção aqui?"), não um requisito estrutural. Verde e vermelho seguem
  -- obrigatórios: uma métrica sem vermelho não classificaria nada como crítico,
  -- e uma sem verde marcaria todo valor normal como anormal.
  select string_agg(f.rotulo, ', ') into v_missing
    from (values ('GREEN', 'Verde'), ('RED', 'Vermelho')) as f(st, rotulo)
   where not exists (
     select 1 from jsonb_array_elements(p_rules) e where e.value ->> 'status' = f.st
   );
  if v_missing is not null then
    raise exception 'Faltam faixas para: %. Toda métrica precisa ter pelo menos uma faixa Verde e uma Vermelha (a Amarela é opcional).', v_missing;
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
  'Prova por varredura do domínio que as faixas cobrem todo valor plausível, sem buraco e sem faixa sombreada. Exige Verde e Vermelho; Amarelo é opcional desde a 0081. Chamada por admin_set_clinical_threshold antes de gravar.';

-- ----------------------------------------------------------------------------
-- 3) Re-semeia as DUAS linhas de PA — só se ainda estiverem no default antigo.
--    Linha já customizada por um ADMIN é PRESERVADA (a decisão dele vence).
-- ----------------------------------------------------------------------------
do $$
declare
  v_antigo  jsonb;
  v_novo    jsonb;
  v_atual   jsonb;
  v_label   text;
  v_mudou   int := 0;
  r         record;
begin
  for r in
    select * from (values
      ('bloodPressureSystolic',
       '[{"status":"RED","max":89},
         {"status":"YELLOW","min":90,"max":99},
         {"status":"GREEN","min":100,"max":129},
         {"status":"YELLOW","min":130,"max":139},
         {"status":"RED","min":140}]'::jsonb),
      ('bloodPressureDiastolic',
       '[{"status":"RED","max":49},
         {"status":"YELLOW","min":50,"max":59},
         {"status":"GREEN","min":60,"max":89},
         {"status":"YELLOW","min":90,"max":99},
         {"status":"RED","min":100}]'::jsonb)
    ) as t(metric_key, default_0075)
  loop
    v_antigo := r.default_0075;
    v_novo   := public.clinical_threshold_defaults(r.metric_key);

    select s.rules, s.label into v_atual, v_label
      from public.clinical_threshold_settings s
     where s.metric_key = r.metric_key;

    if not found then
      raise notice '0081: métrica "%" não existe em clinical_threshold_settings — nada a re-semear.', r.metric_key;
      continue;
    end if;

    if v_atual = v_novo then
      -- Já está na regra nova (migration reaplicada). Idempotente.
      continue;
    end if;

    if v_atual <> v_antigo then
      raise notice '0081: a faixa de "%" foi editada por um ADMIN e NÃO será sobrescrita. Regra vigente: %. Para aplicar a decisão de set/2026, edite em Configurações → Regras Clínicas.',
        r.metric_key, public.clinical_rules_to_text(v_atual);
      continue;
    end if;

    update public.clinical_threshold_settings
       set rules = v_novo, updated_by = null, updated_at = now()
     where metric_key = r.metric_key;

    -- Mesmo rastro que admin_set_clinical_threshold deixaria. A RPC não pôde
    -- ser usada aqui: ela exige is_admin() e a migration roda como `postgres`.
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema (migration 0081)', 'SYSTEM', 'SETTINGS_CHANGE',
            format('Regra clínica "%s": %s → %s (decisão médica set/2026: pressão arterial sem faixa amarela)',
                   v_label,
                   public.clinical_rules_to_text(v_antigo),
                   public.clinical_rules_to_text(v_novo)));

    v_mudou := v_mudou + 1;
  end loop;

  raise notice '0081: % linha(s) de pressão arterial re-semeada(s).', v_mudou;
end $$;

-- ----------------------------------------------------------------------------
-- 4) Documenta, no próprio catálogo, por que `eval_clinical_status` NÃO mudou.
-- ----------------------------------------------------------------------------
comment on function public.eval_clinical_status(
  numeric, int, int, int, int, boolean, int, boolean, boolean, int, int, int, int, boolean, int
) is
  'Calcula status/vtype/yellow_count de uma medição. As 8 métricas de faixa simples vêm de classify_by_bands (tabela clinical_threshold_settings). NÃO alterada pela 0081: o termo s_bp do yellow_count continua válido — desde a 0081 a PA não tem faixa amarela por decisão médica, então s_bp=1 não ocorre com as faixas vigentes, mas voltaria a ocorrer se um ADMIN devolvesse uma faixa amarela à PA pela tela. É comportamento table-driven, não código morto.';

-- ----------------------------------------------------------------------------
-- 5) As outras 6 métricas NÃO foram tocadas — comparação literal dos defaults
--    contra os valores da 0075. Se alguém "aproveitar a viagem" e mexer numa
--    delas, o db push quebra aqui.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(t.metrica, ', ') into v_bad
    from (values
      ('temperature', '[{"status":"GREEN","max":37.79},{"status":"YELLOW","min":37.8,"max":38.4},{"status":"RED","min":38.5}]'::jsonb),
      ('spo2',        '[{"status":"GREEN","min":94.01},{"status":"YELLOW","min":92.1,"max":94},{"status":"RED","max":92}]'::jsonb),
      ('heartRate',   '[{"status":"GREEN","max":110},{"status":"YELLOW","min":111,"max":119},{"status":"RED","min":120}]'::jsonb),
      ('diuresis',    '[{"status":"GREEN","min":4},{"status":"YELLOW","min":2,"max":3},{"status":"RED","max":1}]'::jsonb),
      ('pain',        '[{"status":"GREEN","min":0,"max":6},{"status":"YELLOW","min":7,"max":8},{"status":"RED","min":9}]'::jsonb),
      ('dyspnea',     '[{"status":"GREEN","min":0,"max":0},{"status":"YELLOW","min":1,"max":1},{"status":"RED","min":2}]'::jsonb)
    ) as t(metrica, esperado)
   where public.clinical_threshold_defaults(t.metrica) <> t.esperado;

  if v_bad is not null then
    raise exception '0081: os defaults de % mudaram, e esta migration só pode mexer na pressão arterial.', v_bad;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6) A validação aceita a regra nova e continua rejeitando o que importa.
-- ----------------------------------------------------------------------------
do $$
declare v_rejeitou boolean;
begin
  -- Aceita as faixas novas de PA (sem amarelo, sem buraco).
  perform public.validate_clinical_rules('bloodPressureSystolic',
            public.clinical_threshold_defaults('bloodPressureSystolic'));
  perform public.validate_clinical_rules('bloodPressureDiastolic',
            public.clinical_threshold_defaults('bloodPressureDiastolic'));

  -- Continua rejeitando BURACO (a rede de segurança de verdade).
  v_rejeitou := false;
  begin
    perform public.validate_clinical_rules('bloodPressureSystolic',
      '[{"status":"RED","max":89},{"status":"GREEN","min":91,"max":139},{"status":"RED","min":140}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0081: a validação deveria ter rejeitado faixas com buraco (valor 90 sem status).';
  end if;

  -- Continua rejeitando FALTA DE VERMELHO.
  v_rejeitou := false;
  begin
    perform public.validate_clinical_rules('pain',
      '[{"status":"GREEN","min":0,"max":8},{"status":"YELLOW","min":9,"max":10}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0081: a validação deveria ter exigido faixa Vermelha.';
  end if;

  -- Continua rejeitando FALTA DE VERDE.
  v_rejeitou := false;
  begin
    perform public.validate_clinical_rules('pain',
      '[{"status":"YELLOW","min":0,"max":8},{"status":"RED","min":9}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0081: a validação deveria ter exigido faixa Verde.';
  end if;

  -- Continua rejeitando FAIXA INALCANÇÁVEL.
  v_rejeitou := false;
  begin
    perform public.validate_clinical_rules('bloodPressureSystolic',
      '[{"status":"GREEN","min":40,"max":300},{"status":"RED","max":89},{"status":"RED","min":140}]'::jsonb);
  exception when others then v_rejeitou := true;
  end;
  if not v_rejeitou then
    raise exception '0081: a validação deveria ter rejeitado faixa inalcançável.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7) REGRESSÃO CLÍNICA — só roda se as linhas vivas estiverem na regra nova
--    (se um ADMIN customizou a PA, o bloco 3 preservou a escolha dele e não há
--    o que assertar aqui).
-- ----------------------------------------------------------------------------
do $$
declare
  v_bad     text;
  v_status  text;
  v_vtype   text;
  v_yellow  int;
  v_vigente boolean;
begin
  select coalesce(bool_and(s.rules = public.clinical_threshold_defaults(s.metric_key)), false)
    into v_vigente
    from public.clinical_threshold_settings s
   where s.metric_key in ('bloodPressureSystolic', 'bloodPressureDiastolic');

  if not v_vigente then
    raise notice '0081: pressão arterial customizada pelo ADMIN — regressão clínica da PA pulada.';
    return;
  end if;

  -- Bordas de cada métrica isolada (as demais entram nulas).
  select string_agg(format('%s=%s deu %s (esperado %s)', t.metrica, t.valor, e.status, t.esperado), '; '
                    order by t.metrica, t.valor)
    into v_bad
    from (values
      -- Sistólica: RED ≤89 · GREEN 90–139 · RED ≥140
      ('bloodPressureSystolic', 80,  'RED'),
      ('bloodPressureSystolic', 89,  'RED'),
      ('bloodPressureSystolic', 90,  'GREEN'),   -- era YELLOW até a 0080
      ('bloodPressureSystolic', 99,  'GREEN'),   -- era YELLOW até a 0080
      ('bloodPressureSystolic', 100, 'GREEN'),
      ('bloodPressureSystolic', 129, 'GREEN'),
      ('bloodPressureSystolic', 130, 'GREEN'),   -- era YELLOW até a 0080
      ('bloodPressureSystolic', 139, 'GREEN'),   -- era YELLOW até a 0080
      ('bloodPressureSystolic', 140, 'RED'),     -- limite de vermelho INALTERADO
      ('bloodPressureSystolic', 168, 'RED'),
      -- Diastólica: RED ≤49 · GREEN 50–99 · RED ≥100
      ('bloodPressureDiastolic', 45,  'RED'),
      ('bloodPressureDiastolic', 49,  'RED'),
      ('bloodPressureDiastolic', 50,  'GREEN'),  -- era YELLOW até a 0080
      ('bloodPressureDiastolic', 59,  'GREEN'),  -- era YELLOW até a 0080
      ('bloodPressureDiastolic', 60,  'GREEN'),
      ('bloodPressureDiastolic', 89,  'GREEN'),
      ('bloodPressureDiastolic', 90,  'GREEN'),  -- era YELLOW até a 0080
      ('bloodPressureDiastolic', 99,  'GREEN'),  -- era YELLOW até a 0080
      ('bloodPressureDiastolic', 100, 'RED'),    -- limite de vermelho INALTERADO
      ('bloodPressureDiastolic', 104, 'RED')
    ) as t(metrica, valor, esperado)
    cross join lateral public.eval_clinical_status(
      null::numeric, null::int, null::int, null::int, null::int, null::boolean, null::int,
      null::boolean, null::boolean, null::int, null::int,
      case when t.metrica = 'bloodPressureSystolic'  then t.valor end,
      case when t.metrica = 'bloodPressureDiastolic' then t.valor end,
      null::boolean, null::int
    ) as e
   where e.status::text <> t.esperado;

  if v_bad is not null then
    raise exception '0081 REGRESSÃO CLÍNICA: %', v_bad;
  end if;

  -- Os dois casos do enunciado da decisão médica, com as duas medidas juntas.
  select e.status::text, e.yellow_count into v_status, v_yellow
    from public.eval_clinical_status(null, null, null, null, null, null, null, null, null,
                                     null, null, 134, 92, null, null) e;
  if v_status <> 'GREEN' or v_yellow <> 0 then
    raise exception '0081: 134/92 deveria ser GREEN com yellow_count 0 (deu %, %).', v_status, v_yellow;
  end if;

  select e.status::text, e.vtype into v_status, v_vtype
    from public.eval_clinical_status(null, null, null, null, null, null, null, null, null,
                                     null, null, 168, 104, null, null) e;
  if v_status <> 'RED' or v_vtype <> 'Pressão arterial' then
    raise exception '0081: 168/104 deveria ser RED por "Pressão arterial" (deu % / %).', v_status, v_vtype;
  end if;

  -- As outras métricas seguem intactas no cálculo (amostra de borda).
  select string_agg(format('%s=%s deu %s (esperado %s)', t.metrica, t.valor, e.status, t.esperado), '; ')
    into v_bad
    from (values
      ('temperature', 37.8::numeric, 'YELLOW'),
      ('temperature', 38.5,          'RED'),
      ('spo2',        94,            'YELLOW'),
      ('spo2',        92,            'RED'),
      ('heartRate',   111,           'YELLOW'),
      ('heartRate',   120,           'RED'),
      ('pain',        7,             'YELLOW'),
      ('pain',        9,             'RED'),
      ('dyspnea',     1,             'YELLOW'),
      ('dyspnea',     2,             'RED'),
      ('diuresis',    3,             'YELLOW'),
      ('diuresis',    1,             'RED')
    ) as t(metrica, valor, esperado)
    cross join lateral public.eval_clinical_status(
      case when t.metrica = 'temperature' then t.valor end,
      case when t.metrica = 'spo2'        then t.valor::int end,
      case when t.metrica = 'heartRate'   then t.valor::int end,
      case when t.metrica = 'pain'        then t.valor::int end,
      case when t.metrica = 'dyspnea'     then t.valor::int end,
      null::boolean,
      case when t.metrica = 'diuresis'    then t.valor::int end,
      null::boolean, null::boolean, null::int, null::int, null::int, null::int, null::boolean, null::int
    ) as e
   where e.status::text <> t.esperado;

  if v_bad is not null then
    raise exception '0081: métrica fora da pressão arterial mudou de comportamento → %', v_bad;
  end if;

  -- Os critérios COMBINADOS não usam PA: continuam disparando igual.
  select e.status::text, e.vtype into v_status, v_vtype
    from public.eval_clinical_status(null, null, 111, null, null, null, null, null, null,
                                     400, 1000, 120, 80, null, null) e;
  if v_status <> 'RED' or v_vtype <> 'Critério combinado' then
    raise exception '0081: critério combinado passos+FC quebrou (% / %).', v_status, v_vtype;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rodar no SQL Editor depois do `supabase db push`)
-- ----------------------------------------------------------------------------
--
--   -- 1) Regra vigente das duas métricas de PA (sem "Amarelo" no texto):
--   select metric_key, public.clinical_rules_to_text(rules), updated_at
--     from public.clinical_threshold_settings
--    where metric_key like 'bloodPressure%';
--   --> Pressão sistólica:  "Vermelho ≤ 89 · Verde 90–139 · Vermelho ≥ 140"
--   --> Pressão diastólica: "Vermelho ≤ 49 · Verde 50–99 · Vermelho ≥ 100"
--
--   -- 2) Os dois casos da decisão médica:
--   select status, vtype, yellow_count from public.eval_clinical_status(
--     null,null,null,null,null,null,null,null,null,null,null, 134, 92, null,null);
--   --> GREEN / 'Sinais vitais' / 0   (antes era YELLOW e ia para a enfermagem)
--
--   select status, vtype from public.eval_clinical_status(
--     null,null,null,null,null,null,null,null,null,null,null, 168, 104, null,null);
--   --> RED / 'Pressão arterial'      (inalterado)
--
--   -- 3) Rastro da mudança em auditoria:
--   select created_at, actor_name, action, entity from public.audit_logs
--    where entity like 'Regra clínica "Pressão%' order by created_at desc limit 4;
--   --> 2 linhas SETTINGS_CHANGE de 'Sistema (migration 0081)' com antes → depois
--
--   -- 4) A tela continua barrando faixa com buraco (logado como ADMIN):
--   select public.admin_set_clinical_threshold('bloodPressureSystolic',
--     '[{"status":"RED","max":89},{"status":"GREEN","min":91,"max":139},{"status":"RED","min":140}]'::jsonb);
--   --> ERROR: As faixas deixam valores sem classificação (por exemplo, 90)...
--
--   -- 5) ...mas agora ACEITA verde/vermelho puro (logado como ADMIN):
--   select public.admin_set_clinical_threshold('bloodPressureSystolic',
--            public.clinical_threshold_defaults('bloodPressureSystolic'));
--   --> sem erro (e sem nova linha de auditoria, porque o valor não mudou)
--
--   -- 6) Alertas ANTIGOS não mudaram (invariante: `status` é imutável):
--   select status, count(*) from public.clinical_alerts
--    where created_at < now() - interval '1 day' group by status;
--   --> a distribuição de antes da migration, inalterada
-- ----------------------------------------------------------------------------
