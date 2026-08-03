-- ============================================================================
-- VitalSync — Fase 2 de conformidade com o Fluxo Operacional do estudo piloto:
-- variáveis clínicas/cirúrgicas do cadastro (protocolo 5.9, 5.6.4, 5.14).
--
-- Campos novos em `patients`, todos OPCIONAIS (mesmo padrão de
-- medical_record_summary — texto/dado estruturado simples, sem cifra, pois
-- não são tão sensíveis quanto CPF):
--
--   - sex: sexo do paciente ('M'/'F'), variável demográfica do estudo.
--   - weight_kg / height_cm: peso e altura — o IMC é calculado sob demanda no
--     frontend (não armazenamos um valor derivado que poderia divergir).
--   - comorbidities: lista de comorbidades em jsonb (array de texto livre).
--     Não travamos em categorias fixas — o protocolo não define uma
--     taxonomia fechada que pudéssemos conferir aqui; fica estruturado
--     (consultável/exportável) sem inventar um vocabulário clínico.
--   - length_of_stay_days: tempo de internação (dias), informado pela equipe.
--   - alternative_phone: contato alternativo exigido na inclusão (5.6.4).
--   - tcle_accepted_at: data de assinatura do TCLE (5.14).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0051.
-- ============================================================================

alter table public.patients add column if not exists sex text;
alter table public.patients add column if not exists weight_kg numeric;
alter table public.patients add column if not exists height_cm numeric;
alter table public.patients add column if not exists comorbidities jsonb not null default '[]'::jsonb;
alter table public.patients add column if not exists length_of_stay_days int;
alter table public.patients add column if not exists alternative_phone text;
alter table public.patients add column if not exists tcle_accepted_at date;

-- `check` idempotente: remove se já existir (ex.: reaplicação manual) antes de recriar.
alter table public.patients drop constraint if exists patients_sex_check;
alter table public.patients add constraint patients_sex_check check (sex is null or sex in ('M', 'F'));

comment on column public.patients.sex is 'Sexo do paciente (M/F) — variável demográfica do estudo (protocolo 5.9).';
comment on column public.patients.weight_kg is 'Peso em kg — usado para calcular o IMC sob demanda (não armazenado).';
comment on column public.patients.height_cm is 'Altura em cm — usado para calcular o IMC sob demanda (não armazenado).';
comment on column public.patients.comorbidities is 'Lista de comorbidades (array de texto livre, jsonb) — variável do estudo (protocolo 5.9).';
comment on column public.patients.length_of_stay_days is 'Tempo de internação hospitalar em dias — variável de desfecho do estudo (protocolo 5.9).';
comment on column public.patients.alternative_phone is 'Contato alternativo exigido na inclusão do paciente (protocolo 5.6.4).';
comment on column public.patients.tcle_accepted_at is 'Data de assinatura do Termo de Consentimento Livre e Esclarecido (protocolo 5.14).';
