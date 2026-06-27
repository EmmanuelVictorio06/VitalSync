-- ============================================================================
-- VitalSync — Limite de tentativas no acesso público do paciente
--
-- Antes de liberar o formulário de medição, o paciente confirma a identidade
-- digitando o CPF (comparado ao cpf_hash na Edge Function `validate-patient-access`).
-- Esta tabela limita tentativas por link (secure_token) para dificultar
-- adivinhação de CPF por força bruta.
--
-- Só o service_role (Edge Function) acessa esta tabela: RLS habilitado SEM
-- políticas → anon/authenticated não leem nem escrevem.
--
-- Rode no SQL Editor do Supabase após o 0012.
-- ============================================================================

create table if not exists public.public_access_attempts (
  token            text primary key,
  attempts         int not null default 0,
  first_attempt_at timestamptz not null default now(),
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.public_access_attempts enable row level security;
-- Sem políticas: nenhuma role além de service_role enxerga a tabela.

comment on table public.public_access_attempts is
  'Rate-limit do gate de CPF no link público. Manipulada só pela Edge Function (service_role).';
