-- ============================================================================
-- VitalSync — Gerente de Equipe: schema completo
--
-- Depende de: 0029 (TEAM_MANAGER no enum user_role).
-- ADITIVO e IDEMPOTENTE (usa IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS).
-- Não apaga dados; as policies existentes são substituídas por versões
-- estendidas (OR em vez de substituição de condições de admin/cirurgião).
--
-- Rode no SQL Editor após o 0029.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de vínculo Gerente ↔ Cirurgião
-- ----------------------------------------------------------------------------
create table if not exists public.team_manager_surgeons (
  id              uuid primary key default gen_random_uuid(),
  team_manager_id uuid not null references public.profiles(id) on delete cascade,
  surgeon_id      uuid not null references public.profiles(id) on delete cascade,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Só um vínculo ATIVO por par (gerente, cirurgião).
create unique index if not exists team_manager_surgeons_active_uk
  on public.team_manager_surgeons (team_manager_id, surgeon_id)
  where is_active;

alter table public.team_manager_surgeons enable row level security;
drop policy if exists tms_admin on public.team_manager_surgeons;
create policy tms_admin on public.team_manager_surgeons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- O gerente lê os próprios vínculos.
drop policy if exists tms_own_select on public.team_manager_surgeons;
create policy tms_own_select on public.team_manager_surgeons for select to authenticated
  using (team_manager_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. Trigger de validação em team_manager_surgeons
--    • team_manager_id deve ser TEAM_MANAGER;
--    • surgeon_id deve ser MAIN_SURGEON (pré-0031) ou MEDICAL_SURGEON (pós-0031)
--      — comparação via ::text suporta ambos antes e depois do rename.
-- ----------------------------------------------------------------------------
create or replace function public.validate_team_manager_surgeon()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mgr_role  text;
  v_surg_role text;
begin
  select role::text into v_mgr_role from public.profiles where id = NEW.team_manager_id;
  if v_mgr_role is distinct from 'TEAM_MANAGER' then
    raise exception 'INVALID_MANAGER_ROLE';
  end if;

  select role::text into v_surg_role from public.profiles where id = NEW.surgeon_id;
  if v_surg_role not in ('MAIN_SURGEON', 'MEDICAL_SURGEON') then
    raise exception 'INVALID_SURGEON_ROLE';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_team_manager_surgeon on public.team_manager_surgeons;
create trigger trg_validate_team_manager_surgeon
  before insert or update on public.team_manager_surgeons
  for each row execute function public.validate_team_manager_surgeon();

-- ----------------------------------------------------------------------------
-- 3. Helpers de RLS para o Gerente de Equipe
--    Padrão: role::text para evitar literal de enum (mesmo que is_support() em 0016).
-- ----------------------------------------------------------------------------
create or replace function public.is_team_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'TEAM_MANAGER'
  );
$$;

-- Cirurgiões vinculados ativamente a um gerente.
create or replace function public.get_surgeons_of_manager(p_manager uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select surgeon_id from public.team_manager_surgeons
  where team_manager_id = p_manager and is_active;
$$;

-- O usuário logado é gerente vinculado ao responsável da equipe p_team?
create or replace function public.is_team_manager_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.medical_teams t
    join public.team_manager_surgeons tms
      on tms.surgeon_id = t.main_surgeon_id and tms.is_active
    where t.id = p_team and tms.team_manager_id = auth.uid()
  );
$$;

grant execute on function public.is_team_manager()             to authenticated;
grant execute on function public.get_surgeons_of_manager(uuid) to authenticated;
grant execute on function public.is_team_manager_of(uuid)      to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Policies RLS estendidas
--    Cada política acrescenta OR is_team_manager_of(...) às condições existentes
--    sem remover nenhuma condição anterior.
-- ----------------------------------------------------------------------------

-- equipes: gerente lê as equipes de seus cirurgiões.
drop policy if exists teams_select on public.medical_teams;
create policy teams_select on public.medical_teams for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(id)
    or public.is_team_manager_of(id)
  );

-- membros: gerente lê os membros das equipes vinculadas.
drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
  );

-- pacientes — leitura: gerente vê pacientes das equipes vinculadas.
-- (inclui is_support() de 0016 para não regredir)
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (
    public.is_admin()
    or public.is_support()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
  );

-- pacientes — inserção: muda de cirurgião para GERENTE.
-- (Fase 5 da spec: cirurgião deixa de poder cadastrar pacientes)
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (
    public.is_admin()
    or public.is_team_manager_of(team_id)
  );

-- sinais vitais: gerente lê os da sua faixa de equipes.
drop policy if exists vitals_select on public.vital_sign_records;
create policy vitals_select on public.vital_sign_records for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(
        (select team_id from public.patients p where p.id = patient_id)
    )
    or public.is_team_manager_of(
        (select team_id from public.patients p where p.id = patient_id)
    )
  );

-- alertas — leitura: gerente vê alertas das equipes vinculadas.
drop policy if exists alerts_select on public.clinical_alerts;
create policy alerts_select on public.clinical_alerts for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
  );

-- alertas — marcar atendido: gerente pode atender (escopo de equipe).
drop policy if exists alerts_update on public.clinical_alerts;
create policy alerts_update on public.clinical_alerts for update to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
  )
  with check (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
  );

-- atendimentos: gerente lê/cria pelo escopo de equipe do paciente.
drop policy if exists attendance_rw on public.attendance_confirmations;
create policy attendance_rw on public.attendance_confirmations for all to authenticated
  using (
    public.is_admin()
    or public.is_team_member(
        (select team_id from public.patients p where p.id = patient_id)
    )
    or public.is_team_manager_of(
        (select team_id from public.patients p where p.id = patient_id)
    )
  )
  with check (
    public.is_admin()
    or public.is_team_member(
        (select team_id from public.patients p where p.id = patient_id)
    )
    or public.is_team_manager_of(
        (select team_id from public.patients p where p.id = patient_id)
    )
  );

-- fotos de medição (tabela measurement_photos): gerente lê as suas.
drop policy if exists measurement_photos_select on public.measurement_photos;
create policy measurement_photos_select on public.measurement_photos for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(
        (select team_id from public.patients p where p.id = patient_id)
    )
    or public.is_team_manager_of(
        (select team_id from public.patients p where p.id = patient_id)
    )
  );

-- fotos no Storage (bucket patient-photos): gerente lê as suas via join por paciente.
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
      or public.is_team_manager_of(
          (select p.team_id from public.patients p
            where p.id = nullif((storage.foldername(name))[1], '')::uuid)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Notificação ao adicionar médico à equipe
-- ----------------------------------------------------------------------------
create or replace function public.notify_team_membership_added(p_team uuid, p_doctor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team   public.medical_teams;
  v_doctor public.profiles;
  r        record;
begin
  select * into v_team   from public.medical_teams where id = p_team;
  select * into v_doctor from public.profiles      where id = p_doctor;
  if v_team is null or v_doctor is null then return; end if;

  -- Destinatários: o médico adicionado + responsável da equipe + gerentes vinculados.
  for r in
    select prof.id, prof.name, prof.whatsapp
    from public.profiles prof where prof.id = p_doctor
    union
    select prof.id, prof.name, prof.whatsapp
    from public.profiles prof where prof.id = v_team.main_surgeon_id
    union
    select prof.id, prof.name, prof.whatsapp
    from public.team_manager_surgeons tms
    join public.profiles prof on prof.id = tms.team_manager_id
    where tms.surgeon_id = v_team.main_surgeon_id and tms.is_active
  loop
    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at)
    values
      (null, null, r.id, r.name, r.whatsapp,
       'internal', 'PENDING',
       case
         when r.id = p_doctor
           then format('Você foi adicionado à Equipe nº %s.', v_team.team_number)
         when r.id = v_team.main_surgeon_id
           then format('%s foi adicionado à sua equipe (Equipe nº %s).', v_doctor.name, v_team.team_number)
         else format('%s foi adicionado a uma equipe sob sua gestão (Equipe nº %s).', v_doctor.name, v_team.team_number)
       end,
       'membro_adicionado_equipe', 'production', false, null, null);
  end loop;
end;
$$;

drop trigger if exists trg_notify_team_member_added on public.team_members;
create or replace function public.after_team_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.role_in_team = 'ASSOCIATED_DOCTOR' and NEW.status = 'ACTIVE' then
    perform public.notify_team_membership_added(NEW.team_id, NEW.doctor_id);
  end if;
  return NEW;
end;
$$;
create trigger trg_notify_team_member_added
  after insert on public.team_members
  for each row execute function public.after_team_member_added();

-- ----------------------------------------------------------------------------
-- 6. Fechar brecha M-12: team_members só aceita ASSOCIATED_DOCTOR como role
--    Confirme antes de aplicar: SELECT count(*) FROM team_members
--    WHERE role_in_team <> 'ASSOCIATED_DOCTOR';  → deve retornar 0.
-- ----------------------------------------------------------------------------
do $$ begin
  alter table public.team_members
    add constraint team_members_role_associate_only
    check (role_in_team = 'ASSOCIATED_DOCTOR');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 7. main_surgeon_id passa a ser NOT NULL (M-11)
--    Falha com mensagem clara se houver alguma linha nula (não aplica às cegas).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.medical_teams where main_surgeon_id is null) then
    raise exception
      'Existem equipes sem cirurgião responsável (main_surgeon_id IS NULL). '
      'Resolva antes de aplicar: UPDATE medical_teams SET main_surgeon_id = <uuid> WHERE main_surgeon_id IS NULL;';
  end if;
  alter table public.medical_teams
    alter column main_surgeon_id set not null;
exception when others then
  if sqlerrm like '%already%not null%' or sqlerrm like '%does not have a default%' then null;
  else raise;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. RPC: Admin substitui o Cirurgião Principal de uma equipe
-- ----------------------------------------------------------------------------
create or replace function public.admin_replace_main_surgeon(p_team uuid, p_new_surgeon uuid)
returns public.medical_teams
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
  v_team public.medical_teams;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_new_surgeon is null then raise exception 'SURGEON_REQUIRED'; end if;

  select role into v_role
  from public.profiles
  where id = p_new_surgeon and status = 'ACTIVE';

  -- Aceita tanto o valor pré-rename (MAIN_SURGEON) quanto o pós-rename (MEDICAL_SURGEON).
  if v_role::text not in ('MAIN_SURGEON', 'MEDICAL_SURGEON') then
    raise exception 'INVALID_SURGEON_ROLE';
  end if;

  update public.medical_teams
  set main_surgeon_id = p_new_surgeon
  where id = p_team
  returning * into v_team;

  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Se o novo responsável já era associado desta equipe, remove a duplicidade.
  delete from public.team_members
  where team_id = p_team and doctor_id = p_new_surgeon;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  select p.name, p.role::text,
         'REPLACE_MAIN_SURGEON',
         format('Equipe nº %s → novo responsável: %s', v_team.team_number,
                (select name from public.profiles where id = p_new_surgeon))
  from public.profiles p where p.id = auth.uid();

  return v_team;
end;
$$;
grant execute on function public.admin_replace_main_surgeon(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC: Admin vincula um Gerente a um Cirurgião
-- ----------------------------------------------------------------------------
create or replace function public.admin_link_team_manager(p_manager uuid, p_surgeon uuid)
returns public.team_manager_surgeons
language plpgsql security definer set search_path = public as $$
declare
  v_row public.team_manager_surgeons;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  insert into public.team_manager_surgeons (team_manager_id, surgeon_id, created_by)
  values (p_manager, p_surgeon, auth.uid())
  on conflict do nothing
  returning * into v_row;

  -- Se o vínculo já existia mas estava inativo, reativa.
  if v_row is null then
    update public.team_manager_surgeons
       set is_active = true, created_by = auth.uid()
     where team_manager_id = p_manager and surgeon_id = p_surgeon
    returning * into v_row;
  end if;

  return v_row;
end;
$$;
grant execute on function public.admin_link_team_manager(uuid, uuid) to authenticated;

-- RPC: Admin desvincula Gerente de um Cirurgião (inativa o vínculo).
create or replace function public.admin_unlink_team_manager(p_manager uuid, p_surgeon uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.team_manager_surgeons
     set is_active = false
   where team_manager_id = p_manager and surgeon_id = p_surgeon;
end;
$$;
grant execute on function public.admin_unlink_team_manager(uuid, uuid) to authenticated;
