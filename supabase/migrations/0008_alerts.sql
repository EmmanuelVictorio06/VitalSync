-- ============================================================================
-- VitalSync — Aba "Alertas": central de acompanhamento clínico
--
-- ADITIVO e IDEMPOTENTE. Rode no SQL Editor DEPOIS de 0001..0007.
-- Não apaga dados. Mantém o escopo por equipe já existente (RLS:
-- is_admin() OR is_team_member(team_id)).
--
-- Notificação por WhatsApp: ainda NÃO há provedor real (Twilio/Meta). Aqui a
-- função notify_team_of_alert() registra um log SIMULADO por médico da equipe
-- (status 'sent'). PRODUÇÃO: trocar por Edge Function + provedor, atualizando
-- notification_logs.status para sent/delivered/failed de verdade.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) clinical_alerts: tipo do sinal, status de atendimento, justificativa
-- ----------------------------------------------------------------------------
alter table public.clinical_alerts
  add column if not exists type              text,
  add column if not exists attendance_status text not null default 'PENDING',
  add column if not exists ignored_reason    text,
  add column if not exists updated_at         timestamptz;

do $$ begin
  alter table public.clinical_alerts
    add constraint clinical_alerts_attendance_status_chk
    check (attendance_status in ('PENDING','IN_ANALYSIS','ATTENDED','IGNORED'));
exception when duplicate_object then null; end $$;

-- Alertas já atendidos (modelo antigo) viram ATTENDED.
update public.clinical_alerts
  set attendance_status = 'ATTENDED'
  where attended = true and attendance_status = 'PENDING';

create index if not exists idx_alerts_attendance_status on public.clinical_alerts(attendance_status);

-- ----------------------------------------------------------------------------
-- 2) attendance_confirmations: vincular ao alerta + status + observação
--    (a tabela já existia com patient_id/attended_by/attended_at)
-- ----------------------------------------------------------------------------
alter table public.attendance_confirmations
  add column if not exists alert_id    uuid references public.clinical_alerts(id) on delete cascade,
  add column if not exists status      text,
  add column if not exists observation text,
  add column if not exists created_at  timestamptz not null default now();

create index if not exists idx_attendance_alert on public.attendance_confirmations(alert_id);

-- ----------------------------------------------------------------------------
-- 3) notification_logs: vincular ao alerta + delivered_at
-- ----------------------------------------------------------------------------
alter table public.notification_logs
  add column if not exists alert_id     uuid references public.clinical_alerts(id) on delete cascade,
  add column if not exists delivered_at timestamptz;

create index if not exists idx_notif_alert on public.notification_logs(alert_id);

-- A equipe pode LER os logs dos próprios alertas (antes só admin via notif_admin_read).
drop policy if exists notif_team_read on public.notification_logs;
create policy notif_team_read on public.notification_logs for select to authenticated
  using (
    public.is_admin()
    or (alert_id is not null and exists (
      select 1 from public.clinical_alerts a
      where a.id = notification_logs.alert_id and public.is_team_member(a.team_id)
    ))
  );

-- ----------------------------------------------------------------------------
-- 4) Auditoria de ações sobre alertas (reutiliza audit_logs do 0003)
-- ----------------------------------------------------------------------------
create or replace function public.audit_alert_action(p_action text, p_patient uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text; v_pname text;
begin
  select name, role::text into v_name, v_role from public.profiles where id = auth.uid();
  select name into v_pname from public.patients where id = p_patient;
  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name,'—'), coalesce(v_role,'—'), p_action, 'Paciente · ' || coalesce(v_pname,'—'));
end; $$;

-- ----------------------------------------------------------------------------
-- 5) Notificação SIMULADA da equipe (placeholder p/ Edge Function + provedor)
--    Registra um log por médico ATIVO (cirurgião principal + associados).
-- ----------------------------------------------------------------------------
create or replace function public.notify_team_of_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert public.clinical_alerts;
  v_msg text := 'Atenção! Um paciente da sua equipe apresentou alteração no acompanhamento '
             || 'pós-operatório. Acesse o VitalSync para verificar.';
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return; end if;

  insert into public.notification_logs
    (patient_id, alert_id, recipient_profile_id, recipient_phone, channel, status, message, sent_at)
  select v_alert.patient_id, p_alert, prof.id, prof.whatsapp, 'whatsapp', 'sent', v_msg, now()
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
  where prof.status = 'ACTIVE';
end; $$;

-- ----------------------------------------------------------------------------
-- 6) submit_vital_record: agora grava o TIPO do sinal e dispara a notificação.
--    (mesma assinatura do 0002 — substitui a função.)
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

  -- Tipo do sinal que disparou (prioriza o mais crítico). Alinhado às regras acima.
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
    urination_count, vomiting_count, has_bleeding, steps, wound_photo_path, clinical_status
  ) values (
    v_patient.id, p_period::public.measurement_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_vomiting_count, coalesce(p_has_bleeding, false), p_steps, p_wound_photo_path, v_status
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

  -- Só gera alerta quando NÃO está estável (GREEN nunca gera alerta).
  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end)
    returning id into v_alert_id;
    -- Notifica a equipe (simulado). PRODUÇÃO: Edge Function send-whatsapp-alert.
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  return v_status::text;
end; $$;

grant execute on function public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) Ações de atendimento (SECURITY DEFINER; revalidam o vínculo por equipe).
--    O frontend NÃO escreve direto: chama estas RPCs (campos obrigatórios +
--    timeline em attendance_confirmations + auditoria).
-- ----------------------------------------------------------------------------
create or replace function public.alert_set_in_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;
  update public.clinical_alerts
    set attendance_status = 'IN_ANALYSIS', updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IN_ANALYSIS', null);
  perform public.audit_alert_action('ALERT_IN_ANALYSIS', v_alert.patient_id);
end; $$;

create or replace function public.alert_mark_attended(p_alert uuid, p_professional uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Descreva brevemente a conduta ou observação do atendimento.';
  end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;
  update public.clinical_alerts
    set attendance_status = 'ATTENDED', attended = true,
        attended_by = coalesce(p_professional, auth.uid()), attended_at = now(), updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, coalesce(p_professional, auth.uid()), 'ATTENDED', p_observation);
  perform public.audit_alert_action('ALERT_ATTENDED', v_alert.patient_id);
end; $$;

create or replace function public.alert_ignore(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe a justificativa para ignorar o alerta.';
  end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;
  update public.clinical_alerts
    set attendance_status = 'IGNORED', ignored_reason = p_reason,
        attended = true, attended_by = auth.uid(), attended_at = now(), updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IGNORED', p_reason);
  perform public.audit_alert_action('ALERT_IGNORED', v_alert.patient_id);
end; $$;

-- Reenvio de notificação: só Admin ou Cirurgião Principal da equipe.
create or replace function public.alert_resend_notification(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_main_surgeon_of(v_alert.team_id)) then
    raise exception 'Sem permissão para reenviar este alerta.';
  end if;
  perform public.notify_team_of_alert(p_alert);
  perform public.audit_alert_action('ALERT_RESEND', v_alert.patient_id);
end; $$;

grant execute on function public.alert_set_in_analysis(uuid) to authenticated;
grant execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;
grant execute on function public.alert_ignore(uuid, text) to authenticated;
grant execute on function public.alert_resend_notification(uuid) to authenticated;
