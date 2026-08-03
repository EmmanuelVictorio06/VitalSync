-- ============================================================================
-- VitalSync — Novo perfil: Profissional de Enfermagem (Fase 3.5 de
-- conformidade com o Fluxo Operacional do estudo — triagem primária do
-- protocolo, classificação de risco e contato ativo com o paciente).
--
-- Apenas adiciona os valores aos enums `user_role` e `role_in_team`. NÃO usa
-- os valores nesta mesma migration (regra do projeto: ALTER TYPE ADD VALUE
-- fica isolado, sem nada que já use o valor novo na mesma transação).
--
-- Acesso: um Profissional de Enfermagem que vira membro de uma equipe (via
-- team_members, mesma tela "Integrantes da Equipe" já usada para médicos)
-- ganha automaticamente o mesmo escopo de triagem que um médico associado —
-- is_team_member() não distingue o role_in_team, só a presença ativa na
-- equipe. Não é necessária nenhuma mudança de RLS.
--
-- Rode no SQL Editor do Supabase após o 0053.
-- ============================================================================

alter type public.user_role add value if not exists 'NURSING_PROFESSIONAL';
alter type public.role_in_team add value if not exists 'NURSING_PROFESSIONAL';
