-- ============================================================================
-- Migration: 0038_lembrete_medicao
--
-- Lembrete automático por WhatsApp quando o horário-limite da janela de
-- medição (Manhã 08:00-10:00 / Noite 18:00-20:00, America/Sao_Paulo) está
-- próximo e o paciente ainda não enviou o registro daquele período.
--
-- Por que uma tabela NOVA (reminder_logs) em vez de reutilizar
-- notification_logs: notification_logs é modelada em torno de um
-- clinical_alerts (alert_id not-null em espírito, recipient_profile_id
-- aponta pra um MÉDICO) e não tem restrição de unicidade por dia. O lembrete
-- é dirigido ao PACIENTE (não a um profile) e precisa de idempotência
-- "1 por paciente/período/dia", então ganha uma tabela própria com
-- UNIQUE (patient_id, period, reminder_date). O restante do desenho
-- (environment/is_test, gate de homologação, status PENDING → SENT/FAILED/
-- logged/SKIPPED_TEST_MODE) espelha notification_logs de propósito, para
-- reaproveitar o mesmo modo de homologação (0018) e o mesmo formato que a
-- Edge Function send-whatsapp-alert já usa.
--
-- PRÉ-REQUISITOS para o disparo automático funcionar em produção (mesmo
-- padrão da 0034_auto_send_whatsapp_alert):
--   1) Secrets do Vault 'project_url' e 'service_role_key' (já devem existir
--      se o alerta automático da 0034 já está configurado).
--   2) Extensão pg_cron habilitada. Em alguns projetos Supabase isso só é
--      permitido via Dashboard → Database → Extensions (não pelo `db push`
--      direto, por restrição de permissão do role usado no push). Se o
--      `create extension` abaixo falhar com "permission denied", habilite
--      pg_cron pelo Dashboard e rode esta migration de novo.
--   3) Edge Function deployada e template aprovado na Meta:
--        supabase functions deploy send-measurement-reminder
--        supabase secrets set WHATSAPP_REMINDER_TEMPLATE_NAME=lembrete_medicao_vitalsync
--   4) Idempotência de agendamento: os cron.schedule abaixo primeiro
--      removem (se existir) o job com o mesmo nome antes de recriar, então
--      a migration pode ser reaplicada sem duplicar jobs.
--
-- Fuso: Brasília (America/Sao_Paulo) não observa horário de verão desde
-- 2019, então o offset é fixo em UTC-3. Os horários de cron abaixo (12:30 e
-- 22:30 UTC) equivalem a 09:30 e 19:30 em America/Sao_Paulo, assumindo que
-- o Postgres do projeto roda em UTC (padrão do Supabase).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela de log/idempotência dos lembretes.
-- ----------------------------------------------------------------------------
create table if not exists public.reminder_logs (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(id) on delete cascade,
  period               public.measurement_period not null,
  reminder_date        date not null default current_date,
  recipient_phone      text,
  recipient_name       text,
  channel              text not null default 'whatsapp',
  status               text not null default 'PENDING',
  template_name        text,
  environment          text not null default 'production',
  is_test              boolean not null default false,
  provider_message_id  text,
  error_message        text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  unique (patient_id, period, reminder_date)
);

create index if not exists idx_reminder_logs_status on public.reminder_logs(status);
create index if not exists idx_reminder_logs_patient on public.reminder_logs(patient_id);

alter table public.reminder_logs enable row level security;

-- Mesmo padrão de notification_logs: ADMIN lê tudo pelo app; o resto do
-- fluxo (criação/atualização dos logs) passa por função SECURITY DEFINER ou
-- pela Edge Function (service_role), que ignora RLS.
drop policy if exists reminder_logs_admin_read on public.reminder_logs;
create policy reminder_logs_admin_read on public.reminder_logs for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2) enqueue_measurement_reminders — seleciona pacientes elegíveis e cria os
--    logs PENDING (ou SKIPPED_TEST_MODE, sob o gate de homologação). Idempotente
--    por dia/período via UNIQUE + ON CONFLICT DO NOTHING.
--
--    Elegibilidade: paciente ACTIVE, dentro de 10 dias da alta
--    (hospital_discharge_date + 10 >= hoje), com telefone cadastrado, SEM
--    medição do período hoje e SEM lembrete já registrado hoje pro período.
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_measurement_reminders(p_period text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mode       boolean;
  v_recipients text[];
  v_env        text;
  v_count      int := 0;
  r            record;
  v_status     text;
  v_error      text;
begin
  if p_period not in ('MORNING', 'NIGHT') then
    raise exception 'Período inválido: %', p_period;
  end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  for r in
    select p.id, p.name, p.phone, p.is_test
    from public.patients p
    where p.status = 'ACTIVE'
      and p.hospital_discharge_date is not null
      and p.hospital_discharge_date + 10 >= current_date
      and p.phone is not null
      and not exists (
        select 1 from public.vital_sign_records v
        where v.patient_id = p.id
          and v.record_date = current_date
          and v.period = p_period::public.measurement_period
      )
      and not exists (
        select 1 from public.reminder_logs rl
        where rl.patient_id = p.id
          and rl.period = p_period::public.measurement_period
          and rl.reminder_date = current_date
      )
  loop
    -- Em homologação: só enfileira de verdade para números na whitelist.
    if v_mode and not exists (
      select 1 from unnest(v_recipients) x
      where public.normalize_phone(x) = public.normalize_phone(r.phone)
    ) then
      v_status := 'SKIPPED_TEST_MODE';
      v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
    else
      v_status := 'PENDING';
      v_error  := null;
    end if;

    insert into public.reminder_logs
      (patient_id, period, reminder_date, recipient_phone, recipient_name,
       channel, status, template_name, environment, is_test, error_message, sent_at)
    values
      (r.id, p_period::public.measurement_period, current_date, r.phone, r.name,
       'whatsapp', v_status, 'lembrete_medicao_vitalsync', v_env,
       coalesce(r.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end)
    on conflict (patient_id, period, reminder_date) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) dispatch_measurement_reminders — enfileira e, se houver PENDING novos e
--    os secrets do Vault estiverem configurados, chama a Edge Function
--    send-measurement-reminder via pg_net (mesmo padrão da 0034).
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_measurement_reminders(p_period text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url      text;
  v_key      text;
  v_enqueued int;
begin
  v_enqueued := public.enqueue_measurement_reminders(p_period);
  if v_enqueued = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'send-measurement-reminder não disparado: configure os secrets project_url/service_role_key no Vault.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-measurement-reminder',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('period', p_period)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Agendamento via pg_cron — 09:30 e 19:30 America/Sao_Paulo (12:30/22:30 UTC).
--    Tenta habilitar a extensão; se o role do `db push` não tiver permissão,
--    apenas avisa (não aborta a migration — a tabela/funções acima ficam
--    criadas normalmente). Remove os jobs antigos (se existirem) antes de
--    recriar, para a migration poder ser reaplicada sem duplicar agendamentos.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when insufficient_privilege then
  raise warning 'pg_cron não pôde ser habilitado automaticamente (permissão insuficiente). Habilite a extensão pelo Dashboard → Database → Extensions e rode esta migration novamente para criar os agendamentos.';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('measurement-reminder-morning', 'measurement-reminder-night');

    perform cron.schedule(
      'measurement-reminder-morning',
      '30 12 * * *',
      $sql$select public.dispatch_measurement_reminders('MORNING');$sql$
    );

    perform cron.schedule(
      'measurement-reminder-night',
      '30 22 * * *',
      $sql$select public.dispatch_measurement_reminders('NIGHT');$sql$
    );
  else
    raise warning 'pg_cron indisponível — agendamentos NÃO criados. Habilite a extensão e rode esta migration novamente.';
  end if;
end;
$$;
