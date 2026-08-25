-- ============================================================================
-- Migration: 0061_missed_measurement_alerts
--
-- Enfileira e dispara o alerta operacional de esquecimento para a EQUIPE,
-- ~15 minutos depois que cada janela de medição fecha (Manhã fecha 10:00,
-- Noite fecha 20:00, America/Sao_Paulo) — aditivo ao lembrete que já vai para
-- o PACIENTE às 09:30/19:30 (0038), não o substitui.
--
-- Reaproveita o MESMO gate de elegibilidade de enqueue_measurement_reminders
-- (0038): paciente ACTIVE, dentro de 10 dias da alta, sem medição do período
-- hoje. Idempotência adicional própria: pula pacientes que já têm QUALQUER
-- linha em missed_measurement_logs para (patient_id, period, hoje), para não
-- reprocessar destinatários se o dispatch rodar de novo no mesmo dia.
--
-- Destinatários (prioridade de enfermagem, decisão confirmada com o
-- Emmanuel): primeiro os NURSING_PROFESSIONAL ativos da equipe do paciente;
-- se não houver nenhum, cai para o mesmo conjunto que notify_team_of_alert
-- (0018) usa — main_surgeon_id da equipe UNION demais team_members ativos.
-- Mesmo gate de homologação (homologation_settings/normalize_phone) das
-- funções irmãs.
--
-- PRÉ-REQUISITOS para o disparo automático (mesmo padrão da 0038):
--   1) Secrets do Vault 'project_url' e 'service_role_key'.
--   2) Extensão pg_cron habilitada (via Dashboard se `db push` não tiver
--      permissão — ver aviso no bloco final).
--   3) Edge Function deployada e template aprovado na Meta:
--        supabase functions deploy send-missed-measurement-alert
--        supabase secrets set WHATSAPP_MISSED_MEASUREMENT_TEMPLATE_NAME=alerta_medicao_esquecida_vitalsync
--   4) cron.schedule idempotente — remove o job antes de recriar.
--
-- Fuso: America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019).
-- 13:15/23:15 UTC = 10:15/20:15 America/Sao_Paulo.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0060.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) enqueue_missed_measurement_alerts — resolve pacientes elegíveis +
--    destinatários e cria os logs PENDING (ou SKIPPED_TEST_MODE).
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_missed_measurement_alerts(p_period text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mode        boolean;
  v_recipients  text[];
  v_env         text;
  v_count       int := 0;
  v_period      public.measurement_period;
  p             record;
  rec           record;
  v_has_nurse   boolean;
  v_status      text;
  v_error       text;
begin
  if p_period not in ('MORNING', 'NIGHT') then
    raise exception 'Período inválido: %', p_period;
  end if;
  v_period := p_period::public.measurement_period;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  for p in
    select pt.id, pt.name, pt.team_id, pt.is_test
    from public.patients pt
    where pt.status = 'ACTIVE'
      and pt.hospital_discharge_date is not null
      and pt.hospital_discharge_date + 10 >= current_date
      and not exists (
        select 1 from public.vital_sign_records v
        where v.patient_id = pt.id
          and v.record_date = current_date
          and v.period = v_period
      )
      and not exists (
        select 1 from public.missed_measurement_logs ml
        where ml.patient_id = pt.id
          and ml.period = v_period
          and ml.missed_date = current_date
      )
  loop
    v_has_nurse := exists (
      select 1 from public.team_members m
      join public.profiles prof on prof.id = m.doctor_id
      where m.team_id = p.team_id
        and m.status = 'ACTIVE'
        and m.role_in_team = 'NURSING_PROFESSIONAL'
        and prof.status = 'ACTIVE'
    );

    for rec in
      select ids.id, prof.name, prof.whatsapp, ids.is_nurse
      from (
        select m.doctor_id as id, true as is_nurse
          from public.team_members m
          where m.team_id = p.team_id and m.status = 'ACTIVE' and m.role_in_team = 'NURSING_PROFESSIONAL'
          and v_has_nurse
        union
        select t.main_surgeon_id as id, false as is_nurse
          from public.medical_teams t
          where t.id = p.team_id and t.main_surgeon_id is not null and not v_has_nurse
        union
        select m.doctor_id as id, false as is_nurse
          from public.team_members m
          where m.team_id = p.team_id and m.status = 'ACTIVE' and not v_has_nurse
      ) ids
      join public.profiles prof on prof.id = ids.id
      where prof.status = 'ACTIVE'
    loop
      if v_mode and not exists (
        select 1 from unnest(v_recipients) x
        where rec.whatsapp is not null
          and public.normalize_phone(x) = public.normalize_phone(rec.whatsapp)
      ) then
        v_status := 'SKIPPED_TEST_MODE';
        v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
      else
        v_status := 'PENDING';
        v_error  := null;
      end if;

      insert into public.missed_measurement_logs
        (patient_id, team_id, period, missed_date, recipient_profile_id, recipient_name,
         recipient_phone, recipient_is_nurse, channel, status, template_name, environment,
         is_test, error_message, sent_at)
      values
        (p.id, p.team_id, v_period, current_date, rec.id, rec.name,
         rec.whatsapp, rec.is_nurse, 'whatsapp', v_status, 'alerta_medicao_esquecida_vitalsync', v_env,
         coalesce(p.is_test, false), v_error,
         case when v_status = 'PENDING' then null else now() end)
      on conflict (patient_id, period, missed_date, recipient_profile_id) do nothing;

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) dispatch_missed_measurement_alerts — enfileira e, se houver PENDING
--    novos e os secrets do Vault estiverem configurados, chama a Edge
--    Function send-missed-measurement-alert via pg_net (mesmo padrão da 0038).
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_missed_measurement_alerts(p_period text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url      text;
  v_key      text;
  v_enqueued int;
begin
  v_enqueued := public.enqueue_missed_measurement_alerts(p_period);
  if v_enqueued = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'send-missed-measurement-alert não disparado: configure os secrets project_url/service_role_key no Vault.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-missed-measurement-alert',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('period', p_period)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Agendamento via pg_cron — 10:15 e 20:15 America/Sao_Paulo (13:15/23:15
--    UTC), 15 minutos depois do fechamento de cada janela. Idempotente:
--    remove os jobs antigos (se existirem) antes de recriar.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception
  when insufficient_privilege then
    raise warning 'pg_cron não pôde ser habilitado automaticamente (permissão insuficiente). Habilite a extensão pelo Dashboard → Database → Extensions e rode esta migration novamente para criar os agendamentos.';
  when raise_exception then
    -- Ver 0038: fora do banco de `cron.database_name`, o pg_cron recusa a
    -- instalação com RAISE próprio (P0001), que escapa de insufficient_privilege.
    raise warning 'pg_cron não pôde ser habilitado neste banco (%). Os agendamentos desta migration não foram criados.', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('missed-measurement-alert-morning', 'missed-measurement-alert-night');

    perform cron.schedule(
      'missed-measurement-alert-morning',
      '15 13 * * *',
      $sql$select public.dispatch_missed_measurement_alerts('MORNING');$sql$
    );

    perform cron.schedule(
      'missed-measurement-alert-night',
      '15 23 * * *',
      $sql$select public.dispatch_missed_measurement_alerts('NIGHT');$sql$
    );
  else
    raise warning 'pg_cron indisponível — agendamentos NÃO criados. Habilite a extensão e rode esta migration novamente.';
  end if;
end;
$$;
