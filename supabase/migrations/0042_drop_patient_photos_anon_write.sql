-- ============================================================================
-- VitalSync — upload do paciente agora passa SÓ pela Edge Function
-- upload-patient-photo (service_role), que revalida token + CPF (mesmo gate
-- de submit-vital-record) e resolve a pasta do paciente no servidor.
--
-- Remove a escrita anon direta no bucket `patient-photos`: a policy da 0020
-- só exigia paciente ATIVO no path — qualquer anon com um UUID válido gravava
-- na pasta dele. Sem a policy, a única porta de entrada é a função.
--
-- A policy authenticated (patient_photos_write) e a LEITURA por equipe
-- (patient_photos_read) permanecem intactas.
-- ============================================================================

drop policy if exists patient_photos_anon_write on storage.objects;
