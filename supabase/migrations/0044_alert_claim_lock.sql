-- ============================================================================
-- Migration: 0044_alert_claim_lock
--
-- Trava de atendimento ("claim/lock") de alertas clínicos: quando um médico
-- coloca um alerta em análise, ele passa a ser o responsável — o alerta exibe
-- "EM ANÁLISE POR [nome]" e somente ele (além do Admin e do Cirurgião
-- Principal da equipe) pode atender/ignorar. Evita que dois médicos atuem no
-- mesmo alerta sem saber um do outro.
--
-- - clinical_alerts ganha in_analysis_by/in_analysis_at (quem travou e quando).
-- - alert_set_in_analysis vira um claim ATÔMICO (update ... where
--   in_analysis_by is null): quem chegar primeiro leva; idempotente para o
--   próprio dono; erro claro se já travado por outro.
-- - alert_mark_attended / alert_ignore respeitam a trava e limpam o lock ao
--   finalizar.
-- - Nova RPC alert_release_analysis devolve o alerta à fila (PENDING).
--
-- Reescreve as RPCs a partir das versões mais recentes (0039 — bloqueio de
-- TEAM_MANAGER — e 0010 — guarda de dupla finalização). Não altera o CHECK de
-- attendance_status. ADITIVA e IDEMPOTENTE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Colunas do lock
-- ----------------------------------------------------------------------------
alter table public.clinical_alerts
  add column if not exists in_analysis_by uuid references public.profiles(id),
  add column if not exists in_analysis_at timestamptz;

comment on column public.clinical_alerts.in_analysis_by is
  'Médico que travou o alerta para atendimento (identificador de responsabilidade; relações reais seguem por profiles.id). Null = alerta livre.';
comment on column public.clinical_alerts.in_analysis_at is
  'Quando o alerta foi travado para análise. Limpo ao atender/ignorar/liberar.';

-- ----------------------------------------------------------------------------
-- 2) alert_set_in_analysis: claim atômico do alerta
-- ----------------------------------------------------------------------------
create or replace function public.alert_set_in_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Idempotente: o dono do lock pode chamar de novo sem erro (e sem duplicar timeline).
  if v_alert.in_analysis_by = auth.uid() then return; end if;

  -- Claim atômico: só trava se ninguém travou antes (corrida decidida pelo banco).
  update public.clinical_alerts
    set attendance_status = 'IN_ANALYSIS',
        in_analysis_by = auth.uid(),
        in_analysis_at = now(),
        updated_at = now()
    where id = p_alert and in_analysis_by is null;
  if not found then
    raise exception 'Alerta já está em análise por outro profissional.';
  end if;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IN_ANALYSIS', null);
  perform public.audit_alert_action('ALERT_IN_ANALYSIS', v_alert.patient_id);
end; $$;

-- ----------------------------------------------------------------------------
-- 3) alert_mark_attended: respeita a trava e limpa o lock ao finalizar
-- ----------------------------------------------------------------------------
create or replace function public.alert_mark_attended(p_alert uuid, p_professional uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Descreva brevemente a conduta ou observação do atendimento.';
  end if;

  select * into v_alert
  from public.clinical_alerts
  where id = p_alert
  for update;

  if not found then
    raise exception 'Alerta não encontrado.';
  end if;

  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Trava de responsabilidade: quem colocou em análise (ou Admin/Cirurgião
  -- Principal da equipe) é quem finaliza.
  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin()
     and not public.is_main_surgeon_of(v_alert.team_id) then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta.';
  end if;

  if v_alert.attendance_status = 'ATTENDED' or v_alert.attended = true then
    raise exception 'Este alerta já foi atendido.';
  end if;

  if v_alert.attendance_status = 'IGNORED' then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'ATTENDED',
        attended = true,
        attended_by = coalesce(p_professional, auth.uid()),
        attended_at = now(),
        in_analysis_by = null,
        in_analysis_at = null,
        updated_at = now()
    where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, coalesce(p_professional, auth.uid()), 'ATTENDED', p_observation);

  perform public.audit_alert_action('ALERT_ATTENDED', v_alert.patient_id);
end; $$;

-- ----------------------------------------------------------------------------
-- 4) alert_ignore: respeita a trava e limpa o lock ao finalizar
-- ----------------------------------------------------------------------------
create or replace function public.alert_ignore(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe a justificativa para ignorar o alerta.';
  end if;
  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Trava de responsabilidade (mesma regra do alert_mark_attended).
  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin()
     and not public.is_main_surgeon_of(v_alert.team_id) then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'IGNORED', ignored_reason = p_reason,
        attended = true, attended_by = auth.uid(), attended_at = now(),
        in_analysis_by = null, in_analysis_at = null, updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IGNORED', p_reason);
  perform public.audit_alert_action('ALERT_IGNORED', v_alert.patient_id);
end; $$;

-- ----------------------------------------------------------------------------
-- 5) alert_release_analysis: devolve o alerta à fila (PENDING)
--    Permitida ao dono do lock, Admin ou Cirurgião Principal da equipe.
-- ----------------------------------------------------------------------------
create or replace function public.alert_release_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;
  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  if v_alert.attendance_status <> 'IN_ANALYSIS' or v_alert.in_analysis_by is null then
    raise exception 'Este alerta não está em análise.';
  end if;

  if v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin()
     and not public.is_main_surgeon_of(v_alert.team_id) then
    raise exception 'Somente o profissional que colocou em análise (ou Admin/Cirurgião Principal) pode liberar este alerta.';
  end if;

  update public.clinical_alerts
    set attendance_status = 'PENDING',
        in_analysis_by = null,
        in_analysis_at = null,
        updated_at = now()
    where id = p_alert;

  -- 'RELEASED' não entra em "Meus Atendimentos" (o serviço filtra ATTENDED/IGNORED);
  -- aparece só na timeline do alerta.
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'RELEASED', null);
  perform public.audit_alert_action('ALERT_RELEASED', v_alert.patient_id);
end; $$;

grant execute on function public.alert_set_in_analysis(uuid)           to authenticated;
grant execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;
grant execute on function public.alert_ignore(uuid, text)              to authenticated;
grant execute on function public.alert_release_analysis(uuid)          to authenticated;
