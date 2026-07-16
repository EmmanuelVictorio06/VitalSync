-- ============================================================================
-- VitalSync — Gerenciar Usuários: contagem de equipes para Gerente de Equipe
--
-- A tela "Gerenciar Usuários" lê `team_count` da RPC admin_get_users_overview().
-- Antes, a RPC contava apenas:
--   - equipes onde o usuário é cirurgião responsável;
--   - vínculos ativos como médico associado em team_members.
--
-- Gerente de Equipe usa outra relação: team_manager_surgeons liga o gerente ao
-- cirurgião, e as equipes ficam em medical_teams.main_surgeon_id. Esta migration
-- inclui esse vínculo no contador sem alterar layout, filtros ou demais regras.
-- ============================================================================

drop function if exists public.admin_get_users_overview();

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
  professional_tag text,
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
         p.avatar_url, p.specialty, p.crm, p.notes, p.professional_tag,
         p.created_at, p.updated_at, u.last_sign_in_at,
         (select count(*) from public.team_members tm where tm.doctor_id = p.id and tm.status = 'ACTIVE')
         + (select count(*) from public.medical_teams mt where mt.main_surgeon_id = p.id)
         + (
           select count(distinct mt.id)
           from public.team_manager_surgeons tms
           join public.medical_teams mt on mt.main_surgeon_id = tms.surgeon_id
           where tms.team_manager_id = p.id
             and tms.is_active
         ) as team_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.name;
end;
$$;

grant execute on function public.admin_get_users_overview() to authenticated;
