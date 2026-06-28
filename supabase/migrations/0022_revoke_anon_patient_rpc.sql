-- ============================================================================
-- VitalSync — Fase 3 / C-04: CPF como barreira REAL (não só de UI).
--
-- O fluxo público do paciente passa a ser intermediado por Edge Functions
-- (service_role) que revalidam o CPF + rate-limit antes de ler ou gravar:
--   • validate-patient-access  → get_patient_by_token
--   • submit-vital-record      → submit_vital_record
--
-- Aqui REVOGAMOS o acesso anônimo direto às duas RPCs. Importante: além de
-- `anon`, revogamos de `PUBLIC` — funções nascem com EXECUTE para PUBLIC por
-- padrão, e `anon` herda por aí; sem revogar de PUBLIC a revogação de `anon`
-- não teria efeito. Em seguida concedemos EXECUTE explícito a `service_role`
-- (as Edge Functions), preservando o caminho legítimo.
--
-- `authenticated` mantém o grant explícito existente (profissionais logados);
-- nenhuma tela autenticada chama estas RPCs por token hoje.
--
-- ⚠️ ORDEM DE APLICAÇÃO: rode DEPOIS do 0021 (que define a assinatura final de
-- submit_vital_record com 18 argumentos). E faça deploy das Edge Functions
-- (validate-patient-access atualizada + submit-vital-record nova) e do frontend
-- JUNTO com esta migration — senão o envio do paciente para de funcionar.
--
-- ADITIVA e IDEMPOTENTE (revoke/grant são idempotentes). Rode no SQL Editor.
-- ============================================================================

-- get_patient_by_token(text)
revoke execute on function public.get_patient_by_token(text) from public;
revoke execute on function public.get_patient_by_token(text) from anon;
grant  execute on function public.get_patient_by_token(text) to service_role;

-- submit_vital_record(...18 args...) — assinatura final definida no 0021.
revoke execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean
) from public;
revoke execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean
) from anon;
grant execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean
) to service_role;
