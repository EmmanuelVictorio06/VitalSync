-- ============================================================================
-- Migration: 0073_protect_profile_service_role
--
-- CORRIGE FALHA SILENCIOSA: o campo "Status inicial: Ativo/Inativo" da tela
-- "Gerenciar Usuários" não funcionava — o usuário sempre nascia ACTIVE, e a
-- interface confirmava sucesso.
--
-- Cadeia da falha:
--   1. `admin-create-user` cria a conta com `auth.admin.createUser(...)`; o
--      trigger `handle_new_user` (0001) insere o profile lendo o papel de
--      `raw_user_meta_data` — por isso o PAPEL ficava certo, por acidente.
--   2. Em seguida a função faz `.from('profiles').update({ role, status, ... })`
--      com o cliente **service_role**.
--   3. Nessa conexão `auth.uid()` é nulo → `is_admin()` (0001) é falso →
--      `protect_profile_privileged_fields` (0006) executa
--      `NEW.status := OLD.status` e descarta o valor. `OLD.status` é o default
--      da coluna: 'ACTIVE'.
--   O `status` não viaja no metadata, então não tinha por onde escapar.
--
-- A correção reconhece o contexto de service_role, que só existe dentro de
-- Edge Functions (a chave service_role NUNCA vai para o navegador — ver
-- CLAUDE.md) e que já faz a própria autorização.
--
-- ⚠️ DUAS DECISÕES QUE SÓ O TESTE NO BANCO REVELOU
--
-- (a) `auth.role()` é FORJÁVEL — não use.
--     Ela lê a GUC `request.jwt.claims`, e `set_config` é executável por
--     PUBLIC. Verificado neste banco:
--
--       begin;
--         set local role authenticated;
--         select set_config('request.jwt.claims','{"role":"service_role"}',true);
--         select auth.role();    -- 'service_role'  <<< FORJADO
--         select current_user;   -- 'authenticated' <<< resistiu
--       commit;
--
--     Como este trigger é a última barreira contra escalonamento de
--     privilégio, usar a expressão forjável abriria justamente o buraco que
--     ele existe para fechar.
--
-- (b) A função deixa de ser SECURITY DEFINER — sem isso, `current_user` não
--     funciona aqui. Dentro de uma função SECURITY DEFINER, `current_user` é o
--     DONO (postgres), não o chamador; a condição nunca seria verdadeira e o
--     service_role continuaria bloqueado. Medido:
--
--       dentro de SECURITY DEFINER, chamada por service_role:
--         current_user=postgres · session_user=postgres · GUC role=service_role
--
--     A função não precisa do privilégio: ela só lê OLD/NEW e chama
--     `is_admin()`, que já é SECURITY DEFINER por conta própria e continua
--     enxergando `profiles`. Como INVOKER, `current_user` passa a refletir o
--     papel real imposto pelo `SET LOCAL ROLE` do PostgREST a partir do JWT já
--     verificado — que um cliente não altera sem a chave de serviço.
--
-- Não muda a assinatura, nem o trigger `trg_protect_profile`, nem
-- `NEW.updated_at := now()`.
--
-- ADITIVA e IDEMPOTENTE. Rode após a 0072.
-- ============================================================================

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Campos privilegiados só podem ser alterados por um ADMIN autenticado ou
  -- pelo service_role (Edge Functions, que autorizam por conta própria).
  if not (public.is_admin() or current_user = 'service_role') then
    NEW.role   := OLD.role;
    NEW.status := OLD.status;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

comment on function public.protect_profile_privileged_fields() is
  'Impede que um usuário comum altere o próprio role/status. Permite ADMIN autenticado e service_role (Edge Function). Usa current_user — auth.role() é forjável via set_config.';

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1) usuário comum NÃO escala privilégio (deve continuar bloqueado):
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims', json_build_object('sub','<id-nao-admin>','role','authenticated')::text, true);
--     update public.profiles set role='ADMIN', status='INACTIVE' where id='<id-nao-admin>';
--     select role, status from public.profiles where id='<id-nao-admin>';  -- INALTERADOS
--   rollback;
--
--   -- 2) nem forjando a claim de service_role:
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims','{"sub":"<id>","role":"service_role"}',true);
--     update public.profiles set role='ADMIN' where id='<id>';
--     select role from public.profiles where id='<id>';                    -- INALTERADO
--   rollback;
--
--   -- 3) service_role de verdade CONSEGUE (é o caso do admin-create-user):
--   begin;
--     set local role service_role;
--     update public.profiles set status='INACTIVE' where id='<id>';
--     select status from public.profiles where id='<id>';                  -- INACTIVE
--   rollback;
-- ----------------------------------------------------------------------------
