-- ============================================================================
-- Migration: 0041_fix_patient_photos_read
--
-- BUG (desde a 0014, copiado pela 0030): a policy patient_photos_read usava
-- `storage.foldername(name)` DENTRO de uma subquery `from public.patients p`.
-- Pelo escopo do SQL, o `name` não-qualificado resolve para a relação mais
-- interna — patients.name (o NOME DA PESSOA, ex. "Marcos Oliveira") — e não
-- para storage.objects.name (o caminho do arquivo). Como um nome de pessoa não
-- tem '/', foldername() devolve vazio → uuid NULL → is_team_member(NULL) =
-- false. Efeito: NENHUM médico (nem o gerente) conseguia ler as fotos da
-- ferida/dreno — só ADMIN (que curto-circuita no is_admin()). No front o erro
-- era engolido pelos catch vazios e aparecia como "Falha ao carregar".
--
-- FIX: recria a policy usando os helpers da 0020 (storage_patient_id +
-- patient_team_id), com a coluna qualificada (objects.name) — sem ambiguidade.
-- Mesmo escopo pretendido: ADMIN, membro da equipe do paciente e gerente
-- vinculado. A policy de INSERT (0020) não é tocada — já estava correta.
--
-- ADITIVA e IDEMPOTENTE. Rode no SQL Editor após a 0040.
-- ============================================================================

drop policy if exists patient_photos_read on storage.objects;
create policy patient_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-photos'
    and (
      public.is_admin()
      or public.is_team_member(
           public.patient_team_id(public.storage_patient_id(objects.name)))
      or public.is_team_manager_of(
           public.patient_team_id(public.storage_patient_id(objects.name)))
    )
  );
