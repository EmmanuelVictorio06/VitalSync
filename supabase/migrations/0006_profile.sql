-- ============================================================================
-- VitalSync — "Meu Perfil" (dados pessoais, avatar, preferências, conta)
--
-- Acrescenta a profiles os campos do perfil pessoal, cria o bucket de avatares,
-- a tabela de solicitações de conta (desativação) e os gatilhos de segurança:
--   - o usuário NÃO altera a própria role/status (preservados se não-admin);
--   - profiles.updated_at automático;
--   - profiles.email sincronizado a partir do Supabase Auth (auth.users);
--   - auditoria de alterações de perfil e de solicitações de desativação.
-- Senha NUNCA fica no banco — é gerida só pelo Supabase Auth.
-- Rode no SQL Editor após 0001..0005.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles — novos campos do perfil pessoal.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url        text,
  add column if not exists specialty         text,
  add column if not exists crm               text,
  add column if not exists notes             text,
  add column if not exists status            public.entity_status not null default 'ACTIVE',
  add column if not exists notification_prefs jsonb not null default '{}',
  add column if not exists updated_at         timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- Solicitações de conta (ex.: desativação). Aprovação fica a cargo do ADMIN —
-- NUNCA excluímos registros clínicos; no máximo o ADMIN inativa o perfil.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.account_request_type as enum ('DEACTIVATION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_request_status as enum ('PENDING', 'APPROVED', 'REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists public.account_requests (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  type        public.account_request_type   not null default 'DEACTIVATION',
  status      public.account_request_status not null default 'PENDING',
  reason      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create index if not exists idx_account_requests_profile on public.account_requests(profile_id);
create index if not exists idx_account_requests_status on public.account_requests(status);

alter table public.account_requests enable row level security;

-- o usuário vê e cria as suas; o ADMIN vê e resolve todas.
drop policy if exists account_req_select on public.account_requests;
create policy account_req_select on public.account_requests for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
drop policy if exists account_req_insert on public.account_requests;
create policy account_req_insert on public.account_requests for insert to authenticated
  with check (profile_id = auth.uid());
drop policy if exists account_req_admin on public.account_requests;
create policy account_req_admin on public.account_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- Storage — bucket de avatares (leitura pública; escrita só na própria pasta).
-- O caminho começa por <auth.uid()>/... e é isso que guardamos em avatar_url.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 5242880,
        array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects for select
  using (bucket_id = 'profile-avatars');

drop policy if exists avatars_own_write on storage.objects;
create policy avatars_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- Segurança: o usuário não escala a própria role nem muda o próprio status.
-- Para quem NÃO é admin, role/status são preservados no UPDATE (silenciosamente).
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    NEW.role   := OLD.role;
    NEW.status := OLD.status;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

-- ----------------------------------------------------------------------------
-- Sincroniza profiles.email quando o e-mail muda no Auth (imediato ou após a
-- confirmação por e-mail). Mantém Auth e profiles sempre coerentes.
-- ----------------------------------------------------------------------------
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = NEW.email, updated_at = now() where id = NEW.id;
  return NEW;
end;
$$;

drop trigger if exists on_auth_email_changed on auth.users;
create trigger on_auth_email_changed after update of email on auth.users
  for each row when (NEW.email is distinct from OLD.email)
  execute function public.sync_profile_email();

-- ----------------------------------------------------------------------------
-- Auditoria: alteração de perfil + solicitação de desativação (audit_logs de 0003).
-- ----------------------------------------------------------------------------
create or replace function public.log_profile_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text;
begin
  -- só registra mudanças relevantes do perfil pessoal
  if NEW.name = OLD.name and NEW.whatsapp is not distinct from OLD.whatsapp
     and NEW.avatar_url is not distinct from OLD.avatar_url
     and NEW.specialty is not distinct from OLD.specialty
     and NEW.crm is not distinct from OLD.crm
     and NEW.notes is not distinct from OLD.notes
     and NEW.notification_prefs is not distinct from OLD.notification_prefs then
    return NEW;
  end if;

  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();
  if v_name is null then v_name := 'Sistema'; v_role := '—'; end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (v_name, v_role, 'PROFILE_UPDATE', 'Perfil · ' || NEW.name);
  return NEW;
end;
$$;

drop trigger if exists trg_audit_profile on public.profiles;
create trigger trg_audit_profile after update on public.profiles
  for each row execute function public.log_profile_audit();

create or replace function public.log_account_request_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text;
begin
  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = NEW.profile_id;
  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name, '—'), coalesce(v_role, '—'), 'ACCOUNT_DEACTIVATION_REQUEST',
          'Conta · ' || coalesce(v_name, '—'));
  return NEW;
end;
$$;

drop trigger if exists trg_audit_account_request on public.account_requests;
create trigger trg_audit_account_request after insert on public.account_requests
  for each row execute function public.log_account_request_audit();
