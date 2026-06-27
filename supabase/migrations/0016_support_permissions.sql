-- ============================================================================
-- VitalSync — Permissões do perfil SUPPORT (Suporte)
--
-- O Suporte é um perfil operacional, NÃO clínico. Pode:
--   • visualizar e buscar pacientes;
--   • editar o telefone de contato do paciente (RPC dedicada);
--   • ver os logs de WhatsApp (status básico das notificações).
-- NÃO pode (garantido pelo backend): excluir paciente, ver/alterar sinais
-- vitais, alertas clínicos ou fotos sensíveis, atender alertas, gerenciar
-- equipes/usuários, exportar dados sensíveis.
--
-- Observação: is_support() compara role::text (evita literal de enum, à prova
-- de transação após o 0015).
--
-- Rode no SQL Editor do Supabase após o 0015.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: usuário logado é Suporte?
-- ----------------------------------------------------------------------------
create or replace function public.is_support()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'SUPPORT'
  );
$$;

-- ----------------------------------------------------------------------------
-- Leitura de pacientes: ADMIN, equipe do paciente, ou SUPORTE.
-- (Suporte vê a lista/cadastro, NÃO os sinais vitais nem as fotos.)
-- ----------------------------------------------------------------------------
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (public.is_admin() or public.is_support() or public.is_team_member(team_id));

-- ----------------------------------------------------------------------------
-- Logs de notificação (status do WhatsApp): ADMIN e SUPORTE leem.
-- ----------------------------------------------------------------------------
drop policy if exists notif_admin_read on public.notification_logs;
create policy notif_admin_read on public.notification_logs for select to authenticated
  using (public.is_admin() or public.is_support());

-- ----------------------------------------------------------------------------
-- Suporte (ou Admin) edita SOMENTE o telefone de contato do paciente.
-- Centraliza a regra; nunca toca em dados clínicos.
-- ----------------------------------------------------------------------------
create or replace function public.support_update_patient_phone(p_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_support()) then
    raise exception 'Sem permissão para editar o contato do paciente.';
  end if;
  update public.patients
     set phone = nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '')
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'Paciente não encontrado.';
  end if;
end;
$$;

grant execute on function public.support_update_patient_phone(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_create_user: passa a aceitar o papel SUPPORT (mesma lógica do 0007,
-- apenas a lista de papéis válidos muda).
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
  if p_role not in ('ADMIN', 'MAIN_SURGEON', 'ASSOCIATED_DOCTOR', 'SUPPORT') then
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
