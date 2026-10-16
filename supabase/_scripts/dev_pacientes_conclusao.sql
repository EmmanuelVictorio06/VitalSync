-- ============================================================================
-- VitalSync — Cenário das abas "Em andamento" x "Concluídos" (DEV LOCAL)
--
-- ⚠️  NUNCA RODE ISTO EM PRODUÇÃO. Só faz sentido no Supabase local:
--     `supabase status` tem que mostrar API URL em 127.0.0.1:54321.
--
-- POR QUE ESTE SCRIPT EXISTE
-- A tela /monitoring separa os pacientes que já passaram dos 10 dias de
-- monitoramento pós-alta numa aba "Concluídos". A regra (a do
-- @vitalsync/shared) é:
--     concluído = tem data de alta E (HOJE − alta) >= 10
-- O dia da alta é o dia 1, então o 10º e último dia é alta + 9. Para conferir
-- a borda de verdade, este script cria cinco pacientes, um de cada lado:
--
--     secure_token                 alta        esperado
--     teste-conclusao-dia10        HOJE − 9    Em andamento (10º dia, o último)
--     teste-conclusao-dia11        HOJE − 10   Concluídos   (borda)
--     teste-conclusao-antigo       HOJE − 30   Concluídos
--     teste-conclusao-sem-alta     null        Em andamento
--     teste-conclusao-alta-futura  HOJE + 2    Em andamento
--
-- REGRA DA JANELA POR PACIENTE (migrations 0082/0083): os cinco acima são da
-- REGRA ANTIGA (`monitoring_starts_next_day = false`, dia 1 = dia da alta). Depois
-- da 0083 o default da coluna é TRUE, então TODO insert deste script informa a
-- coluna explicitamente — senão os antigos virariam regra nova sem querer.
-- Mais cinco da REGRA NOVA (true: dia 1 = alta + 1, último dia = alta + 10):
--
--     secure_token                 alta        esperado
--     teste-nova-alta-hoje         HOJE        Em andamento, sem dia
--     teste-nova-dia1              HOJE − 1    Em andamento, dia 1
--     teste-nova-dia9              HOJE − 9    Em andamento, dia 9
--     teste-nova-dia10             HOJE − 10   Em andamento, dia 10
--     teste-nova-concluido         HOJE − 11   Concluídos
--
-- Pares de MESMA alta e regras diferentes: "Nova · Dia 9" × "Teste Dia 10
-- (último dia)" e "Nova · Dia 10" × "Teste Dia 11 (borda)".
--
-- Os dois concluídos antigos e o "Nova · Concluído" recebem medições dos dias
-- 1..10 (manhã e noite) para o histórico em "Acompanhar". Como o `submit_vital_record` só aceita a janela
-- de HOJE, elas entram por INSERT direto, mas o `clinical_status` de cada uma
-- é DERIVADO por `public.eval_clinical_status` — a mesma função que a pipeline
-- usa. Nenhuma cor é escrita à mão.
--
-- Datas ancoradas no dia civil da CLÍNICA (America/Sao_Paulo), não em
-- `current_date` (que no banco é UTC e vira o dia seguinte depois das 21h — o
-- que jogaria o paciente de borda na aba errada).
--
-- ADITIVO e IDEMPOTENTE: só INSERT de linhas novas; não altera paciente algum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pacientes fictícios, todos na equipe 1. surgery_date = alta − 2 quando
--    houver alta; null no paciente sem alta.
-- ----------------------------------------------------------------------------
insert into public.patients
  (name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date,
   hospital_id, team_id, secure_token, sex, weight_kg, height_cm, length_of_stay_days,
   monitoring_starts_next_day)
select t.nome,
       t.nascimento,
       t.telefone,
       (select id from public.surgery_types order by name limit 1),
       t.alta - 2,
       t.alta,
       (select id from public.hospitals order by name limit 1),
       (select id from public.medical_teams where team_number = 1),
       t.token,
       t.sexo, t.peso, t.altura, 2,
       false  -- REGRA ANTIGA, explícito (o default depois da 0083 é true)
from (values
  -- token,                         nome,                        alta (offset de HOJE),                                  nascimento,        telefone,      sexo, peso, altura
  ('teste-conclusao-dia10',       'Teste Dia 10 (último dia)', ((now() at time zone 'America/Sao_Paulo')::date) - 9,  date '1968-03-12', '41900000101', 'F',  68,   162),
  ('teste-conclusao-dia11',       'Teste Dia 11 (borda)',      ((now() at time zone 'America/Sao_Paulo')::date) - 10, date '1975-09-27', '41900000102', 'M',  85,   178),
  ('teste-conclusao-antigo',      'Teste Concluído Antigo',    ((now() at time zone 'America/Sao_Paulo')::date) - 30, date '1959-11-02', '41900000103', 'F',  72,   158),
  ('teste-conclusao-sem-alta',    'Teste Sem Data de Alta',    null::date,                                            date '1981-05-19', '41900000104', 'M',  90,   181),
  ('teste-conclusao-alta-futura', 'Teste Alta Futura',         ((now() at time zone 'America/Sao_Paulo')::date) + 2,  date '1970-01-08', '41900000105', 'F',  64,   165)
) as t(token, nome, alta, nascimento, telefone, sexo, peso, altura)
where not exists (
  select 1 from public.patients where secure_token = t.token
);

-- ----------------------------------------------------------------------------
-- 1b) Pacientes da REGRA NOVA (monitoring_starts_next_day = true, explícito).
--     Mesmos campos e mesma equipe dos de cima.
-- ----------------------------------------------------------------------------
insert into public.patients
  (name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date,
   hospital_id, team_id, secure_token, sex, weight_kg, height_cm, length_of_stay_days,
   monitoring_starts_next_day)
select t.nome,
       t.nascimento,
       t.telefone,
       (select id from public.surgery_types order by name limit 1),
       t.alta - 2,
       t.alta,
       (select id from public.hospitals order by name limit 1),
       (select id from public.medical_teams where team_number = 1),
       t.token,
       t.sexo, t.peso, t.altura, 2,
       true  -- REGRA NOVA, explícito
from (values
  -- token,                   nome,               alta (offset de HOJE),                                  nascimento,        telefone,      sexo, peso, altura
  ('teste-nova-alta-hoje',  'Nova · Alta Hoje', ((now() at time zone 'America/Sao_Paulo')::date),       date '1966-04-21', '41900000106', 'M',  80,   175),
  ('teste-nova-dia1',       'Nova · Dia 1',     ((now() at time zone 'America/Sao_Paulo')::date) - 1,   date '1972-07-30', '41900000107', 'F',  61,   160),
  ('teste-nova-dia9',       'Nova · Dia 9',     ((now() at time zone 'America/Sao_Paulo')::date) - 9,   date '1964-12-03', '41900000108', 'M',  88,   180),
  ('teste-nova-dia10',      'Nova · Dia 10',    ((now() at time zone 'America/Sao_Paulo')::date) - 10,  date '1979-02-14', '41900000109', 'F',  70,   166),
  ('teste-nova-concluido',  'Nova · Concluído', ((now() at time zone 'America/Sao_Paulo')::date) - 11,  date '1961-08-09', '41900000110', 'M',  77,   172)
) as t(token, nome, alta, nascimento, telefone, sexo, peso, altura)
where not exists (
  select 1 from public.patients where secure_token = t.token
);

-- ----------------------------------------------------------------------------
-- 2) Medições dos dias 1..10 (MORNING e NIGHT) dos dois concluídos. A data de
--    cada registro sai da própria alta do paciente (dia N = alta + N − 1).
--    O `clinical_status` sai de `eval_clinical_status` a partir dos sinais.
--
--    Maioria verde; amarelos em D2 manhã (temperatura), D5 noite (SpO2) e
--    D8 manhã (FC); VERMELHO em D4 manhã.
-- ----------------------------------------------------------------------------
insert into public.vital_sign_records
  (patient_id, record_date, period, monitoring_day,
   temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate,
   pain_level, dyspnea_level, urination_count, urinated_normally, had_vomit,
   has_bleeding, water_intake_ok, has_drain, is_test, source, clinical_status)
select p.id,
       p.hospital_discharge_date + (m.dia - 1),
       m.periodo::public.measurement_period,
       m.dia,
       m.temp, m.spo2, m.sis, m.dia_pa, m.fc,
       m.dor, m.dispneia, 5, true, false,
       false, true, false, p.is_test, 'PATIENT',
       -- eval_clinical_status devolve TABLE(status, vtype, ...): pega só o status.
       (select e.status
          from public.eval_clinical_status(
                 m.temp, m.spo2, m.fc, m.dor, m.dispneia,
                 true, 5, false, false,
                 null, null, m.sis, m.dia_pa, true, null
               ) as e)
from public.patients p,
     (values
       -- dia, periodo,   temp, spo2, sis, dia_pa, fc,  dor, dispneia
       (1,  'MORNING', 36.5, 98,  120, 80,  72,  1, 0),  -- verde
       (1,  'NIGHT',   36.7, 97,  118, 78,  75,  2, 0),  -- verde
       (2,  'MORNING', 37.9, 96,  124, 82,  88,  4, 0),  -- amarelo (temperatura)
       (2,  'NIGHT',   36.6, 98,  120, 80,  74,  2, 0),  -- verde
       (3,  'MORNING', 36.8, 97,  122, 79,  76,  2, 0),  -- verde
       (3,  'NIGHT',   36.9, 97,  121, 80,  78,  2, 0),  -- verde
       (4,  'MORNING', 39.1, 91,  152, 104, 118, 8, 2),  -- vermelho
       (4,  'NIGHT',   37.0, 96,  125, 82,  84,  3, 0),  -- verde
       (5,  'MORNING', 36.6, 97,  120, 80,  76,  2, 0),  -- verde
       (5,  'NIGHT',   36.7, 93,  119, 79,  80,  2, 0),  -- amarelo (SpO2)
       (6,  'MORNING', 36.5, 98,  118, 78,  72,  1, 0),  -- verde
       (6,  'NIGHT',   36.6, 98,  120, 80,  73,  1, 0),  -- verde
       (7,  'MORNING', 36.4, 98,  117, 77,  70,  1, 0),  -- verde
       (7,  'NIGHT',   36.6, 97,  119, 78,  72,  1, 0),  -- verde
       (8,  'MORNING', 36.8, 97,  123, 81,  115, 2, 0),  -- amarelo (FC)
       (8,  'NIGHT',   36.6, 98,  120, 80,  74,  1, 0),  -- verde
       (9,  'MORNING', 36.5, 98,  118, 78,  71,  1, 0),  -- verde
       (9,  'NIGHT',   36.5, 98,  119, 79,  72,  0, 0),  -- verde
       (10, 'MORNING', 36.4, 99,  117, 76,  70,  0, 0),  -- verde
       (10, 'NIGHT',   36.5, 98,  118, 77,  71,  0, 0)   -- verde
     ) as m(dia, periodo, temp, spo2, sis, dia_pa, fc, dor, dispneia)
where p.secure_token in ('teste-conclusao-dia11', 'teste-conclusao-antigo')
  and p.hospital_discharge_date is not null
  and not exists (
    select 1 from public.vital_sign_records v
     where v.patient_id = p.id and v.monitoring_day = m.dia
       and v.period = m.periodo::public.measurement_period
  );

-- ----------------------------------------------------------------------------
-- 2b) Medições dos dias 1..10 (MORNING e NIGHT) do "Nova · Concluído", pela
--     REGRA NOVA: dia N = alta + N. Mesmos sinais do bloco 2; cor derivada
--     de `eval_clinical_status`.
-- ----------------------------------------------------------------------------
insert into public.vital_sign_records
  (patient_id, record_date, period, monitoring_day,
   temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate,
   pain_level, dyspnea_level, urination_count, urinated_normally, had_vomit,
   has_bleeding, water_intake_ok, has_drain, is_test, source, clinical_status)
select p.id,
       p.hospital_discharge_date + m.dia,
       m.periodo::public.measurement_period,
       m.dia,
       m.temp, m.spo2, m.sis, m.dia_pa, m.fc,
       m.dor, m.dispneia, 5, true, false,
       false, true, false, p.is_test, 'PATIENT',
       (select e.status
          from public.eval_clinical_status(
                 m.temp, m.spo2, m.fc, m.dor, m.dispneia,
                 true, 5, false, false,
                 null, null, m.sis, m.dia_pa, true, null
               ) as e)
from public.patients p,
     (values
       -- dia, periodo,   temp, spo2, sis, dia_pa, fc,  dor, dispneia
       (1,  'MORNING', 36.5, 98,  120, 80,  72,  1, 0),  -- verde
       (1,  'NIGHT',   36.7, 97,  118, 78,  75,  2, 0),  -- verde
       (2,  'MORNING', 37.9, 96,  124, 82,  88,  4, 0),  -- amarelo (temperatura)
       (2,  'NIGHT',   36.6, 98,  120, 80,  74,  2, 0),  -- verde
       (3,  'MORNING', 36.8, 97,  122, 79,  76,  2, 0),  -- verde
       (3,  'NIGHT',   36.9, 97,  121, 80,  78,  2, 0),  -- verde
       (4,  'MORNING', 39.1, 91,  152, 104, 118, 8, 2),  -- vermelho
       (4,  'NIGHT',   37.0, 96,  125, 82,  84,  3, 0),  -- verde
       (5,  'MORNING', 36.6, 97,  120, 80,  76,  2, 0),  -- verde
       (5,  'NIGHT',   36.7, 93,  119, 79,  80,  2, 0),  -- amarelo (SpO2)
       (6,  'MORNING', 36.5, 98,  118, 78,  72,  1, 0),  -- verde
       (6,  'NIGHT',   36.6, 98,  120, 80,  73,  1, 0),  -- verde
       (7,  'MORNING', 36.4, 98,  117, 77,  70,  1, 0),  -- verde
       (7,  'NIGHT',   36.6, 97,  119, 78,  72,  1, 0),  -- verde
       (8,  'MORNING', 36.8, 97,  123, 81,  115, 2, 0),  -- amarelo (FC)
       (8,  'NIGHT',   36.6, 98,  120, 80,  74,  1, 0),  -- verde
       (9,  'MORNING', 36.5, 98,  118, 78,  71,  1, 0),  -- verde
       (9,  'NIGHT',   36.5, 98,  119, 79,  72,  0, 0),  -- verde
       (10, 'MORNING', 36.4, 99,  117, 76,  70,  0, 0),  -- verde
       (10, 'NIGHT',   36.5, 98,  118, 77,  71,  0, 0)   -- verde
     ) as m(dia, periodo, temp, spo2, sis, dia_pa, fc, dor, dispneia)
where p.secure_token = 'teste-nova-concluido'
  and p.hospital_discharge_date is not null
  and not exists (
    select 1 from public.vital_sign_records v
     where v.patient_id = p.id and v.monitoring_day = m.dia
       and v.period = m.periodo::public.measurement_period
  );

-- ----------------------------------------------------------------------------
-- 3) VERIFICAÇÃO
-- ----------------------------------------------------------------------------
-- 3.1) Os 10 pacientes, a regra de cada um e a aba esperada, pela mesma regra
--      do frontend (antiga: conclui em HOJE − alta >= 10; nova: >= 11).
select p.name,
       p.monitoring_starts_next_day as regra_nova,
       p.hospital_discharge_date,
       ((now() at time zone 'America/Sao_Paulo')::date) - p.hospital_discharge_date as dias_desde_alta,
       case
         when p.hospital_discharge_date is null then null
         when p.monitoring_starts_next_day then
           nullif(least(10, greatest(0, ((now() at time zone 'America/Sao_Paulo')::date) - p.hospital_discharge_date)), 0)
         else
           nullif(least(10, greatest(0, ((now() at time zone 'America/Sao_Paulo')::date) - p.hospital_discharge_date + 1)), 0)
       end as dia_monitoramento_ate_10,
       case
         when p.hospital_discharge_date is not null
          and ((now() at time zone 'America/Sao_Paulo')::date) - p.hospital_discharge_date
              >= case when p.monitoring_starts_next_day then 11 else 10 end
         then 'CONCLUIDO'
         else 'EM ANDAMENTO'
       end as grupo
  from public.patients p
 where p.secure_token like 'teste-conclusao-%' or p.secure_token like 'teste-nova-%'
 order by p.monitoring_starts_next_day, p.hospital_discharge_date nulls last;

-- 3.2) Medições por paciente e por monitoring_day (esperado: 2 por dia, 1..10,
--      só nos dois concluídos antigos e no "Nova · Concluído"), com a cor
--      derivada de cada turno.
select p.name,
       p.monitoring_starts_next_day as regra_nova,
       v.monitoring_day,
       v.record_date,
       count(*) as medicoes,
       string_agg(v.period || '=' || v.clinical_status, ', ' order by v.period) as status_por_turno
  from public.vital_sign_records v
  join public.patients p on p.id = v.patient_id
 where p.secure_token like 'teste-conclusao-%' or p.secure_token like 'teste-nova-%'
 group by p.name, p.monitoring_starts_next_day, v.monitoring_day, v.record_date
 order by p.monitoring_starts_next_day, p.name, v.monitoring_day;
