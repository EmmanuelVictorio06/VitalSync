-- ============================================================================
-- VitalSync — Fase 6 / M-09: restringe a leitura ampla de profiles (Opção X)
--
-- PROBLEMA: profiles_select usava `using (true)` → qualquer autenticado lia
-- TODOS os campos de todos (inclusive e-mail/whatsapp/crm de terceiros).
--
-- OPÇÃO X (escolhida): dados de CONTATO (e-mail/whatsapp/crm) e demais campos da
-- tabela só são visíveis ao PRÓPRIO usuário, ao ADMIN e aos COLEGAS DE EQUIPE
-- (preserva o contato dentro da equipe). Para resoluções de NOME/tag/papel em
-- listas (alertas, atendimentos, contagens), expomos uma view pública
-- `profiles_public` com campos NÃO sensíveis (sem e-mail/whatsapp/crm).
--
-- A view roda como owner (security_invoker desligado) → enxerga todas as linhas,
-- mas só as colunas não sensíveis. A tabela base fica protegida pela policy.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0019
-- (usa professional_tag).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helper: o usuário logado compartilha alguma equipe ATIVA com p_other?
--    (como cirurgião principal ou membro ativo). SECURITY DEFINER para ler as
--    tabelas de equipe sem depender de RLS.
-- ----------------------------------------------------------------------------
create or replace function public.shares_team_with(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with my_teams as (
    select t.id from public.medical_teams t where t.main_surgeon_id = auth.uid()
    union
    select m.team_id from public.team_members m where m.doctor_id = auth.uid() and m.status = 'ACTIVE'
  )
  select exists (
    select 1 from my_teams mt
    where exists (select 1 from public.medical_teams t2 where t2.id = mt.id and t2.main_surgeon_id = p_other)
       or exists (select 1 from public.team_members m2
                    where m2.team_id = mt.id and m2.doctor_id = p_other and m2.status = 'ACTIVE')
  );
$$;
grant execute on function public.shares_team_with(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Restringe a leitura da TABELA base (contato só self + admin + colega).
--    (profiles_admin_write `for all` da 0001 continua dando acesso total ao ADMIN.)
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.shares_team_with(id)
  );

-- ----------------------------------------------------------------------------
-- 3) View pública só com campos NÃO sensíveis (nome/tag/papel/status/avatar).
--    Para listas e contagens que precisam resolver qualquer usuário sem expor
--    contato. Roda como owner → ignora a RLS da tabela base (intencional).
-- ----------------------------------------------------------------------------
create or replace view public.profiles_public as
  select id, name, professional_tag, role, status, avatar_url
  from public.profiles;

grant select on public.profiles_public to authenticated;

comment on view public.profiles_public is
  'Campos não sensíveis de profiles (sem e-mail/whatsapp/crm) para listas/contagens. Contato fica na tabela base, protegida por RLS (self/admin/colega de equipe).';
