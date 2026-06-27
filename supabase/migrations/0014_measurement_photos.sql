-- ============================================================================
-- VitalSync — Fotos de acompanhamento em tabela própria + segurança por equipe
--
-- As fotos da cicatriz operatória e do dreno já são salvas no Storage e
-- referenciadas em vital_sign_records (wound_photo_path / drain_photo_path).
-- Esta migration acrescenta uma tabela measurement_photos (1 linha por foto,
-- com metadados) SEM remover as colunas — compatibilidade total.
--
-- A sincronização é feita por TRIGGER em vital_sign_records (não mexe nas
-- funções submit_vital_record, que estão sobrecarregadas). Assim, qualquer
-- caminho que grave as colunas popula a tabela automaticamente.
--
-- Também endurece a LEITURA do bucket: cada médico só vê fotos de pacientes
-- das equipes em que participa (antes: qualquer autenticado via policy demo).
--
-- Rode no SQL Editor do Supabase após o 0013.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tipo da foto.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.photo_type as enum ('SURGICAL_WOUND', 'DRAIN');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Tabela measurement_photos.
-- ----------------------------------------------------------------------------
create table if not exists public.measurement_photos (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  vital_record_id uuid references public.vital_sign_records(id) on delete cascade,
  photo_type      public.photo_type not null,
  storage_path    text not null,
  file_name       text,
  mime_type       text,
  file_size       int,
  created_at      timestamptz not null default now(),
  -- Uma foto de cada tipo por medição (re-envio atualiza, não duplica).
  unique (vital_record_id, photo_type)
);

create index if not exists idx_measurement_photos_patient on public.measurement_photos(patient_id);
create index if not exists idx_measurement_photos_record  on public.measurement_photos(vital_record_id);

-- ----------------------------------------------------------------------------
-- RLS: leitura por equipe do paciente (ou ADMIN). Inserção só via trigger
-- (SECURITY DEFINER) — nenhuma policy de escrita para authenticated/anon.
-- ----------------------------------------------------------------------------
alter table public.measurement_photos enable row level security;
drop policy if exists measurement_photos_select on public.measurement_photos;
create policy measurement_photos_select on public.measurement_photos for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
  );

-- ----------------------------------------------------------------------------
-- Trigger: espelha as colunas de foto da medição em measurement_photos.
-- ----------------------------------------------------------------------------
create or replace function public.sync_measurement_photos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Cicatriz operatória.
  if new.wound_photo_path is not null then
    insert into public.measurement_photos (patient_id, vital_record_id, photo_type, storage_path, file_name)
    values (new.patient_id, new.id, 'SURGICAL_WOUND', new.wound_photo_path,
            regexp_replace(new.wound_photo_path, '^.*/', ''))
    on conflict (vital_record_id, photo_type)
      do update set storage_path = excluded.storage_path, file_name = excluded.file_name;
  else
    delete from public.measurement_photos
      where vital_record_id = new.id and photo_type = 'SURGICAL_WOUND';
  end if;

  -- Dreno.
  if new.drain_photo_path is not null then
    insert into public.measurement_photos (patient_id, vital_record_id, photo_type, storage_path, file_name)
    values (new.patient_id, new.id, 'DRAIN', new.drain_photo_path,
            regexp_replace(new.drain_photo_path, '^.*/', ''))
    on conflict (vital_record_id, photo_type)
      do update set storage_path = excluded.storage_path, file_name = excluded.file_name;
  else
    delete from public.measurement_photos
      where vital_record_id = new.id and photo_type = 'DRAIN';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_measurement_photos on public.vital_sign_records;
create trigger trg_sync_measurement_photos
  after insert or update of wound_photo_path, drain_photo_path on public.vital_sign_records
  for each row execute function public.sync_measurement_photos();

-- ----------------------------------------------------------------------------
-- Backfill: fotos já existentes nas colunas entram na tabela.
-- ----------------------------------------------------------------------------
insert into public.measurement_photos (patient_id, vital_record_id, photo_type, storage_path, file_name)
select v.patient_id, v.id, 'SURGICAL_WOUND', v.wound_photo_path, regexp_replace(v.wound_photo_path, '^.*/', '')
  from public.vital_sign_records v
  where v.wound_photo_path is not null
on conflict (vital_record_id, photo_type) do nothing;

insert into public.measurement_photos (patient_id, vital_record_id, photo_type, storage_path, file_name)
select v.patient_id, v.id, 'DRAIN', v.drain_photo_path, regexp_replace(v.drain_photo_path, '^.*/', '')
  from public.vital_sign_records v
  where v.drain_photo_path is not null
on conflict (vital_record_id, photo_type) do nothing;

-- ----------------------------------------------------------------------------
-- Storage: endurece a LEITURA do bucket patient-photos por equipe.
-- O caminho começa pelo {patientId}; daí descobrimos a equipe do paciente.
-- (A escrita do paciente anônimo continua via policy do 0002 — endurecer o
-- upload exigiria roteá-lo por Edge Function validando o token; follow-up.)
-- ----------------------------------------------------------------------------
drop policy if exists patient_photos_read on storage.objects;
create policy patient_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-photos'
    and (
      public.is_admin()
      or public.is_team_member(
        (select p.team_id from public.patients p
          where p.id = nullif((storage.foldername(name))[1], '')::uuid)
      )
    )
  );

comment on table public.measurement_photos is
  'Fotos de acompanhamento (cicatriz/dreno) com metadados. Sincronizada por trigger a partir de vital_sign_records.';
