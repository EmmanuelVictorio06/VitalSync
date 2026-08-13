-- ============================================================================
-- Migration: 0073_gate_inicio_janela
--
-- BUG: o gate de elegibilidade das automações de medição só tinha limite
-- SUPERIOR (`hospital_discharge_date + 10 >= current_date`). Um paciente
-- cadastrado com alta AGENDADA para amanhã (ou para a semana que vem) já
-- satisfazia esse teste — e recebia lembrete de medição e alerta de medição
-- esquecida ANTES de ter alta. Além de errado, é a pior primeira impressão
-- possível para o paciente: cobrança de um registro que ele nem podia fazer.
--
-- CORREÇÃO: acrescenta o limite INFERIOR
--     and current_date >= p.hospital_discharge_date
-- ou seja, a janela de 10 dias só ABRE no dia da alta (inclusive).
--
-- Nada mais muda. As duas funções abaixo são cópias fiéis da versão VIVA, com
-- a linha nova acrescentada ao filtro:
--   • enqueue_measurement_reminders      → versão viva na 0038
--   • enqueue_missed_measurement_alerts  → versão viva na 0069 (NÃO na 0061:
--     a 0069 reescreveu a resolução de destinatários para o pool de enfermagem;
--     partir da 0061 aqui teria REVERTIDO o roteamento por pool)
--
-- Assinaturas inalteradas, então `create or replace` preserva os privilégios
-- existentes — e é justamente por isso que o bloco de REVOKE no final é
-- necessário: os privilégios preservados incluem o EXECUTE para `anon`, que
-- estas funções de cron nunca deveriam ter tido.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0072.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) enqueue_measurement_reminders (lembrete ao PACIENTE) — cópia da 0038 com
--    o limite inferior da janela.
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
      and current_date >= p.hospital_discharge_date        -- NOVO: janela só abre na alta
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
-- 2) enqueue_missed_measurement_alerts (aviso à EQUIPE/pool) — cópia da 0069
--    com o limite inferior da janela. Cadeia de fallback intacta:
--    enfermeiro LIVRE do pool → qualquer membro do pool → equipe → NO_RECIPIENT.
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
  v_origem      text;
  v_status      text;
  v_error       text;
  v_algum       boolean;
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
    select pt.id, pt.name, pt.team_id, pt.hospital_id, pt.is_test
      from public.patients pt
     where pt.status = 'ACTIVE'
       and pt.hospital_discharge_date is not null
       and current_date >= pt.hospital_discharge_date       -- NOVO: janela só abre na alta
       and pt.hospital_discharge_date + 10 >= current_date
       and not exists (
         select 1 from public.vital_sign_records v
          where v.patient_id = pt.id and v.record_date = current_date and v.period = v_period
       )
       and not exists (
         select 1 from public.missed_measurement_logs ml
          where ml.patient_id = pt.id and ml.period = v_period and ml.missed_date = current_date
       )
  loop
    v_algum := false;

    -- (1) enfermeiro LIVRE do pool → (2) qualquer membro ativo do pool
    for v_origem in select unnest(array['LIVRE', 'POOL']) loop
      exit when v_algum;
      for rec in
        select distinct m.profile_id as id, prof.name, prof.whatsapp
          from public.nurse_pool_members m
          join public.nurse_pools pool         on pool.id = m.pool_id and pool.is_active
          join public.nurse_pool_hospitals nph on nph.pool_id = pool.id and nph.hospital_id = p.hospital_id
          join public.profiles prof            on prof.id = m.profile_id and prof.status = 'ACTIVE'
         where m.is_active
           and p.hospital_id is not null
           and (v_origem <> 'LIVRE' or public.nurse_is_free(m.profile_id))
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
           rec.whatsapp, true, 'whatsapp', v_status, 'alerta_medicao_esquecida_vitalsync', v_env,
           coalesce(p.is_test, false), v_error,
           case when v_status = 'PENDING' then null else now() end)
        on conflict (patient_id, period, missed_date, recipient_profile_id) do nothing;

        v_algum := true;
        v_count := v_count + 1;
      end loop;
    end loop;

    -- (3) fallback de EQUIPE (comportamento da 0061) quando não há pool.
    if not v_algum then
      for rec in
        select prof.id, prof.name, prof.whatsapp
          from (
            select t.main_surgeon_id as id from public.medical_teams t
             where t.id = p.team_id and t.main_surgeon_id is not null
            union
            select m.doctor_id as id from public.team_members m
             where m.team_id = p.team_id and m.status = 'ACTIVE'
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
           rec.whatsapp, false, 'whatsapp', v_status, 'alerta_medicao_esquecida_vitalsync', v_env,
           coalesce(p.is_test, false), v_error,
           case when v_status = 'PENDING' then null else now() end)
        on conflict (patient_id, period, missed_date, recipient_profile_id) do nothing;

        v_algum := true;
        v_count := v_count + 1;
      end loop;
    end if;

    -- (4) ninguém em lugar nenhum: registra o buraco em vez de silenciar.
    if not v_algum then
      insert into public.missed_measurement_logs
        (patient_id, team_id, period, missed_date, recipient_profile_id, recipient_name,
         recipient_phone, recipient_is_nurse, channel, status, template_name, environment,
         is_test, error_message, sent_at)
      values
        (p.id, p.team_id, v_period, current_date, null, null,
         null, false, 'whatsapp', 'NO_RECIPIENT', 'alerta_medicao_esquecida_vitalsync', v_env,
         coalesce(p.is_test, false),
         'Nenhum enfermeiro no pool que cobre o hospital e nenhum membro ativo na equipe do paciente.',
         now());

      insert into public.audit_logs (actor_name, actor_role, action, entity)
      values ('Sistema', 'SYSTEM', 'MISSED_MEASUREMENT_NO_RECIPIENT',
              'Paciente · ' || p.name || ' — sem destinatário para o aviso de medição esquecida');
    end if;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Privilégios — estas quatro funções são de CRON, nunca do app.
--    `create or replace` preserva os grants antigos, e o antigo aqui é o grant
--    DIRETO que o Supabase dá a anon/authenticated (ALTER DEFAULT PRIVILEGES):
--    hoje `anon` consegue chamar enqueue/dispatch e forçar envio de WhatsApp.
--    Revogar não altera nenhuma lógica: o pg_cron roda como superusuário e o
--    disparo manual continua funcionando pelo SQL Editor (role postgres).
-- ----------------------------------------------------------------------------
revoke execute on function public.enqueue_measurement_reminders(text)       from public, anon, authenticated;
revoke execute on function public.dispatch_measurement_reminders(text)      from public, anon, authenticated;
revoke execute on function public.enqueue_missed_measurement_alerts(text)   from public, anon, authenticated;
revoke execute on function public.dispatch_missed_measurement_alerts(text)  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- Paciente com alta AMANHÃ não recebe nada hoje:
--   update public.patients set hospital_discharge_date = current_date + 1
--    where id = '<patient_id>';
--   select public.enqueue_measurement_reminders('MORNING');       --> 0
--   select public.enqueue_missed_measurement_alerts('MORNING');   --> 0
--
--   -- Mesmo paciente com alta HOJE volta a ser elegível:
--   update public.patients set hospital_discharge_date = current_date
--    where id = '<patient_id>';
--   select public.enqueue_measurement_reminders('MORNING');       --> 1
--
--   -- O limite superior continua valendo (alta há 11 dias → 0):
--   update public.patients set hospital_discharge_date = current_date - 11
--    where id = '<patient_id>';
--   select public.enqueue_measurement_reminders('MORNING');       --> 0
--
--   -- Privilégios revogados:
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('enqueue_measurement_reminders', 'dispatch_measurement_reminders',
--                        'enqueue_missed_measurement_alerts', 'dispatch_missed_measurement_alerts');
--   --> f / f nas quatro linhas
-- ----------------------------------------------------------------------------
