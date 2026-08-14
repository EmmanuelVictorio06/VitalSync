-- ============================================================================
-- Migration: 0070_client_error_logs  (Prontidão para o primeiro paciente — Bloco 1)
--
-- Destino dos erros de render/assíncronos capturados no navegador. O motivo é
-- o pior modo de falha do piloto: sem ErrorBoundary, qualquer exceção de
-- render derruba a árvore e deixa TELA BRANCA. Na rota pública do paciente
-- (/registro-sinais/:token) isso significa que o paciente abre o link do
-- WhatsApp, não vê nada, não registra a medição — e NINGUÉM fica sabendo.
-- Esta tabela é o "ninguém fica sabendo" deixando de ser verdade.
--
-- ⚠️ VAZAMENTO DE CREDENCIAL — o motivo de `route_pattern` existir.
-- A URL do paciente contém o `secure_token` (credencial de acesso a dado de
-- saúde). Gravar `window.location.href`, `document.referrer` ou o objeto de
-- erro cru colocaria o token nesta tabela. Por isso:
--   • grava-se o PADRÃO da rota ('/registro-sinais/:token'), nunca a URL real;
--   • `message` e `stack` passam por redação no cliente
--     (frontend/src/lib/errorReporting.ts) antes de chegar aqui.
-- A redação é responsabilidade do cliente porque é lá que o dado nasce; esta
-- tabela é a última linha de defesa, não a primeira.
--
-- RLS: INSERT liberado a `anon` (a tela do paciente não tem login) e a
-- `authenticated`; SELECT só para Admin; UPDATE/DELETE para ninguém — log que
-- pode ser editado não é log.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0069.
-- ============================================================================

create table if not exists public.client_error_logs (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  contexto      text not null,
  message       text,
  stack         text,
  route_pattern text,
  user_agent    text,
  profile_id    uuid references public.profiles(id) on delete set null,
  app_version   text
);

comment on table public.client_error_logs is
  'Erros de JavaScript capturados no navegador (ErrorBoundary + listeners globais). Conteúdo já redigido no cliente.';
comment on column public.client_error_logs.route_pattern is
  'PADRÃO da rota (ex.: /registro-sinais/:token) — NUNCA a URL real, que contém o secure_token do paciente.';
comment on column public.client_error_logs.profile_id is
  'Null quando o erro veio da tela pública do paciente (sem login).';

create index if not exists idx_client_error_logs_recentes
  on public.client_error_logs(occurred_at desc);
create index if not exists idx_client_error_logs_contexto
  on public.client_error_logs(contexto, occurred_at desc);

alter table public.client_error_logs enable row level security;

-- INSERT: qualquer visitante pode reportar (a tela do paciente é anônima).
drop policy if exists client_error_logs_insert on public.client_error_logs;
create policy client_error_logs_insert on public.client_error_logs for insert to anon, authenticated
  with check (true);

-- SELECT: só o Admin lê.
drop policy if exists client_error_logs_admin_read on public.client_error_logs;
create policy client_error_logs_admin_read on public.client_error_logs for select to authenticated
  using (public.is_admin());

-- Sem policy de UPDATE/DELETE: nem anon nem authenticated alteram o histórico.
-- (Sem policy = negado sob RLS; o revoke abaixo é defesa em profundidade.)
revoke update, delete on public.client_error_logs from anon, authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- anônimo consegue inserir:
--   insert into public.client_error_logs (contexto, message) values ('teste', 'ok');
--
--   -- e NÃO consegue ler de volta (deve retornar 0 linhas para não-admin):
--   select count(*) from public.client_error_logs;
--
--   -- nenhuma linha deve conter token/CPF (a redação é no cliente, mas confira):
--   select count(*) from public.client_error_logs
--    where message ~ '[A-Za-z0-9]{20,}' or stack ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}';
--   --> esperado: 0
-- ----------------------------------------------------------------------------
