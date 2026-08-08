-- ============================================================================
-- Migration: 0059_vital_sign_records_source
--
-- Rastreabilidade da origem da medição: até aqui toda linha de
-- vital_sign_records vinha do próprio paciente (fluxo público por token). A
-- partir de agora a equipe (enfermagem/médico) também pode lançar, em nome
-- do paciente, o período de HOJE que ele esqueceu (ver 0062,
-- staff_insert_vital_record). `source` distingue as duas origens;
-- `entered_by_profile_id` identifica quem lançou quando source=STAFF.
--
-- `create type` de um enum NOVO pode conviver, na mesma transação, com o
-- código que já usa esse valor — diferente do caso `alter type ... add value`
-- em um enum EXISTENTE (ver 0054), que exige migration isolada. Ainda assim
-- este arquivo fica isolado por clareza narrativa, seguindo a convenção do
-- repositório de migrations pequenas e numeradas.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0058.
-- ============================================================================

do $$ begin
  create type public.vital_record_source as enum ('PATIENT', 'STAFF');
exception when duplicate_object then null; end $$;

alter table public.vital_sign_records
  add column if not exists source public.vital_record_source not null default 'PATIENT',
  add column if not exists entered_by_profile_id uuid references public.profiles(id);

comment on column public.vital_sign_records.source is
  'PATIENT = enviado pelo próprio paciente (fluxo padrão por token). STAFF = preenchido pela equipe (enfermagem/médico) quando o paciente esqueceu o período de hoje.';
comment on column public.vital_sign_records.entered_by_profile_id is
  'Quando source=STAFF: profissional (profiles.id) que registrou a medição em nome do paciente.';

create index if not exists idx_vital_sign_records_source
  on public.vital_sign_records(source) where source = 'STAFF';
