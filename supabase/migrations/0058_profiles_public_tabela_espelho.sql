-- ============================================================================
-- Migration: 0058_profiles_public_tabela_espelho
--
-- Objetivo: LIMPAR o alerta do Supabase Advisor "Security Definer View" para
-- public.profiles_public — de forma real, sem quebrar comportamento.
--
-- Contexto (ver 0025 e 0032): profiles_public era uma VIEW SECURITY DEFINER que
-- expunha só colunas NÃO sensíveis (name/professional_tag/role/status/avatar_url)
-- de QUALQUER perfil, contornando a RLS restritiva de public.profiles
-- (profiles_select = self/admin/colega). Isso é necessário para as telas de
-- alertas/atendimentos resolverem nome/papel de profissionais de outras equipes.
--
-- Por que NÃO usar security_invoker = true: a view passaria a aplicar a RLS da
-- profiles e esconderia nomes de profissionais de outras equipes (quebraria
-- alertas/atendimentos). E como os campos sensíveis (email/whatsapp/crm) vivem
-- na MESMA linha da profiles, não dá para "liberar a linha" sem vazá-los.
--
-- Solução (tabela espelho): profiles_public deixa de ser view e vira uma TABELA
-- real que contém APENAS as colunas não sensíveis, mantida em sincronia por
-- trigger a partir de public.profiles. A RLS da tabela espelho é permissiva
-- (authenticated lê tudo) porque o conteúdo é não sensível — os campos de
-- contato continuam protegidos pela RLS da profiles. Sem SECURITY DEFINER view,
-- o Advisor para de alertar. Nenhum código de app muda (mesmo nome/colunas;
-- consultas .in()/count continuam funcionando por ser uma tabela do PostgREST).
--
-- ADITIVA e IDEMPOTENTE. Rode com `supabase db push`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Remove a VIEW SECURITY DEFINER (e seus grants).
-- ----------------------------------------------------------------------------
drop view if exists public.profiles_public;

-- ----------------------------------------------------------------------------
-- 2) Tabela espelho — SÓ colunas não sensíveis (nunca email/whatsapp/crm).
--    Tipos idênticos aos da profiles para não perder semântica em filtros.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles_public (
  id               uuid primary key references public.profiles(id) on delete cascade,
  name             text,
  professional_tag text,
  role             public.user_role,
  status           public.entity_status,
  avatar_url       text,
  updated_at       timestamptz not null default now()
);

comment on table public.profiles_public is
  'Espelho NÃO sensível de profiles (nome/tag/papel/status/avatar) para listas/'
  'contagens visíveis a qualquer profissional autenticado. Mantida por trigger '
  '(sync_profiles_public). Substitui a antiga view SECURITY DEFINER (0032) para '
  'sanar o Advisor "Security Definer View" sem afrouxar a RLS da profiles: '
  'email/whatsapp/crm continuam protegidos na tabela base.';

-- ----------------------------------------------------------------------------
-- 3) Backfill inicial a partir da profiles.
-- ----------------------------------------------------------------------------
insert into public.profiles_public (id, name, professional_tag, role, status, avatar_url, updated_at)
select p.id, p.name, p.professional_tag, p.role, p.status, p.avatar_url, now()
  from public.profiles p
on conflict (id) do update set
  name             = excluded.name,
  professional_tag = excluded.professional_tag,
  role             = excluded.role,
  status           = excluded.status,
  avatar_url       = excluded.avatar_url,
  updated_at       = now();

-- ----------------------------------------------------------------------------
-- 4) Trigger de sincronização: mantém a espelho em dia a cada INSERT/UPDATE das
--    colunas espelhadas em profiles. (DELETE é coberto pelo ON DELETE CASCADE.)
--    SECURITY DEFINER para escrever na espelho independentemente da RLS.
-- ----------------------------------------------------------------------------
create or replace function public.sync_profiles_public()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles_public (id, name, professional_tag, role, status, avatar_url, updated_at)
  values (new.id, new.name, new.professional_tag, new.role, new.status, new.avatar_url, now())
  on conflict (id) do update set
    name             = excluded.name,
    professional_tag = excluded.professional_tag,
    role             = excluded.role,
    status           = excluded.status,
    avatar_url       = excluded.avatar_url,
    updated_at       = now();
  return new;
end; $$;

drop trigger if exists trg_sync_profiles_public on public.profiles;
create trigger trg_sync_profiles_public
  after insert or update of name, professional_tag, role, status, avatar_url
  on public.profiles
  for each row execute function public.sync_profiles_public();

-- ----------------------------------------------------------------------------
-- 5) RLS + grants — só leitura, para authenticated. Sem escrita de cliente:
--    a tabela é mantida exclusivamente pelo trigger (SECURITY DEFINER).
-- ----------------------------------------------------------------------------
alter table public.profiles_public enable row level security;

drop policy if exists profiles_public_select on public.profiles_public;
create policy profiles_public_select on public.profiles_public
  for select to authenticated using (true);

revoke insert, update, delete on public.profiles_public from anon, authenticated;
grant select on public.profiles_public to authenticated;

-- ----------------------------------------------------------------------------
-- 6) VERIFICAÇÃO (rode após aplicar):
--    -- não deve mais existir a view:
--    select relkind from pg_class where relname = 'profiles_public';  -- 'r' (tabela), não 'v'
--    -- contagem deve bater com profiles:
--    select (select count(*) from public.profiles) as profiles,
--           (select count(*) from public.profiles_public) as espelho;
--    -- Advisor "Security Definer View" para profiles_public: deve sumir.
-- ----------------------------------------------------------------------------
