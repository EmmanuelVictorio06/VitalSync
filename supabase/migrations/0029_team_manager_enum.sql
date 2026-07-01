-- ============================================================================
-- VitalSync — Papel TEAM_MANAGER (isolado: ADD VALUE de enum em migration
-- separada, conforme padrão já usado em 0015_support_role_enum.sql).
--
-- ADITIVO e IDEMPOTENTE. Rode no SQL Editor após o 0028.
-- ============================================================================

alter type public.user_role add value if not exists 'TEAM_MANAGER';
