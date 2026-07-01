-- ============================================================================
-- VitalSync — profiles_public: declara security_invoker = false explicitamente
--
-- O Supabase Security Advisor sinaliza views sem security_invoker = true.
-- Neste caso o SECURITY DEFINER é INTENCIONAL: a view implementa o padrão
-- "safe-column-subset" do PostgreSQL — expõe apenas campos não-sensíveis
-- (sem e-mail/whatsapp/crm) de QUALQUER perfil autenticado, contornando a
-- RLS restritiva da tabela base (self/admin/colega).
--
-- Por quê isso é seguro:
--   • A view em si é a camada de controle — só seleciona colunas não-sensíveis.
--   • Trocar para security_invoker = true quebraria listas de alertas e
--     atendimentos (médico A não veria nome de médico B de outra equipe).
--   • Resolver "de verdade" exigiria grants por coluna + policy USING(true),
--     que anularia a policy restritiva e exporia contatos a todos — pior.
--
-- Esta migration recria a view com WITH (security_invoker = false) para
-- tornar a intenção inequívoca no código-fonte.
--
-- ADITIVO e IDEMPOTENTE. Rode após o 0031.
-- ============================================================================

create or replace view public.profiles_public
  with (security_invoker = false)
as
  select id, name, professional_tag, role, status, avatar_url
  from public.profiles;

grant select on public.profiles_public to authenticated;

comment on view public.profiles_public is
  'Campos não-sensíveis de profiles (sem e-mail/whatsapp/crm) para listas/contagens. '
  'SECURITY DEFINER intencional: permite ver nome/tag/papel de qualquer perfil sem '
  'expor dados de contato (que ficam protegidos pela RLS profiles_select na tabela base). '
  'Ver: padrão "safe-column-subset view" — PostgreSQL docs, CREATE VIEW § Security.';
