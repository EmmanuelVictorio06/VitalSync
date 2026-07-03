-- ============================================================================
-- VitalSync — Gerente de Equipe passa a GERENCIAR (não só ler) as equipes dos
-- cirurgiões vinculados: adicionar/remover médico associado e gerar convite.
--
-- ADITIVO: cada policy/RPC abaixo só ACRESCENTA `OR public.is_team_manager_of(...)`
-- às condições já existentes (is_admin / is_main_surgeon_of / is_support). Nenhuma
-- condição anterior é removida. Ver histórico das versões vigentes:
--   - members_admin            → 0001_init.sql (~L265-268)
--   - prof_invites_admin_support / create_professional_invite → última versão
--     vigente em 0031_rename_main_surgeon.sql (~L150-200)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) team_members: gerente vinculado pode add/remover associado da equipe do
--    seu cirurgião (mesma ação que o cirurgião responsável já tinha).
-- ----------------------------------------------------------------------------
drop policy if exists members_admin on public.team_members;
create policy members_admin on public.team_members for all to authenticated
  using (
    public.is_admin()
    or public.is_main_surgeon_of(team_id)
    or public.is_team_manager_of(team_id)
  )
  with check (
    public.is_admin()
    or public.is_main_surgeon_of(team_id)
    or public.is_team_manager_of(team_id)
  );

-- ----------------------------------------------------------------------------
-- 2) professional_invites: leitura/escrita direta também para o gerente
--    vinculado (a RPC abaixo é SECURITY DEFINER, mas isto cobre leituras/updates
--    diretos que já valiam para admin/suporte/cirurgião).
-- ----------------------------------------------------------------------------
drop policy if exists prof_invites_admin_support on public.professional_invites;
create policy prof_invites_admin_support on public.professional_invites for all to authenticated
  using (
    public.is_admin() or public.is_support()
    or (team_id is not null and public.is_main_surgeon_of(team_id))
    or (team_id is not null and public.is_team_manager_of(team_id))
  )
  with check (
    public.is_admin() or public.is_support()
    or (team_id is not null and public.is_main_surgeon_of(team_id))
    or (team_id is not null and public.is_team_manager_of(team_id))
  );

-- ----------------------------------------------------------------------------
-- 3) create_professional_invite: gerente vinculado pode gerar convite de
--    ASSOCIATED_DOCTOR para a equipe do seu cirurgião. Corpo idêntico à versão
--    vigente (0031); só o bloco de permissão ganha o ramo do gerente.
-- ----------------------------------------------------------------------------
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

  -- Permissão: admin/suporte OU cirurgião da equipe OU gerente vinculado a ela
  -- (os dois últimos só para convite de ASSOCIATED_DOCTOR).
  if public.is_admin() or public.is_support() then
    null;
  elsif p_role = 'ASSOCIATED_DOCTOR' and p_team_id is not null
        and (public.is_main_surgeon_of(p_team_id) or public.is_team_manager_of(p_team_id)) then
    null;
  else
    raise exception 'Sem permissão para gerar convites.';
  end if;

  -- Um convite ATIVO por e-mail (expira anteriores não usados do mesmo e-mail).
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
