-- ============================================================================
-- Migration: 0074_inativo_sem_acesso
--
-- ACHADO A1 da matriz de autorização (supabase/_scripts/testes/01, casos
-- L24/L25): um profissional DESATIVADO (profiles.status='INACTIVE') que segue
-- com vínculo ativo em team_members continuava lendo pacientes, alertas e
-- medições. Desativar um usuário na tela de admin NÃO revogava o acesso ao
-- dado clínico — só escondia a UI.
--
-- Causa: os helpers de escopo checavam papel/vínculo, nunca o status do
-- próprio chamador. `is_nurse()` (0065) já exigia ACTIVE; os demais, não.
--
-- Correção: `is_active_profile()` como pré-condição de `is_admin`,
-- `is_team_member`, `is_main_surgeon_of`, `is_support` e `is_team_manager_of`.
-- Um INACTIVE perde escopo em TODAS as policies e RPCs de uma vez, porque
-- tudo passa por esses cinco helpers.
--
-- Efeitos deliberados: admin INACTIVE deixa de ser admin; cirurgião INACTIVE
-- perde o acesso da equipe (inclusive o de liberar lock via
-- is_main_surgeon_of). É o comportamento que "desativar" sempre prometeu.
--
-- ADITIVA e IDEMPOTENTE. Rode após a 0073.
-- ============================================================================

create or replace function public.is_active_profile(p_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = p_profile and p.status = 'ACTIVE'
  );
$$;
grant execute on function public.is_active_profile(uuid) to authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_profile()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN');
$$;

create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_profile()
     and (
       exists (select 1 from public.medical_teams t where t.id = p_team and t.main_surgeon_id = auth.uid())
       or exists (
         select 1 from public.team_members m
         where m.team_id = p_team and m.doctor_id = auth.uid() and m.status = 'ACTIVE'
       )
     );
$$;

create or replace function public.is_main_surgeon_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_profile()
     and exists (select 1 from public.medical_teams t where t.id = p_team and t.main_surgeon_id = auth.uid());
$$;

-- Base: 0016 (papel SUPPORT).
create or replace function public.is_support()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_profile()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'SUPPORT');
$$;

-- Base: 0030 (gerente vinculado ao cirurgião da equipe).
create or replace function public.is_team_manager_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_profile()
     and exists (
       select 1
       from public.medical_teams t
       join public.team_manager_surgeons tms
         on tms.surgeon_id = t.main_surgeon_id and tms.is_active
       where t.id = p_team and tms.team_manager_id = auth.uid()
     );
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO: rode supabase/_scripts/testes/01_matriz_leitura.sql —
-- L24/L25 (usuário INACTIVE não acessa pacientes/alertas) devem PASSAR,
-- e NENHUM outro caso pode regredir.
-- ----------------------------------------------------------------------------
