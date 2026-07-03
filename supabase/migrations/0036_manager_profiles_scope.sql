-- ============================================================================
-- VitalSync — Gerente de Equipe passa a LER (nome/contato) os perfis do seu
-- escopo: (a) os cirurgiões aos quais está vinculado (team_manager_surgeons
-- ativo); (b) os médicos associados ATIVOS das equipes desses cirurgiões.
--
-- Necessário para resolver nome do cirurgião e a lista de médicos na tela
-- "Equipes Vinculadas": os embeds surgeon:profiles / doctor:profiles em
-- teamViewService.getTeamDetail() leem a TABELA BASE profiles, protegida pela
-- policy profiles_select (0025) — que só considerava shares_team_with (colega
-- de equipe), e o gerente não é membro/responsável, só vinculado ao cirurgião.
--
-- ADITIVO/IDEMPOTENTE: só acrescenta um ramo OR à policy vigente (0025); não
-- remove id = auth.uid() / is_admin() / shares_team_with(id).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helper: o usuário logado (gerente) tem p_other dentro do seu escopo?
-- ----------------------------------------------------------------------------
create or replace function public.manager_scope_includes(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- (a) p_other é um cirurgião vinculado ativamente ao gerente logado
    exists (
      select 1 from public.team_manager_surgeons tms
      where tms.team_manager_id = auth.uid()
        and tms.is_active
        and tms.surgeon_id = p_other
    )
    -- (b) p_other é associado ATIVO de uma equipe cujo cirurgião é vinculado
    or exists (
      select 1
      from public.team_manager_surgeons tms
      join public.medical_teams t on t.main_surgeon_id = tms.surgeon_id
      join public.team_members m   on m.team_id = t.id
      where tms.team_manager_id = auth.uid()
        and tms.is_active
        and m.doctor_id = p_other
        and m.status = 'ACTIVE'
    );
$$;
grant execute on function public.manager_scope_includes(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Recria profiles_select PRESERVANDO as condições vigentes (0025) e só
--    adicionando o ramo do gerente.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.shares_team_with(id)
    or public.manager_scope_includes(id)
  );
