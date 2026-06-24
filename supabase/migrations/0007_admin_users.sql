-- ============================================================================
-- VitalSync — "Gerenciar Usuários" (Admin): RPCs administrativas + proteções
--
-- Operações sensíveis sobre contas (criar no Auth, trocar e-mail/senha, excluir)
-- exigem privilégio elevado. Em vez de expor a service_role no frontend, usamos
-- funções SECURITY DEFINER que validam `is_admin()` — mesmo padrão de 0004.
--   - admin_create_user        : cria conta de login + profile (qualquer role)
--   - admin_update_user_email  : troca o e-mail no Auth (profiles sincroniza via 0006)
--   - admin_set_user_password  : define senha temporária
--   - admin_delete_user        : exclui DEFINITIVO só sem vínculos (senão erra)
--   - admin_get_users_overview : lista p/ a tela (inclui último acesso + nº equipes)
-- + trigger protect_last_admin: nunca rebaixa/inativa o ÚNICO admin ativo.
-- Rode no SQL Editor após 0001..0006.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Cria usuário (conta de login no Auth + profile). Qualquer role de usuário do
-- sistema (ADMIN/MAIN_SURGEON/ASSOCIATED_DOCTOR) — paciente NÃO entra aqui.
-- ----------------------------------------------------------------------------
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
  if p_role not in ('ADMIN', 'MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
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

  -- O trigger handle_new_user pode já ter criado o profile; completamos os dados.
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

grant execute on function public.admin_create_user(text, text, text, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Troca o e-mail de login (Auth). profiles.email é sincronizado pelo gatilho
-- on_auth_email_changed (0006). Confirmamos o e-mail (demo) para login imediato.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_user_email(p_user_id uuid, p_new_email text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_email text := lower(trim(p_new_email));
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para realizar esta ação.';
  end if;
  if v_email = '' then raise exception 'Informe um e-mail válido.'; end if;
  if exists (select 1 from auth.users where email = v_email and id <> p_user_id) then
    raise exception 'Este e-mail já está em uso.';
  end if;

  update auth.users
     set email = v_email, email_confirmed_at = now(), updated_at = now()
   where id = p_user_id;

  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_email)), updated_at = now()
   where user_id = p_user_id and provider = 'email';
end;
$$;

grant execute on function public.admin_update_user_email(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Define uma senha temporária para o usuário (Auth). Senha nunca fica em profiles.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_user_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para realizar esta ação.';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'A senha deve ter ao menos 6 caracteres.'; end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   where id = p_user_id;
end;
$$;

grant execute on function public.admin_set_user_password(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Exclusão DEFINITIVA — só quando o usuário não tem nenhum vínculo/registro.
-- Caso contrário levanta 'HAS_LINKS' e o frontend apenas INATIVA (soft delete).
-- Apaga de auth.users (cascateia para profiles).
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para realizar esta ação.';
  end if;

  -- nunca remover o único administrador ativo
  if exists (select 1 from public.profiles where id = p_user_id and role = 'ADMIN')
     and (select count(*) from public.profiles where role = 'ADMIN' and status = 'ACTIVE') <= 1 then
    raise exception 'Não é possível excluir o único administrador ativo.';
  end if;

  if exists (select 1 from public.team_members where doctor_id = p_user_id)
     or exists (select 1 from public.medical_teams where main_surgeon_id = p_user_id)
     or exists (select 1 from public.clinical_alerts where attended_by = p_user_id)
     or exists (select 1 from public.attendance_confirmations where attended_by = p_user_id) then
    raise exception 'HAS_LINKS';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Lista de usuários para a tela (último acesso + nº de equipes vinculadas).
-- Lê auth.users (last_sign_in_at) com segurança via SECURITY DEFINER.
-- ----------------------------------------------------------------------------
create or replace function public.admin_get_users_overview()
returns table (
  id            uuid,
  name          text,
  email         text,
  whatsapp      text,
  role          text,
  status        text,
  avatar_url    text,
  specialty     text,
  crm           text,
  notes         text,
  created_at    timestamptz,
  updated_at    timestamptz,
  last_sign_in_at timestamptz,
  team_count    bigint
)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para acessar esta página.';
  end if;

  return query
  select p.id, p.name, p.email, p.whatsapp, p.role::text, p.status::text,
         p.avatar_url, p.specialty, p.crm, p.notes,
         p.created_at, p.updated_at, u.last_sign_in_at,
         (select count(*) from public.team_members tm where tm.doctor_id = p.id and tm.status = 'ACTIVE')
         + (select count(*) from public.medical_teams mt where mt.main_surgeon_id = p.id) as team_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.name;
end;
$$;

grant execute on function public.admin_get_users_overview() to authenticated;

-- ----------------------------------------------------------------------------
-- Protege o ÚLTIMO administrador ativo: bloqueia rebaixar a role ou inativar
-- quando ele é o único ADMIN ativo restante. Vale para qualquer caminho de UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.role = 'ADMIN' and OLD.status = 'ACTIVE'
     and (NEW.role <> 'ADMIN' or NEW.status <> 'ACTIVE')
     and (select count(*) from public.profiles where role = 'ADMIN' and status = 'ACTIVE') <= 1 then
    raise exception 'Não é possível inativar ou rebaixar o único administrador ativo.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_last_admin on public.profiles;
create trigger trg_protect_last_admin before update on public.profiles
  for each row execute function public.protect_last_admin();

-- ----------------------------------------------------------------------------
-- Auditoria de alteração de papel/status feita pelo Admin (audit_logs de 0003).
-- ----------------------------------------------------------------------------
create or replace function public.log_user_admin_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_action text; v_entity text;
begin
  if NEW.role is not distinct from OLD.role and NEW.status is not distinct from OLD.status then
    return NEW; -- nada relevante p/ esta trilha
  end if;

  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();
  if v_name is null then v_name := 'Sistema'; v_role := '—'; end if;

  if NEW.role is distinct from OLD.role then
    v_action := 'USER_ROLE_CHANGE';
    v_entity := 'Usuário · ' || NEW.name || ' (' || OLD.role::text || ' → ' || NEW.role::text || ')';
  else
    v_action := 'DELETE_OR_INACTIVATE';
    v_entity := 'Usuário · ' || NEW.name || (case when NEW.status = 'INACTIVE' then ' — inativado' else ' — ativado' end);
  end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (v_name, v_role, v_action, v_entity);
  return NEW;
end;
$$;

drop trigger if exists trg_audit_user_admin on public.profiles;
create trigger trg_audit_user_admin after update on public.profiles
  for each row execute function public.log_user_admin_audit();
