-- ============================================================================
-- VitalSync — Modo de Homologação Médica (semana de testes com médicos)
--
-- ADITIVO e IDEMPOTENTE. Não apaga dados.
--
-- NOTA: este arquivo era 0010_homologation.sql, mas havia DOIS arquivos com o
-- prefixo 0010 (junto de 0010_alert_attendance_guard.sql), o que quebra o
-- `supabase db push` (colisão de versão em schema_migrations). Foi renomeado
-- para 0018 para ter uma versão única. O conteúdo permanece idempotente.
--
-- Objetivo: permitir simular o uso real (pacientes fictícios, sinais vitais,
-- alertas, WhatsApp) sem disparar mensagens para números indevidos nem poluir
-- os dados oficiais. O GATE de envio vive AQUI (na função SQL que o app chama
-- de verdade — submit_vital_record → notify_team_of_alert), garantindo que a
-- regra seja real independentemente do provedor. O envio Meta real é feito pela
-- Edge Function send-whatsapp-alert (acionada por Database Webhook), que apenas
-- entrega os logs marcados como PENDING.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Configuração da homologação (linha única) — flag + whitelist de números.
--    Só ADMIN lê/escreve a linha; a flag é exposta a todos via RPC público
--    (is_homologation_mode) para o badge "Ambiente de teste".
-- ----------------------------------------------------------------------------
create table if not exists public.homologation_settings (
  id                boolean primary key default true,
  homologation_mode boolean not null default false,
  test_recipients   text[]  not null default '{}',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  constraint homologation_settings_singleton check (id)
);
insert into public.homologation_settings (id) values (true) on conflict (id) do nothing;

alter table public.homologation_settings enable row level security;
drop policy if exists homologation_admin on public.homologation_settings;
create policy homologation_admin on public.homologation_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2) Helpers
-- ----------------------------------------------------------------------------
-- Flag de homologação — visível a qualquer um (badge). SECURITY DEFINER para
-- contornar o RLS admin-only da tabela sem expor a whitelist.
create or replace function public.is_homologation_mode()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select homologation_mode from public.homologation_settings where id), false);
$$;
grant execute on function public.is_homologation_mode() to anon, authenticated;

-- Normaliza telefone para comparação (apenas dígitos).
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;
grant execute on function public.normalize_phone(text) to anon, authenticated;

-- Auditoria das ações de homologação (reutiliza audit_logs do 0003).
create or replace function public.audit_homologation(p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text;
begin
  select name, role::text into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name, '—'), coalesce(v_role, '—'), p_action, 'Homologação');
end; $$;

-- ----------------------------------------------------------------------------
-- 3) Marcação de dados de teste (is_test) nas entidades principais + metadados
--    de notificação (environment / nome / template / read_at).
-- ----------------------------------------------------------------------------
alter table public.patients                 add column if not exists is_test boolean not null default false;
alter table public.vital_sign_records       add column if not exists is_test boolean not null default false;
alter table public.clinical_alerts          add column if not exists is_test boolean not null default false;
alter table public.attendance_confirmations add column if not exists is_test boolean not null default false;
alter table public.notification_logs
  add column if not exists is_test        boolean not null default false,
  add column if not exists environment    text not null default 'production',
  add column if not exists recipient_name text,
  add column if not exists template_name  text,
  add column if not exists read_at        timestamptz;

create index if not exists idx_patients_is_test on public.patients(is_test);
create index if not exists idx_notif_environment on public.notification_logs(environment);
create index if not exists idx_notif_provider_msg on public.notification_logs(provider_message_id);

-- ----------------------------------------------------------------------------
-- 4) submit_vital_record — propaga is_test do paciente para a medição e o alerta
--    (mesma assinatura/lógica do 0008; só acrescenta is_test).
-- ----------------------------------------------------------------------------
create or replace function public.submit_vital_record(
  p_token             text,
  p_period            text,
  p_temperature       numeric default null,
  p_oxygen_saturation int     default null,
  p_systolic          int     default null,
  p_diastolic         int     default null,
  p_heart_rate        int     default null,
  p_pain              int     default null,
  p_dyspnea           int     default null,
  p_urination_count   int     default null,
  p_vomiting_count    int     default null,
  p_has_bleeding      boolean default false,
  p_steps             int     default null,
  p_wound_photo_path  text    default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient public.patients;
  v_status  public.clinical_status := 'GREEN';
  v_day     int;
  v_record_id uuid;
  v_alert_id  uuid;
  v_type    text;
begin
  select * into v_patient from public.patients where secure_token = p_token and status = 'ACTIVE';
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  if coalesce(p_temperature, 0) >= 38.5 or coalesce(p_oxygen_saturation, 100) < 92
     or coalesce(p_pain, 0) >= 8 or coalesce(p_has_bleeding, false) then
    v_status := 'RED';
  elsif coalesce(p_temperature, 0) >= 37.8 or coalesce(p_oxygen_saturation, 100) < 94
     or coalesce(p_pain, 0) >= 5 then
    v_status := 'YELLOW';
  end if;

  v_type := case
    when coalesce(p_has_bleeding, false) then 'Sangramento'
    when coalesce(p_temperature, 0) >= 37.8 then 'Temperatura'
    when coalesce(p_oxygen_saturation, 100) < 94 then 'Saturação'
    when coalesce(p_pain, 0) >= 5 then 'Dor'
    else 'Sinais vitais'
  end;

  v_day := case when v_patient.hospital_discharge_date is not null
                then greatest(1, (current_date - v_patient.hospital_discharge_date) + 1) end;

  insert into public.vital_sign_records (
    patient_id, period, monitoring_day, temperature, oxygen_saturation,
    systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
    urination_count, vomiting_count, has_bleeding, steps, wound_photo_path, clinical_status,
    is_test
  ) values (
    v_patient.id, p_period::public.measurement_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_vomiting_count, coalesce(p_has_bleeding, false), p_steps, p_wound_photo_path, v_status,
    coalesce(v_patient.is_test, false)
  )
  on conflict (patient_id, record_date, period) do update set
    temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
    systolic_pressure = excluded.systolic_pressure, diastolic_pressure = excluded.diastolic_pressure,
    heart_rate = excluded.heart_rate, pain_level = excluded.pain_level, dyspnea_level = excluded.dyspnea_level,
    urination_count = excluded.urination_count, vomiting_count = excluded.vomiting_count,
    has_bleeding = excluded.has_bleeding, steps = excluded.steps,
    wound_photo_path = coalesce(excluded.wound_photo_path, public.vital_sign_records.wound_photo_path),
    clinical_status = excluded.clinical_status
  returning id into v_record_id;

  update public.patients set current_status = v_status where id = v_patient.id;

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false))
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  return v_status::text;
end; $$;

grant execute on function public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) notify_team_of_alert — GATE de homologação + criação dos logs por médico.
--    Em homologação, só números na whitelist ficam PENDING (a Edge Function
--    entrega); os demais ficam SKIPPED_TEST_MODE (registrados, não enviados).
-- ----------------------------------------------------------------------------
create or replace function public.notify_team_of_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert public.clinical_alerts;
  v_mode boolean;
  v_recipients text[];
  v_env  text;
  v_msg text := 'Atenção! Um paciente da sua equipe apresentou alteração no acompanhamento '
             || 'pós-operatório. Acesse o VitalSync para verificar os detalhes.';
  r record;
  v_status text;
  v_error  text;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return; end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env := case when v_mode then 'homologation' else 'production' end;

  for r in
    select prof.id, prof.name, prof.whatsapp
    from (
      select t.main_surgeon_id as id
        from public.medical_teams t
        where t.id = v_alert.team_id and t.main_surgeon_id is not null
      union
      select m.doctor_id as id
        from public.team_members m
        where m.team_id = v_alert.team_id and m.status = 'ACTIVE'
    ) ids
    join public.profiles prof on prof.id = ids.id
    where prof.status = 'ACTIVE'
  loop
    -- Em homologação: só envia para números explicitamente autorizados.
    if v_mode and not exists (
      select 1 from unnest(v_recipients) x
      where r.whatsapp is not null
        and public.normalize_phone(x) = public.normalize_phone(r.whatsapp)
    ) then
      v_status := 'SKIPPED_TEST_MODE';
      v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
    else
      v_status := 'PENDING';
      v_error  := null;
    end if;

    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at)
    values
      (v_alert.patient_id, p_alert, r.id, r.name, r.whatsapp,
       'whatsapp', v_status, v_msg, 'alerta_clinico_vitalsync', v_env,
       coalesce(v_alert.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end);
  end loop;
end; $$;

-- ----------------------------------------------------------------------------
-- 6) RPCs administrativas (ADMIN) — painel de homologação.
-- ----------------------------------------------------------------------------
create or replace function public.homologation_set_mode(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  update public.homologation_settings
    set homologation_mode = coalesce(p_on, false), updated_at = now(), updated_by = auth.uid()
    where id;
  perform public.audit_homologation(case when p_on then 'HOMOLOGATION_ON' else 'HOMOLOGATION_OFF' end);
end; $$;

create or replace function public.homologation_set_recipients(p_recipients text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  update public.homologation_settings
    set test_recipients = coalesce(p_recipients, '{}'), updated_at = now(), updated_by = auth.uid()
    where id;
  perform public.audit_homologation('HOMOLOGATION_RECIPIENTS');
end; $$;

create or replace function public.homologation_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  select json_build_object(
    'homologation_mode', (select homologation_mode from public.homologation_settings where id),
    'test_patients',     (select count(*) from public.patients where is_test),
    'test_alerts',       (select count(*) from public.clinical_alerts where is_test),
    'whatsapp_sent',     (select count(*) from public.notification_logs
                            where is_test and status in ('SENT','sent','logged','DELIVERED','READ')),
    'whatsapp_failed',   (select count(*) from public.notification_logs
                            where is_test and status in ('FAILED','failed')),
    'whatsapp_skipped',  (select count(*) from public.notification_logs where status = 'SKIPPED_TEST_MODE'),
    'authorized_numbers',(select coalesce(array_length(test_recipients, 1), 0)
                            from public.homologation_settings where id),
    'recipients',        (select coalesce(to_json(test_recipients), '[]'::json)
                            from public.homologation_settings where id)
  ) into v;
  return v;
end; $$;

-- Limpeza segura: remove APENAS dados marcados como teste (is_test). Pacientes
-- de teste cascateiam para vitals/alertas/atendimentos; os logs de teste são
-- removidos explicitamente (FK patient_id é ON DELETE SET NULL).
create or replace function public.admin_clear_test_data()
returns json language plpgsql security definer set search_path = public as $$
declare v_patients int; v_logs int;
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  delete from public.notification_logs where is_test;
  get diagnostics v_logs = row_count;
  delete from public.patients where is_test;
  get diagnostics v_patients = row_count;
  perform public.audit_homologation('HOMOLOGATION_CLEAR');
  return json_build_object('patients_deleted', v_patients, 'logs_deleted', v_logs);
end; $$;

grant execute on function public.homologation_set_mode(boolean)      to authenticated;
grant execute on function public.homologation_set_recipients(text[]) to authenticated;
grant execute on function public.homologation_stats()                to authenticated;
grant execute on function public.admin_clear_test_data()             to authenticated;
