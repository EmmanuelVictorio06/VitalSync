-- ============================================================================
-- VitalSync — Resumo de prontuário no cadastro do paciente (piloto, ago/2026).
--
-- Novo campo de texto livre e OPCIONAL no cadastro/edição do paciente, para a
-- equipe registrar um breve histórico clínico relevante ao acompanhamento.
-- Exibido no detalhe do paciente (PatientDashboardPage). Gravado/atualizado
-- pelas Edge Functions create-patient/update-patient (service_role) — nunca
-- lido/gravado direto pelo frontend (segue o mesmo padrão dos demais campos
-- de patients).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0048.
-- ============================================================================

alter table public.patients add column if not exists medical_record_summary text;

comment on column public.patients.medical_record_summary is
  'Resumo de prontuário (texto livre, opcional): breve histórico clínico relevante para o acompanhamento, preenchido no cadastro ou na edição do paciente.';
