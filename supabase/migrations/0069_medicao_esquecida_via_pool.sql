-- ============================================================================
-- Migration: 0069_medicao_esquecida_via_pool  (Triagem de Enfermagem — §7)
--
-- A medição esquecida (0060/0061) resolvia destinatários por EQUIPE: enfermeiro
-- membro da equipe primeiro, com fallback para cirurgião + demais membros. Com
-- o pool (0065), o roteamento passa a ser o mesmo da triagem: oferece ao
-- enfermeiro LIVRE do pool que cobre o hospital do paciente.
--
-- CADEIA DE FALLBACK (mais segura que a spec, que previa só pool → nada):
--   1. enfermeiro LIVRE do pool que cobre o hospital  (preferencial)
--   2. qualquer membro ATIVO do pool                   (pool sem ninguém livre)
--   3. equipe do paciente — comportamento da 0061      (hospital sem pool)
--   4. NO_RECIPIENT                                    (ninguém em lugar nenhum)
--
-- O passo 3 é deliberado: remover o fallback de equipe transformaria "pool mal
-- configurado" em "paciente sem ninguém avisado". NUNCA falhar em silêncio é
-- mais importante do que a pureza do roteamento.
--
-- O passo 4 grava uma linha explícita `NO_RECIPIENT` (em vez de simplesmente
-- não inserir nada) para que o buraco apareça no painel do Admin.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0068.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Linhas sem destinatário precisam existir para serem vistas.
-- ----------------------------------------------------------------------------
alter table public.missed_measurement_logs alter column recipient_profile_id drop not null;

comment on column public.missed_measurement_logs.recipient_profile_id is
  'Destinatário do aviso. NULL só em linhas NO_RECIPIENT (ninguém no pool nem na equipe) — o buraco fica registrado em vez de silencioso.';

-- A unicidade original (patient, period, date, recipient) não dedupa NULLs,
-- mas o gate de "já existe QUALQUER linha para este paciente/período/dia" no
-- corpo da função abaixo impede a duplicação.

-- ----------------------------------------------------------------------------
-- 2) enqueue_missed_measurement_alerts — reescrita da 0061 com a cadeia acima.
--    O gate de elegibilidade (ACTIVE, ≤10 dias da alta, sem medição do período
--    hoje) e o gate de homologação são idênticos aos da 0061.
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
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- com enfermeiro de plantão no pool que cobre o hospital:
--   select public.enqueue_missed_measurement_alerts('MORNING');
--   select recipient_name, recipient_is_nurse, status from public.missed_measurement_logs
--    where missed_date = current_date order by created_at desc;
--   --> recipient_is_nurse = true
--
--   -- sem pool cobrindo o hospital → cai no fallback de equipe (is_nurse=false).
--   -- sem pool E sem equipe → linha NO_RECIPIENT + entrada em audit_logs:
--   select status, error_message from public.missed_measurement_logs where status = 'NO_RECIPIENT';
--   select action, entity from public.audit_logs where action = 'MISSED_MEASUREMENT_NO_RECIPIENT';
-- ----------------------------------------------------------------------------
