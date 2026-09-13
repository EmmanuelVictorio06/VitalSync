-- ============================================================================
-- 0080 — Enfermagem não finaliza alerta ESCALADO
--
-- PROBLEMA
-- `nurse_may_finalize` (0067) olhava só `clinical_alerts.status`. Um alerta
-- AMARELO escalado tem `status = 'YELLOW'` com `escalated_at` preenchido: pela
-- 0077 ele é VERMELHO EFETIVO e é fila do médico, mas passava pela guarda. Como
-- `alert_set_in_analysis` (0067) também não olhava `escalated_at`, o caminho
-- completo existia e era alcançável pela aba Alertas:
--
--   enfermeira escala  →  alerta volta a PENDING com escalated_at
--                      →  ela clica "Em análise" (trava)
--                      →  ela clica "Atender"    (nurse_may_finalize('YELLOW') = true)
--                      →  caso fecha sem o médico ver.
--
-- `nurse_claim_alert` (0068) já bloqueava isso corretamente, mas a aba Alertas
-- não passa pelo pool — chama `alert_set_in_analysis` direto.
--
-- DECISÃO (confirmada com o responsável clínico, set/2026)
-- Escalar existe justamente para tirar o caso da mão da enfermagem. Depois de
-- escalado, o enfermeiro não trava nem finaliza — só registra contato
-- (`alert_register_contact`, que nunca exigiu o lock).
--
-- O QUE NÃO MUDA
-- • `clinical_alerts.status` continua imutável — nada aqui o sobrescreve.
-- • Médicos, Admin e Gerente não são afetados por nenhuma guarda desta migration.
-- • O claim atômico (`update ... where in_analysis_by is null`) é preservado
--   caractere a caractere: é ele que decide a corrida entre dois profissionais.
-- • `alert_register_contact` não é tocada.
--
-- Partindo das versões VIVAS: alert_set_in_analysis e alert_ignore da 0067,
-- alert_mark_attended da 0078 (que agenda a reavaliação de 2h).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) nurse_may_finalize — agora recebe também `escalated_at`.
--
--    A 1-arg é DERRUBADA em vez de mantida: se ficasse, `create or replace` com
--    um parâmetro novo criaria uma sobrecarga e toda chamada de 1 argumento
--    viraria ambígua. Sem `default` de propósito — qualquer chamador esquecido
--    falha alto, em vez de silenciosamente liberar um alerta escalado.
-- ----------------------------------------------------------------------------
drop function if exists public.nurse_may_finalize(public.clinical_status);

create or replace function public.nurse_may_finalize(
  p_status       public.clinical_status,
  p_escalated_at timestamptz
)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or not public.is_nurse(auth.uid())
      -- Severidade EFETIVA (0077): vermelho no banco OU escalado ao médico.
      or (p_status <> 'RED' and p_escalated_at is null);
$$;

comment on function public.nurse_may_finalize(public.clinical_status, timestamptz) is
  'Bloqueia o enfermeiro de FINALIZAR alerta de severidade EFETIVA vermelha — status RED ou escalado ao médico (0077/0080). Admin é a exceção administrativa; médicos não são afetados.';

revoke execute on function public.nurse_may_finalize(public.clinical_status, timestamptz) from public, anon;
grant  execute on function public.nurse_may_finalize(public.clinical_status, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) alert_set_in_analysis — base 0067 + guarda de escalado para a enfermagem.
--    Mesma regra que `nurse_claim_alert` (0068) já aplicava no pool.
-- ----------------------------------------------------------------------------
create or replace function public.alert_set_in_analysis(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- NOVO (0080): escalado é fila do médico — o enfermeiro não trava mais.
  -- Sem exceção de Admin aqui pelo mesmo motivo documentado na 0077:
  -- `profiles.role` guarda UM papel só, ninguém é ADMIN e NURSING_PROFESSIONAL
  -- ao mesmo tempo, e `is_nurse` já barra só a enfermagem.
  if v_alert.escalated_at is not null and public.is_nurse(auth.uid()) then
    raise exception 'Este alerta já foi escalado para o médico da equipe. Você pode registrar contato, mas a condução é do médico.';
  end if;

  -- Idempotente: o dono do lock pode chamar de novo sem erro.
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
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta em análise');
end; $$;

revoke execute on function public.alert_set_in_analysis(uuid) from public, anon;
grant  execute on function public.alert_set_in_analysis(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) alert_ignore — base 0067, só a chamada da guarda muda (+ mensagem certa).
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
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- §3.4 + 0080: vermelho E escalado são do médico da equipe.
  if not public.nurse_may_finalize(v_alert.status, v_alert.escalated_at) then
    raise exception '%', case
      when v_alert.escalated_at is not null
        then 'Este alerta já foi escalado para o médico da equipe — a conclusão é dele. Registre o contato, se precisar.'
        else 'Alertas vermelhos são atendidos pelo médico da equipe. Registre o contato e, se precisar, avise a equipe.'
    end;
  end if;

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
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta ignorado');
end; $$;

revoke execute on function public.alert_ignore(uuid, text) from public, anon;
grant  execute on function public.alert_ignore(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) alert_mark_attended — base 0078 (com o agendamento da reavaliação de 2h).
--    Só a chamada da guarda muda. O bloco de `nurse_reassessments` já exigia
--    `escalated_at is null`, então continua coerente.
-- ----------------------------------------------------------------------------
create or replace function public.alert_mark_attended(
  p_alert uuid,
  p_professional uuid,
  p_observation text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert     public.clinical_alerts;
  v_quem      uuid;
  v_minutos   int;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Descreva brevemente a conduta ou observação do atendimento.';
  end if;

  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;

  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- §3.4 + 0080: vermelho E escalado são do médico da equipe.
  if not public.nurse_may_finalize(v_alert.status, v_alert.escalated_at) then
    raise exception '%', case
      when v_alert.escalated_at is not null
        then 'Este alerta já foi escalado para o médico da equipe — a conclusão é dele. Registre o contato, se precisar.'
        else 'Alertas vermelhos são atendidos pelo médico da equipe. Registre o contato e, se precisar, avise a equipe.'
    end;
  end if;

  -- Trava de responsabilidade (0045): só o dono do lock (ou Admin) finaliza.
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

  v_quem := coalesce(p_professional, auth.uid());

  update public.clinical_alerts
    set attendance_status = 'ATTENDED',
        attended = true,
        attended_by = v_quem,
        attended_at = now(),
        in_analysis_by = null,
        in_analysis_at = null,
        updated_at = now()
    where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, v_quem, 'ATTENDED', p_observation);

  perform public.audit_alert_action('ALERT_ATTENDED', v_alert.patient_id);
  perform public.log_patient_access(v_alert.patient_id, 'triagem: alerta atendido');

  -- Recontato de enfermagem (0078): severidade EFETIVA amarela + quem atendeu
  -- é enfermagem. `v_quem` (e não auth.uid()) porque a tela permite registrar o
  -- atendimento em nome do profissional que de fato atendeu.
  if public.is_nurse(v_quem)
     and v_alert.status = 'YELLOW'
     and v_alert.escalated_at is null
  then
    v_minutos := greatest(1, coalesce(public.nursing_setting_num('reassessmentMinutes', 120), 120)::int);

    -- `on conflict do nothing` + índice único parcial: se já existir uma
    -- PENDING para este alerta, não duplica. Cobre corrida e reprocessamento.
    insert into public.nurse_reassessments
      (alert_id, patient_id, team_id, scheduled_by, due_at, status)
    values
      (p_alert, v_alert.patient_id, v_alert.team_id, v_quem,
       now() + make_interval(mins => v_minutos), 'PENDING')
    on conflict do nothing;
  end if;
end; $$;

comment on function public.alert_mark_attended(uuid, uuid, text) is
  'Finaliza o atendimento do alerta e, quando quem atendeu é enfermagem e o alerta é amarelo não escalado, agenda a reavaliação de recontato (0078). Enfermagem não finaliza vermelho nem escalado (0080).';

revoke execute on function public.alert_mark_attended(uuid, uuid, text) from public, anon;
grant  execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) VERIFICAÇÃO (rode após o db push)
--
--    -- (a) só existe a versão de 2 argumentos:
--    select pronargs from pg_proc where proname = 'nurse_may_finalize';   --> 2
--
--    -- (b) nenhuma RPC ficou chamando a assinatura antiga:
--    select proname from pg_proc
--     where prosrc like '%nurse_may_finalize(v_alert.status)%';           --> 0 linhas
--
--    -- (c) casos que o furo poderia ter produzido ANTES desta migration
--    --     (leitura; se vier vazio, ninguém exerceu o caminho):
--    select a.id, a.created_at, a.escalated_at, a.attended_at, p.name, p.role
--      from public.clinical_alerts a
--      join public.profiles p on p.id = a.attended_by
--     where a.escalated_at is not null
--       and a.attendance_status in ('ATTENDED','IGNORED')
--       and p.role = 'NURSING_PROFESSIONAL';
--
--    -- (d) logado como enfermeiro, num alerta escalado:
--    --     select public.alert_set_in_analysis('<id>');  --> exceção "já foi escalado"
--    --     select public.alert_mark_attended('<id>', null, 'teste'); --> exceção
--    --     (rodar só em ambiente local / paciente de homologação)
-- ----------------------------------------------------------------------------
