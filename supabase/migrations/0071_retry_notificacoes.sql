-- ============================================================================
-- Migration: 0071_retry_notificacoes  (Prontidão para o primeiro paciente — Bloco 2)
--
-- Hoje um `notification_logs.status = 'FAILED'` fica parado para sempre: não há
-- retry e não há aviso. Se o WhatsApp do alerta VERMELHO falhar, ninguém é
-- avisado de que ninguém foi avisado — falha silenciosa, exatamente o modo de
-- falha que este trabalho existe para eliminar.
--
-- ⚠️ ESTADOS FINAIS QUE NUNCA PODEM SER REPROCESSADOS:
--   • `SKIPPED_TEST_MODE` — o gate de homologação (0018) decidiu NÃO enviar.
--     Reprocessar furaria o gate e mandaria mensagem real para número fora da
--     whitelist durante os testes.
--   • `logged` — modo simulado (sem credenciais Meta). Reprocessar não enviaria
--     nada e só inflaria o contador.
-- Ambos são decisões intencionais, não falhas. O filtro é `status = 'FAILED'`.
--
-- NÃO cria caminho de envio novo: o envio real continua sendo da Edge Function
-- `send-whatsapp-alert`, acionada pelo mesmo padrão pg_net + Vault das 0038/0061.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0070.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Controle de tentativas.
-- ----------------------------------------------------------------------------
alter table public.notification_logs
  add column if not exists retry_count           int not null default 0,
  add column if not exists last_retry_at         timestamptz,
  add column if not exists escalated_failure_at  timestamptz;

comment on column public.notification_logs.retry_count is
  'Tentativas automáticas já feitas. Ao chegar em 3, para de tentar e vira alarme.';
comment on column public.notification_logs.escalated_failure_at is
  'Quando a falha definitiva foi alarmada ao Admin. Evita alarmar o mesmo log duas vezes.';

create index if not exists idx_notif_retry_pendente
  on public.notification_logs(status, retry_count) where status = 'FAILED';

-- Parâmetros junto dos demais (app_settings, seção `nursing` — 0063).
update public.app_settings
   set data = data
     || jsonb_build_object(
          'notificationMaxRetries', 3,
          'notificationBackoffMinutes', jsonb_build_array(5, 15, 60)
        )
 where section = 'nursing'
   and not (data ? 'notificationMaxRetries');

-- ----------------------------------------------------------------------------
-- 2) retry_failed_notifications — reenfileira o que ainda tem tentativa.
--    Backoff crescente: 5 min após a 1ª falha, 15 após a 2ª, 60 após a 3ª.
-- ----------------------------------------------------------------------------
create or replace function public.retry_failed_notifications()
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_max     int := public.nursing_setting_num('notificationMaxRetries', 3)::int;
  v_url     text;
  v_key     text;
  v_count   int := 0;
  r         record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  for r in
    select n.id, n.alert_id, n.retry_count
      from public.notification_logs n
     where n.status = 'FAILED'                 -- NUNCA SKIPPED_TEST_MODE nem logged
       and n.retry_count < v_max
       and n.alert_id is not null
       and (
         n.last_retry_at is null
         or n.last_retry_at < now() - make_interval(mins =>
              case n.retry_count when 0 then 5 when 1 then 15 else 60 end)
       )
  loop
    update public.notification_logs
       set status        = 'PENDING',
           retry_count   = retry_count + 1,
           last_retry_at = now(),
           error_message = null
     where id = r.id;

    -- Dispara a Edge Function existente (uma vez por alerta; ela varre todos
    -- os PENDING daquele alert_id).
    if v_url is not null and v_key is not null then
      perform net.http_post(
        url     := v_url || '/functions/v1/send-whatsapp-alert',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_key
                   ),
        body    := jsonb_build_object('alert_id', r.alert_id)
      );
    end if;

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    if v_url is null or v_key is null then
      raise warning 'Notificações reenfileiradas, mas a Edge Function não foi disparada: configure project_url/service_role_key no Vault.';
    end if;
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'NOTIFICATION_RETRY', v_count || ' notificação(ões) reenfileirada(s)');
  end if;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) alarm_exhausted_notifications — esgotou as tentativas, alarma o Admin.
--
--    NOTA DE DESENHO: não existe "sino de notificações" neste app (só contadores
--    de badge: AlertCount / MissedMeasurementCount / NurseQueueCount). Em vez de
--    inventar um canal, o alarme carimba `escalated_failure_at` e registra em
--    `audit_logs`; a superfície in-app é a lista de falhas no painel do Admin
--    (Configurações → Homologação), que passa a mostrar estas linhas em
--    destaque com botão de reenvio manual.
-- ----------------------------------------------------------------------------
create or replace function public.alarm_exhausted_notifications()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_max   int := public.nursing_setting_num('notificationMaxRetries', 3)::int;
  v_count int := 0;
  v_red   int := 0;
begin
  with esgotadas as (
    update public.notification_logs n
       set escalated_failure_at = now()
     where n.status = 'FAILED'
       and n.retry_count >= v_max
       and n.escalated_failure_at is null
    returning n.id, n.alert_id, n.patient_id
  )
  select count(*),
         count(*) filter (where exists (
           select 1 from public.clinical_alerts a
            where a.id = e.alert_id and a.status = 'RED'
         ))
    into v_count, v_red
    from esgotadas e;

  if v_count > 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'NOTIFICATION_FAILURE_ALARM',
            v_count || ' notificação(ões) esgotaram as tentativas'
            || case when v_red > 0 then ' — ' || v_red || ' de alerta VERMELHO' else '' end);
  end if;

  return v_count;
end;
$$;

revoke execute on function public.retry_failed_notifications()    from public;
revoke execute on function public.alarm_exhausted_notifications() from public;
grant  execute on function public.retry_failed_notifications()    to authenticated;
grant  execute on function public.alarm_exhausted_notifications() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Agendamentos idempotentes (padrão 0038/0061).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('retry-failed-notifications', 'alarm-exhausted-notifications');

    perform cron.schedule('retry-failed-notifications', '*/10 * * * *',
      $sql$select public.retry_failed_notifications();$sql$);

    perform cron.schedule('alarm-exhausted-notifications', '*/30 * * * *',
      $sql$select public.alarm_exhausted_notifications();$sql$);
  else
    raise warning 'pg_cron indisponível — notificações FAILED NÃO serão reenviadas nem alarmadas automaticamente.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (cenários 3 e 4 do PR):
--
--   -- 3) falha manual é reenviada e, após 3 tentativas, vira alarme:
--   update public.notification_logs set status='FAILED', retry_count=0, last_retry_at=null
--    where id = '<log>';
--   select public.retry_failed_notifications();     -- 1
--   select status, retry_count from public.notification_logs where id = '<log>';  -- PENDING / 1
--
--   update public.notification_logs set status='FAILED', retry_count=3 where id = '<log>';
--   select public.alarm_exhausted_notifications();  -- 1
--   select escalated_failure_at from public.notification_logs where id = '<log>';  -- preenchido
--   select action, entity from public.audit_logs where action='NOTIFICATION_FAILURE_ALARM';
--
--   -- 4) SKIPPED_TEST_MODE NÃO é reprocessado (o mais importante):
--   update public.notification_logs set status='SKIPPED_TEST_MODE', retry_count=0 where id='<log2>';
--   select public.retry_failed_notifications();
--   select status, retry_count from public.notification_logs where id='<log2>';
--   --> continua SKIPPED_TEST_MODE / 0
-- ----------------------------------------------------------------------------
