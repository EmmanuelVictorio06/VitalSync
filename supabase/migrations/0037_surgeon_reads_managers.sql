-- ============================================================================
-- VitalSync — Permite ao Cirurgião Responsável ver o(s) Gerente(s) vinculado(s)
-- a ele:
--  (1) ler os vínculos em team_manager_surgeons onde surgeon_id = auth.uid();
--  (2) ler o PERFIL (nome/contato) desses gerentes.
--
-- Simetria com a 0036: aquela deu ao GERENTE leitura do perfil do cirurgião e
-- dos associados; esta dá ao CIRURGIÃO leitura do perfil do(s) seu(s)
-- gerente(s) — os dois lados do mesmo vínculo team_manager_surgeons.
--
-- ADITIVO/IDEMPOTENTE: só acrescenta; não remove nenhuma condição vigente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) team_manager_surgeons: o cirurgião lê os vínculos dos quais ele é o surgeon.
-- ----------------------------------------------------------------------------
drop policy if exists tms_surgeon_select on public.team_manager_surgeons;
create policy tms_surgeon_select on public.team_manager_surgeons for select to authenticated
  using (surgeon_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2) Helper: p_other é um GERENTE vinculado ativamente ao cirurgião logado?
-- ----------------------------------------------------------------------------
create or replace function public.surgeon_sees_manager(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_manager_surgeons tms
    where tms.surgeon_id = auth.uid()
      and tms.is_active
      and tms.team_manager_id = p_other
  );
$$;
grant execute on function public.surgeon_sees_manager(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Recria profiles_select PRESERVANDO as condições vigentes (0036) e só
--    adicionando o ramo do cirurgião.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.shares_team_with(id)
    or public.manager_scope_includes(id)
    or public.surgeon_sees_manager(id)
  );
