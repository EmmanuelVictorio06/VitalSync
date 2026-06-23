-- ============================================================================
-- VitalSync — Esquema completo (Vercel + Supabase)
-- Rode no SQL Editor do Supabase (uma vez). Idempotente onde possível.
--
-- Perfis: ADMIN, MAIN_SURGEON, ASSOCIATED_DOCTOR (paciente NÃO faz login).
-- RLS habilitado em todas as tabelas; políticas por perfil/equipe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('ADMIN', 'MAIN_SURGEON', 'ASSOCIATED_DOCTOR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.role_in_team as enum ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.measurement_period as enum ('MORNING', 'NIGHT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.clinical_status as enum ('GREEN', 'YELLOW', 'RED');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Tabelas
-- ----------------------------------------------------------------------------

-- Perfil do usuário autenticado (1:1 com auth.users).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text not null unique,
  whatsapp   text,
  role       public.user_role not null default 'ASSOCIATED_DOCTOR',
  created_at timestamptz not null default now()
);

create table if not exists public.hospitals (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text,
  state      text,
  status     public.entity_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table if not exists public.surgery_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  specialty   text,
  description text,
  status      public.entity_status not null default 'ACTIVE',
  created_at  timestamptz not null default now()
);

create table if not exists public.medical_teams (
  id              uuid primary key default gen_random_uuid(),
  team_number     int not null unique,
  main_surgeon_id uuid references public.profiles(id) on delete set null,
  status          public.entity_status not null default 'ACTIVE',
  created_at      timestamptz not null default now()
);

create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.medical_teams(id) on delete cascade,
  doctor_id    uuid not null references public.profiles(id) on delete cascade,
  role_in_team public.role_in_team not null default 'ASSOCIATED_DOCTOR',
  status       public.entity_status not null default 'ACTIVE',
  created_at   timestamptz not null default now(),
  unique (team_id, doctor_id)
);

create table if not exists public.patients (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  birth_date             date,
  phone                  text,
  surgery_type_id        uuid references public.surgery_types(id),
  surgery_date           date,
  hospital_discharge_date date,
  hospital_id            uuid references public.hospitals(id),
  team_id                uuid not null references public.medical_teams(id),
  secure_token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  status                 public.entity_status not null default 'ACTIVE',
  current_status         public.clinical_status not null default 'GREEN',
  created_at             timestamptz not null default now()
);

create table if not exists public.vital_sign_records (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  record_date        date not null default current_date,
  period             public.measurement_period not null,
  monitoring_day     int,
  temperature        numeric(4,1),
  oxygen_saturation  int,
  systolic_pressure  int,
  diastolic_pressure int,
  heart_rate         int,
  pain_level         int,
  dyspnea_level      int,
  urination_count    int,
  vomiting_count     int,
  has_bleeding       boolean default false,
  steps              int,
  wound_photo_path   text,
  clinical_status    public.clinical_status not null default 'GREEN',
  created_at         timestamptz not null default now(),
  unique (patient_id, record_date, period)
);

create table if not exists public.clinical_alerts (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  team_id         uuid not null references public.medical_teams(id) on delete cascade,
  vital_record_id uuid references public.vital_sign_records(id) on delete cascade,
  status          public.clinical_status not null,
  description     text not null,
  attended        boolean not null default false,
  attended_by     uuid references public.profiles(id),
  attended_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.attendance_confirmations (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  attended_by uuid not null references public.profiles(id),
  attended_at timestamptz not null default now()
);

create table if not exists public.notification_logs (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid references public.patients(id) on delete set null,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_phone     text,
  channel             text not null default 'whatsapp',
  status              text not null default 'pending',
  message             text,
  provider_message_id text,
  error_message       text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create index if not exists idx_team_members_doctor on public.team_members(doctor_id);
create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_patients_team on public.patients(team_id);
create index if not exists idx_vitals_patient on public.vital_sign_records(patient_id);
create index if not exists idx_alerts_team on public.clinical_alerts(team_id);
create index if not exists idx_alerts_attended on public.clinical_alerts(attended);

-- ----------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER) — usadas nas políticas de RLS.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN');
$$;

-- Verdadeiro se o usuário logado é responsável ou associado ATIVO da equipe.
create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.medical_teams t where t.id = p_team and t.main_surgeon_id = auth.uid()
  ) or exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.doctor_id = auth.uid() and m.status = 'ACTIVE'
  );
$$;

create or replace function public.is_main_surgeon_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.medical_teams t where t.id = p_team and t.main_surgeon_id = auth.uid());
$$;

-- Cria o profile automaticamente quando um usuário é criado no Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'ASSOCIATED_DOCTOR')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- RLS — habilita e define políticas (nível demo; comentários indicam o que
-- endurecer em produção).
-- ----------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.hospitals              enable row level security;
alter table public.surgery_types          enable row level security;
alter table public.medical_teams          enable row level security;
alter table public.team_members           enable row level security;
alter table public.patients               enable row level security;
alter table public.vital_sign_records     enable row level security;
alter table public.clinical_alerts        enable row level security;
alter table public.attendance_confirmations enable row level security;
alter table public.notification_logs      enable row level security;

-- profiles: autenticados leem (nomes p/ listas); cada um edita o seu; admin tudo.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- catálogos: leitura para autenticados; escrita só ADMIN.
drop policy if exists hospitals_read on public.hospitals;
create policy hospitals_read on public.hospitals for select to authenticated using (true);
drop policy if exists hospitals_admin on public.hospitals;
create policy hospitals_admin on public.hospitals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists surgery_read on public.surgery_types;
create policy surgery_read on public.surgery_types for select to authenticated using (true);
drop policy if exists surgery_admin on public.surgery_types;
create policy surgery_admin on public.surgery_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- equipes: ADMIN tudo; membros leem a própria.
drop policy if exists teams_select on public.medical_teams;
create policy teams_select on public.medical_teams for select to authenticated
  using (public.is_admin() or public.is_team_member(id));
drop policy if exists teams_admin on public.medical_teams;
create policy teams_admin on public.medical_teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- membros: ADMIN gerencia; membros leem os da própria equipe.
drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
  using (public.is_admin() or public.is_team_member(team_id));
drop policy if exists members_admin on public.team_members;
create policy members_admin on public.team_members for all to authenticated
  using (public.is_admin() or public.is_main_surgeon_of(team_id))
  with check (public.is_admin() or public.is_main_surgeon_of(team_id));

-- pacientes: ADMIN tudo; equipe lê os seus; cirurgião responsável cadastra.
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (public.is_admin() or public.is_team_member(team_id));
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (public.is_admin() or public.is_main_surgeon_of(team_id));
drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients for update to authenticated
  using (public.is_admin() or public.is_main_surgeon_of(team_id))
  with check (public.is_admin() or public.is_main_surgeon_of(team_id));
drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients for delete to authenticated
  using (public.is_admin() or public.is_main_surgeon_of(team_id));

-- sinais vitais: leitura por equipe. INSERÇÃO do paciente (anônimo) vai por
-- Edge Function (service_role) validando o secure_token — sem policy anon aqui.
drop policy if exists vitals_select on public.vital_sign_records;
create policy vitals_select on public.vital_sign_records for select to authenticated
  using (public.is_admin() or public.is_team_member((select team_id from public.patients p where p.id = patient_id)));

-- alertas: leitura por equipe; marcar atendido (update) por membro da equipe.
drop policy if exists alerts_select on public.clinical_alerts;
create policy alerts_select on public.clinical_alerts for select to authenticated
  using (public.is_admin() or public.is_team_member(team_id));
drop policy if exists alerts_update on public.clinical_alerts;
create policy alerts_update on public.clinical_alerts for update to authenticated
  using (public.is_admin() or public.is_team_member(team_id))
  with check (public.is_admin() or public.is_team_member(team_id));

-- atendimentos: leitura/escrita por membro da equipe do paciente.
drop policy if exists attendance_rw on public.attendance_confirmations;
create policy attendance_rw on public.attendance_confirmations for all to authenticated
  using (public.is_admin() or public.is_team_member((select team_id from public.patients p where p.id = patient_id)))
  with check (public.is_admin() or public.is_team_member((select team_id from public.patients p where p.id = patient_id)));

-- logs de notificação: ADMIN lê tudo; demais via Edge Function (service_role).
drop policy if exists notif_admin_read on public.notification_logs;
create policy notif_admin_read on public.notification_logs for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- Storage — bucket privado para fotos da ferida/dreno.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-photos', 'patient-photos', false, 10485760,
        array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- DEMO: qualquer usuário autenticado lê/escreve no bucket. EM PRODUÇÃO,
-- restringir por equipe (ex.: comparar o prefixo do path com os pacientes da
-- equipe) e fazer o upload do paciente via Edge Function (service_role).
drop policy if exists patient_photos_read on storage.objects;
create policy patient_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'patient-photos');
drop policy if exists patient_photos_write on storage.objects;
create policy patient_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-photos');
