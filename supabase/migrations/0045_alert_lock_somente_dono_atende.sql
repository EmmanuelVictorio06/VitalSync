-- ============================================================================
-- Migration: 0045_alert_lock_somente_dono_atende
--
-- Endurece a trava de atendimento da 0044: o Cirurgião Principal da equipe
-- NÃO atropela mais o lock. Com o alerta em análise por outro profissional,
-- ele (como qualquer membro) não pode atender/ignorar direto — o caminho é
-- "Liberar" o alerta de volta à fila (alert_release_analysis, que continua
-- permitida ao dono do lock, Admin e Cirurgião Principal) e então assumi-lo.
-- Assim a autoria do atendimento nunca salta o lock.
--
-- O Admin segue passando pela trava (exceção administrativa; na UI ele nem vê
-- os botões de atendimento). Reescreve apenas alert_mark_attended e
-- alert_ignore a partir da 0044; alert_set_in_analysis e
-- alert_release_analysis ficam como estão.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) alert_mark_attended: só o dono do lock (ou Admin) finaliza
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

  -- Trava de responsabilidade: somente quem colocou em análise (ou Admin)
  -- finaliza. O Cirurgião Principal deve liberar o alerta antes de assumir.
  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin() then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta. Libere-o de volta à fila para assumir o atendimento.';
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
-- 2) alert_ignore: mesma regra (só o dono do lock ou Admin)
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
     and not public.is_admin() then
    raise exception 'Somente o profissional que colocou em análise pode atender este alerta. Libere-o de volta à fila para assumir o atendimento.';
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

grant execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;
grant execute on function public.alert_ignore(uuid, text)              to authenticated;
