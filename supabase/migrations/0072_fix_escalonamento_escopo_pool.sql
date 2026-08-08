-- ============================================================================
-- Migration: 0072_fix_escalonamento_escopo_pool
--
-- CORREÇÃO DE BUG encontrado ao aplicar as migrations num banco de dev.
--
-- A 0064 criou `alert_escalate_to_red` com a guarda de permissão da época:
--     if not (is_admin() or is_team_member(...)) then raise 'Sem permissão'
-- e deixou escrito no cabeçalho que a permissão "seria estendida depois pela
-- 0066/0068". Isso NUNCA aconteceu: a 0067 reescreveu as outras cinco RPCs de
-- alerta para usarem `can_act_on_alert()` (que inclui o enfermeiro do pool) e
-- esqueceu justamente esta.
--
-- EFEITO PRÁTICO: o botão "Escalar para o médico" — o centro de todo o fluxo
-- de triagem — falhava com "Sem permissão para este alerta." para exatamente o
-- enfermeiro para quem a funcionalidade foi construída: o membro do pool que
-- NÃO é membro da equipe do paciente. Só funcionava para quem já era da equipe,
-- que é o caso que o pool existe para dispensar.
--
-- Passou despercebido porque nenhuma migration havia sido executada até aqui;
-- typecheck e testes de frontend não alcançam guarda de permissão em plpgsql.
--
-- Além de corrigir a guarda, aplica a extensão que a 0068 também prometeu: o
-- enfermeiro a quem o alerta está ATRIBUÍDO (`assigned_nurse_id`) pode escalar
-- mesmo sem ter travado o lock — a oferta é a preferência dele, e exigir o lock
-- para escalar criaria um passo inútil.
--
-- ADITIVA e IDEMPOTENTE. Rode após a 0071.
-- ============================================================================

create or replace function public.alert_escalate_to_red(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Descreva por que este caso precisa do médico.';
  end if;

  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;

  -- CORRIGIDO: usa a mesma guarda das demais RPCs (0067), que inclui o
  -- enfermeiro do pool; e aceita também o enfermeiro a quem o alerta foi
  -- oferecido, mesmo que ainda não tenha travado o lock.
  if not (
       public.can_act_on_alert(v_alert.team_id, v_alert.patient_id)
       or v_alert.assigned_nurse_id = auth.uid()
     ) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  if v_alert.status <> 'YELLOW' then
    raise exception 'Só alertas amarelos são escalados pela enfermagem. Vermelhos já são do médico da equipe.';
  end if;

  if v_alert.attendance_status in ('ATTENDED', 'IGNORED') or v_alert.attended = true then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  if v_alert.escalated_at is not null then
    raise exception 'Este alerta já foi escalado para o médico.';
  end if;

  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin() then
    raise exception 'Este alerta está em análise por outro profissional.';
  end if;

  update public.clinical_alerts
     set escalated_at      = now(),
         escalated_by      = auth.uid(),
         escalation_reason = p_reason,
         attendance_status = 'PENDING',
         assigned_nurse_id = null,
         offer_expires_at  = null,
         in_analysis_by    = null,
         in_analysis_at    = null,
         updated_at        = now()
   where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'ESCALATED', p_reason);

  perform public.audit_alert_action('ALERT_ESCALATED', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: escalonamento para o médico');
  perform public.notify_team_of_alert(p_alert);
end;
$$;

grant execute on function public.alert_escalate_to_red(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO: nenhuma RPC de alerta pode ficar fora de can_act_on_alert.
--
--   select p.proname,
--          pg_get_functiondef(p.oid) like '%can_act_on_alert%' as usa_guarda_do_pool
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('alert_set_in_analysis','alert_mark_attended','alert_ignore',
--                        'alert_release_analysis','alert_register_contact','alert_escalate_to_red')
--    order by 1;
--   --> todas devem retornar true
-- ----------------------------------------------------------------------------
