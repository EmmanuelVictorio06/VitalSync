-- ============================================================================
-- VitalSync — Fecha o buraco do papel de Enfermagem na RPC legada
-- `admin_create_user` (guard de papel estava fixo sem NURSING_PROFESSIONAL).
--
-- CONTEXTO: o frontend cria usuários pela Edge Function `admin-create-user`
-- (auth.admin.createUser), NÃO por esta RPC — que ficou como legado (C-06).
-- Mas a RPC ainda existe no banco e seu `p_role not in (...)` rejeitava
-- 'NURSING_PROFESSIONAL' com "Papel inválido.". Esta migration só acrescenta o
-- novo papel ao guard; o corpo é idêntico ao definido na 0031 (nada mais muda).
--
-- Requer que o valor de enum já exista (migration 0054). ADITIVA e IDEMPOTENTE
-- (create or replace). Rode após a 0055.
-- ============================================================================

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
  -- Único ponto alterado vs 0031: inclui 'NURSING_PROFESSIONAL'.
  if p_role not in ('ADMIN', 'MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR', 'SUPPORT', 'TEAM_MANAGER', 'NURSING_PROFESSIONAL') then
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
