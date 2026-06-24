-- ============================================================================
-- VitalSync — Cadastro de médicos pelo Admin (cria conta de login + perfil)
--
-- Criar usuários do Auth exige privilégio elevado: fazemos por função
-- SECURITY DEFINER que valida `is_admin()` e insere em auth.users/identities +
-- public.profiles. O e-mail/senha servem para LOGIN; o telefone fica no perfil
-- para os alertas de WhatsApp (envio real via Edge Function no futuro).
-- Rode no SQL Editor após 0001..0003.
-- ============================================================================

create or replace function public.admin_create_doctor(
  p_name     text,
  p_email    text,
  p_password text,
  p_whatsapp text,
  p_role     text
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem cadastrar médicos.';
  end if;
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do médico.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'A senha deve ter ao menos 6 caracteres.'; end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Já existe um usuário com este e-mail.';
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

  -- O trigger handle_new_user pode já ter criado o profile; garantimos os dados.
  insert into public.profiles (id, name, email, whatsapp, role)
  values (v_id, p_name, v_email, nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''), p_role::public.user_role)
  on conflict (id) do update set name = excluded.name, whatsapp = excluded.whatsapp, role = excluded.role;

  return v_id;
end;
$$;

grant execute on function public.admin_create_doctor(text, text, text, text, text) to authenticated;
