-- ============================================================================
-- VitalSync — Reverte as regras do "Convidar Profissional" da 0019 anterior
-- para que team_id volte a ser OPCIONAL neste fluxo.
--
-- A associação com equipe fica para a gestão de equipes, onde o cirurgião
-- principal é definido na criação da equipe e os associados são vinculados
-- depois via Gerenciar Equipes.
--
-- Rodar no SQL Editor do Supabase ou via supabase db push.
-- ============================================================================

-- Remove a RPC que listava equipes para o dropdown de convite (não é mais usada).
drop function if exists public.get_teams_for_invite(text);

-- Restaura create_professional_invite para a versão original (0017):
-- team_id é opcional (default null), sem validação de obrigatoriedade
-- e sem verificação de cirurgião por equipe.
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
begin
  if not (public.is_admin() or public.is_support()) then
    raise exception 'Sem permissão para gerar convites.';
  end if;
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido para convite.';
  end if;

  insert into public.professional_invites (role, team_id, invited_phone, invited_email, created_by)
  values (
    p_role, p_team_id,
    nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    auth.uid()
  )
  returning token into v_token;

  return v_token;
end;
$$;

grant execute on function public.create_professional_invite(text, uuid, text, text) to authenticated;
