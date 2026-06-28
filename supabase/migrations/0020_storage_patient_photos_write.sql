-- ============================================================================
-- VitalSync — Fase 1 / C-05: escrita no bucket `patient-photos` restrita ao
-- prefixo do paciente correto.
--
-- PROBLEMA: as policies de INSERT do bucket (0001 patient_photos_write p/
-- authenticated; 0002 patient_photos_anon_write p/ anon) só checavam
-- `bucket_id = 'patient-photos'`, permitindo subir arquivo em QUALQUER pasta —
-- inclusive na de outro paciente. Os uploads usam o caminho
-- "{patientId}/<arquivo>" (frontend/src/services/storageService.uploadPatientPhoto),
-- então passamos a exigir que o 1º segmento do path seja um paciente válido:
--   • anon          → paciente ATIVO existente (o gate por secure_token continua
--                     no app; ver nota de arquitetura abaixo);
--   • authenticated → ADMIN ou membro da equipe do paciente.
--
-- A LEITURA por equipe (patient_photos_read, 0014) permanece INTACTA.
--
-- DECISÃO DE ARQUITETURA (Opção 2 da spec — endurecimento de policy):
--   Implementada aqui por NÃO exigir deploy de função nova nem alterar o fluxo
--   de upload existente. A Opção 1 (mais segura) — rotear o upload do paciente
--   por uma Edge Function service_role que valida o secure_token e grava em
--   {patientId}/... — fica como FOLLOW-UP recomendado.
--   -- PENDENTE DECISÃO DO DONO: migrar para Opção 1 (upload via Edge Function).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0019.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers SECURITY DEFINER: o papel `anon` NÃO lê public.patients sob RLS; por
-- isso a verificação é encapsulada em funções definer (mesmo padrão de
-- is_team_member / is_admin nas migrations 0001).
-- ----------------------------------------------------------------------------
create or replace function public.is_active_patient(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.patients
    where id = p_id and status = 'ACTIVE' and deleted_at is null
  );
$$;

create or replace function public.patient_team_id(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.patients where id = p_id;
$$;

-- Extrai o {patientId} (1º segmento do path) com segurança: NULL quando não for
-- um uuid válido, evitando erro de cast dentro da policy.
create or replace function public.storage_patient_id(p_name text)
returns uuid language plpgsql immutable as $$
declare
  v uuid;
begin
  begin
    v := nullif((storage.foldername(p_name))[1], '')::uuid;
  exception when others then
    return null;
  end;
  return v;
end;
$$;

grant execute on function public.is_active_patient(uuid)  to anon, authenticated;
grant execute on function public.patient_team_id(uuid)    to authenticated;
grant execute on function public.storage_patient_id(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Policy de INSERT (anon): paciente anônimo só sobe foto na pasta de um paciente
-- ATIVO existente. (is_active_patient(NULL) → false → negado.)
-- ----------------------------------------------------------------------------
drop policy if exists patient_photos_anon_write on storage.objects;
create policy patient_photos_anon_write on storage.objects for insert to anon
  with check (
    bucket_id = 'patient-photos'
    and public.is_active_patient(public.storage_patient_id(name))
  );

-- ----------------------------------------------------------------------------
-- Policy de INSERT (authenticated): ADMIN ou membro da equipe do paciente.
-- (is_team_member(NULL) → false → negado.)
-- ----------------------------------------------------------------------------
drop policy if exists patient_photos_write on storage.objects;
create policy patient_photos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-photos'
    and (
      public.is_admin()
      or public.is_team_member(public.patient_team_id(public.storage_patient_id(name)))
    )
  );
