-- ============================================================================
-- VitalSync — CPF do paciente como identidade protegida
--
-- O CPF é dado sensível: NUNCA é gravado em texto puro. Guardamos duas formas:
--   • cpf_hash      → HMAC-SHA256(CPF, CPF_PEPPER) — usado para unicidade e para
--                     validar a identidade no link público (comparação).
--   • cpf_encrypted → AES-GCM(CPF, CPF_ENC_KEY) — usado só se for preciso
--                     recuperar/mascarar o CPF (ex.: exibir •••.•••.123-45).
--
-- O cálculo do hash/cripto acontece em ambiente seguro (Edge Function
-- `create-patient`, com os segredos em Supabase Secrets) — nunca no frontend.
-- Aqui só guardamos os valores opacos resultantes.
--
-- Rode no SQL Editor do Supabase após o 0011.
-- ============================================================================

alter table public.patients
  add column if not exists cpf_hash      text,
  add column if not exists cpf_encrypted text;

-- Unicidade do CPF entre pacientes ATIVOS (não deletados). Permite recadastrar
-- a mesma pessoa caso um registro anterior tenha sido excluído logicamente, sem
-- conflitar com o hash preservado no histórico.
create unique index if not exists uq_patients_cpf_hash
  on public.patients(cpf_hash)
  where cpf_hash is not null and deleted_at is null;

comment on column public.patients.cpf_hash is
  'HMAC-SHA256 do CPF (pepper em Edge Function). Opaco: nunca é o CPF em claro.';
comment on column public.patients.cpf_encrypted is
  'CPF cifrado (AES-GCM, chave em Edge Function). Só decifra em ambiente seguro.';
