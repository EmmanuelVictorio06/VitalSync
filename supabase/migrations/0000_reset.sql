-- ============================================================================
-- ⚠️ DESTRUTIVO — use APENAS se for reaproveitar um projeto Supabase que já
-- tinha as tabelas antigas (Prisma/Fastify). Apaga essas tabelas e qualquer
-- criação parcial do 0001, deixando o schema `public` limpo.
--
-- Rode ANTES de 0001_init.sql. Em um projeto NOVO, NÃO precisa deste arquivo.
-- ============================================================================

-- Tabelas novas (caso o 0001 tenha criado parcialmente).
drop table if exists public.notification_logs cascade;
drop table if exists public.team_members cascade;
drop table if exists public.profiles cascade;

-- Tabelas antigas do Prisma (e as de mesmo nome que conflitam).
drop table if exists public.alert_recipients cascade;
drop table if exists public.clinical_alerts cascade;
drop table if exists public.attendance_confirmations cascade;
drop table if exists public.vital_sign_records cascade;
drop table if exists public.patient_monitoring_links cascade;
drop table if exists public.patients cascade;
drop table if exists public.medical_teams cascade;
drop table if exists public.surgery_types cascade;
drop table if exists public.hospitals cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.users cascade;
drop table if exists public."_prisma_migrations" cascade;

-- Enums e funções do nosso schema (recriados pelo 0001/0002).
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.is_team_member(uuid) cascade;
drop function if exists public.is_main_surgeon_of(uuid) cascade;
drop function if exists public.get_patient_by_token(text) cascade;
drop function if exists public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text) cascade;

drop type if exists public.user_role cascade;
drop type if exists public.role_in_team cascade;
drop type if exists public.entity_status cascade;
drop type if exists public.measurement_period cascade;
drop type if exists public.clinical_status cascade;
