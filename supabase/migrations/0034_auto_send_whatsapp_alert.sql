-- ============================================================================
-- Migration: 0034_auto_send_whatsapp_alert
--
-- Liga o ÚLTIMO elo do pipeline de alerta: quando um clinical_alerts nasce,
-- dispara AUTOMATICAMENTE a Edge Function `send-whatsapp-alert`, que entrega
-- os notification_logs PENDING pela Meta Cloud API (template alerta_clinico_vitalsync).
--
-- Antes desta migration, notify_team_of_alert (0018) já criava os logs PENDING,
-- mas ninguém chamava a Edge Function em produção. Aqui usamos pg_net para o
-- POST server-to-server, sem depender de webhook configurado no painel.
--
-- PRÉ-REQUISITOS (rodar UMA vez no projeto, ver instruções ao final):
--   1) Extensão pg_net habilitada (feito abaixo).
--   2) Dois segredos no Vault do Supabase:
--        - 'project_url'      → https://<project-ref>.supabase.co
--        - 'service_role_key' → a service_role key (NUNCA vai pro frontend)
--   3) Edge Function deployada e secrets da Meta setados:
--        supabase functions deploy send-whatsapp-alert
--        supabase secrets set WHATSAPP_API_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
--
-- IDEMPOTÊNCIA: o trigger dispara 1x por INSERT de alerta. Se pg_net/Vault não
-- estiverem configurados, a função apenas registra um aviso e NÃO quebra o
-- INSERT do alerta (o alerta continua sendo criado normalmente).
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- Função de trigger: faz o POST para a Edge Function send-whatsapp-alert.
-- Roda como SECURITY DEFINER porque lê o Vault (segredos) e chama pg_net.
-- ----------------------------------------------------------------------------
create or replace function public.trg_dispatch_whatsapp_alert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url  text;
  v_key  text;
begin
  -- Lê a URL do projeto e a service_role key do Vault.
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  -- Sem segredos configurados: não bloqueia a criação do alerta, só avisa.
  if v_url is null or v_key is null then
    raise warning 'send-whatsapp-alert não disparado: configure os secrets project_url/service_role_key no Vault.';
    return new;
  end if;

  -- POST assíncrono (não bloqueia a transação do INSERT). A Edge Function
  -- aceita o formato { record: { id } } (Database Webhook) — reaproveitamos.
  perform net.http_post(
    url     := v_url || '/functions/v1/send-whatsapp-alert',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('record', jsonb_build_object('id', new.id))
  );

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Trigger: 1 disparo por alerta criado. Fica AFTER INSERT para garantir que os
-- notification_logs (criados por notify_team_of_alert dentro da mesma RPC) já
-- estejam gravados quando a Edge Function for lê-los.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_alert_dispatch_whatsapp on public.clinical_alerts;
create trigger trg_alert_dispatch_whatsapp
  after insert on public.clinical_alerts
  for each row
  execute function public.trg_dispatch_whatsapp_alert();

-- ============================================================================
-- COMO CONFIGURAR OS SEGREDOS DO VAULT (rodar uma vez, no SQL Editor do
-- Supabase OU via psql). Substitua pelos valores reais do seu projeto:
--
--   select vault.create_secret('https://SEU-REF.supabase.co', 'project_url');
--   select vault.create_secret('SUA_SERVICE_ROLE_KEY',        'service_role_key');
--
-- Para ATUALIZAR um segredo já existente:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'service_role_key'),
--     'NOVA_SERVICE_ROLE_KEY'
--   );
-- ============================================================================
