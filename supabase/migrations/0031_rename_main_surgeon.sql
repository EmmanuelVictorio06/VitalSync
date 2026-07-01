-- ============================================================================
-- VitalSync — Renomeia MAIN_SURGEON → MEDICAL_SURGEON no enum user_role
--
-- Objetivo: separar "tipo de médico" (profiles.role) do "papel na equipe"
-- (team_members.role_in_team). Depois disto, um MEDICAL_SURGEON pode ser
-- associado em outra equipe sem conflito de nomenclatura.
--
-- ALTER TYPE ... RENAME VALUE não move dados: todas as linhas de profiles
-- com role='MAIN_SURGEON' passam automaticamente a role='MEDICAL_SURGEON'.
-- As funções PL/pgSQL que comparam role = 'MAIN_SURGEON' (literal de enum)
-- são recriadas aqui (CREATE OR REPLACE) para usar 'MEDICAL_SURGEON'.
--
-- O enum role_in_team NÃO é alterado: seus valores 'MAIN_SURGEON' /
-- 'ASSOCIATED_DOCTOR' são conceitos diferentes (papel dentro da equipe).
-- A tabela professional_invites.role (text) também NÃO é alterada.
--
-- ADITIVO e IDEMPOTENTE. Rode no SQL Editor após o 0030.
-- ============================================================================

-- 1. Renomear o valor (idempotente: só executa se ainda existir 'MAIN_SURGEON').
do $$ begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'MAIN_SURGEON'
  ) then
    execute 'alter type public.user_role rename value ''MAIN_SURGEON'' to ''MEDICAL_SURGEON''';
  end if;
end $$;

-- 2. Recriar surgeon_create_team() usando 'MEDICAL_SURGEON'.
create or replace function public.surgeon_create_team()
returns public.medical_teams
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role;
  v_num  int;
  v_team public.medical_teams;
  v_try  int := 0;
begin
  select role into v_role from public.profiles where id = v_uid;
  if not (public.is_admin() or v_role = 'MEDICAL_SURGEON') then
    raise exception 'FORBIDDEN';
  end if;

  if public.count_active_teams_by_surgeon(v_uid) >= 5 then
    raise exception 'TEAM_LIMIT_REACHED';
  end if;

  loop
    v_try := v_try + 1;
    select coalesce(max(team_number), 0) + 1 into v_num from public.medical_teams;
    begin
      insert into public.medical_teams (team_number, main_surgeon_id, status)
      values (v_num, v_uid, 'ACTIVE')
      returning * into v_team;
      return v_team;
    exception when unique_violation then
      if v_try >= 25 then raise; end if;
    end;
  end loop;
end;
$$;

-- 3. Recriar admin_create_user() aceitando MEDICAL_SURGEON e TEAM_MANAGER
--    (remove MAIN_SURGEON da lista, que deixou de existir no enum).
create or replace function public.admin_create_user(
  p_name      text,
  p_email     text,
  p_password  text,
  p_whatsapp  text,
  p_role      text,
  p_status    text default 'ACTIVE',
  p_specialty text default null,
  p_crm       text default null,
  p_notes     text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para realizar esta ação.';
  end if;
  if p_role not in ('ADMIN', 'MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR', 'SUPPORT', 'TEAM_MANAGER') then
    raise exception 'Papel inválido.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do usuário.'; end if;
  if v_email = '' then raise exception 'Informe um e-mail válido.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'A senha deve ter ao menos 6 caracteres.'; end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Este e-mail já está em uso.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', p_name, 'role', p_role),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_email, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    now(), now(), now()
  );

  insert into public.profiles (id, name, email, whatsapp, role, status, specialty, crm, notes)
  values (
    v_id, p_name, v_email,
    nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''),
    p_role::public.user_role,
    coalesce(nullif(p_status, ''), 'ACTIVE')::public.entity_status,
    nullif(trim(coalesce(p_specialty, '')), ''),
    nullif(trim(coalesce(p_crm, '')), ''),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  on conflict (id) do update set
    name = excluded.name, whatsapp = excluded.whatsapp, role = excluded.role,
    status = excluded.status, specialty = excluded.specialty, crm = excluded.crm, notes = excluded.notes;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  select p.name, p.role::text, 'USER_CREATE', 'Usuário · ' || p_name
  from public.profiles p where p.id = auth.uid();

  return v_id;
end;
$$;

-- 4. Recriar policy teams_surgeon_update usando MEDICAL_SURGEON.
--    (is_main_surgeon_of() compara main_surgeon_id = auth.uid(), sem literal de enum —
--    não precisa de update. Apenas a policy que verifica o papel muda.)
drop policy if exists teams_surgeon_update on public.medical_teams;
create policy teams_surgeon_update on public.medical_teams for update to authenticated
  using (public.is_admin() or public.is_main_surgeon_of(id))
  with check (public.is_admin() or public.is_main_surgeon_of(id));

-- 5. Recriar prof_invites policy para incluir is_main_surgeon_of (sem literal enum).
--    (já usa is_main_surgeon_of, que não compara literal — só confirmação)
drop policy if exists prof_invites_admin_support on public.professional_invites;
create policy prof_invites_admin_support on public.professional_invites for all to authenticated
  using (public.is_admin() or public.is_support() or (team_id is not null and public.is_main_surgeon_of(team_id)))
  with check (public.is_admin() or public.is_support() or (team_id is not null and public.is_main_surgeon_of(team_id)));

-- 6. create_professional_invite(): mantém p_role in ('MAIN_SURGEON','ASSOCIATED_DOCTOR')
--    pois esse campo é o role_in_team do convite (enum diferente), não profiles.role.
--    Recriar só para compatibilidade com o novo check de papel do chamador.
create or replace function public.create_professional_invite(
  p_role    text,
  p_team_id uuid default null,
  p_phone   text default null,
  p_email   text default null
)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido para convite.';
  end if;

  if public.is_admin() or public.is_support() then
    null;
  elsif p_role = 'ASSOCIATED_DOCTOR' and p_team_id is not null and public.is_main_surgeon_of(p_team_id) then
    null;
  else
    raise exception 'Sem permissão para gerar convites.';
  end if;

  if v_email is not null then
    update public.professional_invites
       set expires_at = now()
     where invited_email = v_email and used_at is null and expires_at > now();
  end if;

  insert into public.professional_invites (role, team_id, invited_phone, invited_email, created_by)
  values (
    p_role, p_team_id,
    nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    v_email,
    auth.uid()
  )
  returning token into v_token;

  return v_token;
end;
$$;
grant execute on function public.create_professional_invite(text, uuid, text, text) to authenticated;
