-- ============================================================================
-- VitalSync - atendimento deve ser unico por alerta atual
--
-- A tela de Acompanhamento Individual passa a marcar o alerta clinico atual.
-- Esta RPC protege o mesmo contrato no banco: o mesmo alerta nao pode ser
-- finalizado duas vezes nem ter o profissional trocado depois de atendido.
-- ============================================================================

create or replace function public.alert_mark_attended(p_alert uuid, p_professional uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert public.clinical_alerts;
begin
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
        updated_at = now()
    where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, coalesce(p_professional, auth.uid()), 'ATTENDED', p_observation);

  perform public.audit_alert_action('ALERT_ATTENDED', v_alert.patient_id);
end; $$;

grant execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;
