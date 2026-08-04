-- ============================================================================
-- VitalSync - Gerenciar Usuarios: contagem de equipes para Enfermagem
--
-- A tela "Gerenciar Usuarios" le `team_count` da RPC
-- admin_get_users_overview(). O perfil NURSING_PROFESSIONAL usa a mesma relacao
-- de equipe dos profissionais clinicos em `team_members`, com vinculo ativo.
--
-- Esta versao conta equipes por uniao distinta das relacoes conhecidas:
--   - medical_teams.main_surgeon_id (cirurgiao principal);
--   - team_members.doctor_id ativo (medico associado e enfermagem);
--   - team_manager_surgeons -> medical_teams (gerente de equipe).
--
-- A contagem por DISTINCT evita duplicidade caso o usuario apareca em mais de
-- uma relacao para a mesma equipe.
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
    raise exception 'Voce nao tem permissao para acessar esta pagina.';
  end if;

  return query
  select p.id, p.name, p.email, p.whatsapp, p.role::text, p.status::text,
         p.avatar_url, p.specialty, p.crm, p.notes, p.professional_tag,
         p.created_at, p.updated_at, u.last_sign_in_at,
         (
           select count(distinct linked.team_id)::bigint
           from (
             select mt.id as team_id
             from public.medical_teams mt
             where mt.main_surgeon_id = p.id

             union

             select tm.team_id
             from public.team_members tm
             where tm.doctor_id = p.id
               and tm.status = 'ACTIVE'
               and tm.role_in_team::text in ('ASSOCIATED_DOCTOR', 'NURSING_PROFESSIONAL')

             union

             select mt.id as team_id
             from public.team_manager_surgeons tms
             join public.medical_teams mt on mt.main_surgeon_id = tms.surgeon_id
             where tms.team_manager_id = p.id
               and tms.is_active
           ) linked
         ) as team_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.name;
end;
$$;

grant execute on function public.admin_get_users_overview() to authenticated;
