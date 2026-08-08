-- ============================================================================
-- Migration: 0064_escalonamento_enfermagem  (Triagem de Enfermagem — Fase 0.2)
--
-- Permite que a enfermagem ESCALE um alerta amarelo para o médico, SEM
-- corromper a severidade clínica.
--
-- REGRA ESTRUTURAL: `clinical_alerts.status` vem de `eval_clinical_status`
-- (0053) / `packages/shared/src/clinical/thresholds.ts` e alimenta as métricas
-- do estudo (0055). Escalar NÃO sobrescreve `status` — grava numa camada
-- separada (`escalated_at`/`escalated_by`/`escalation_reason`). Isso preserva
-- o dado de pesquisa e mantém a distinção entre "o algoritmo classificou como
-- vermelho" e "a enfermeira julgou que precisa de médico". Quem precisa saber
-- "trate como vermelho" lê `escalated_at is not null`.
--
-- DUPLA NOTIFICAÇÃO: o trigger da 0034 é `after INSERT` em clinical_alerts —
-- o escalonamento é um UPDATE, então não o re-dispara. A chamada explícita a
-- `notify_team_of_alert` aqui cria uma NOVA leva de linhas PENDING em
-- `notification_logs`; as da criação original já estão SENT/logged e a Edge
-- Function `send-whatsapp-alert` só entrega PENDING. A idempotência do
-- escalonamento em si é garantida pelo guard `escalated_at is not null`.
--
-- NOTA DE ORDEM: a permissão desta RPC é estendida depois — a 0066 acrescenta
-- `is_nurse_for_patient()` e a 0068 acrescenta o enfermeiro a quem o alerta
-- está atribuído (`assigned_nurse_id`). Aqui ela funciona de forma autônoma
-- (dono do lock / membro da equipe / Admin), como manda a Fase 0.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0063.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Camada de escalonamento (separada da severidade clínica).
-- ----------------------------------------------------------------------------
alter table public.clinical_alerts
  add column if not exists escalated_at         timestamptz,
  add column if not exists escalated_by         uuid references public.profiles(id),
  add column if not exists escalation_reason    text,
  add column if not exists escalation_unanswered_at timestamptz;

comment on column public.clinical_alerts.escalated_at is
  'Quando a enfermagem escalou o caso para o médico. NÃO altera `status` (a severidade clínica é imutável) — quem precisa tratar como vermelho lê este campo.';
comment on column public.clinical_alerts.escalated_by is
  'Profissional de enfermagem que escalou o caso.';
comment on column public.clinical_alerts.escalation_reason is
  'Justificativa obrigatória do escalonamento — aparece para o médico no detalhe do alerta.';
comment on column public.clinical_alerts.escalation_unanswered_at is
  'Quando o fallback disparou por ninguém da equipe ter assumido o escalado. Evita notificar o Cirurgião Principal/Admin mais de uma vez.';

create index if not exists idx_alerts_escalated
  on public.clinical_alerts(escalated_at) where escalated_at is not null;

-- ----------------------------------------------------------------------------
-- 2) alert_escalate_to_red — a enfermagem entrega o caso ao médico.
-- ----------------------------------------------------------------------------
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

  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Só faz sentido escalar o que é da fila da enfermagem.
  if v_alert.status <> 'YELLOW' then
    raise exception 'Só alertas amarelos são escalados pela enfermagem. Vermelhos já são do médico da equipe.';
  end if;

  if v_alert.attendance_status in ('ATTENDED', 'IGNORED') or v_alert.attended = true then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  -- Idempotência: escalar duas vezes não gera segunda leva de notificações.
  if v_alert.escalated_at is not null then
    raise exception 'Este alerta já foi escalado para o médico.';
  end if;

  -- Quem já travou o alerta não pode ser atropelado por outro (mesma garantia
  -- do lock em 0044/0045); o Admin segue como exceção administrativa.
  if v_alert.in_analysis_by is not null
     and v_alert.in_analysis_by <> auth.uid()
     and not public.is_admin() then
    raise exception 'Este alerta está em análise por outro profissional.';
  end if;

  -- Sai da fila da enfermagem e volta para PENDING: agora é fila dos médicos.
  update public.clinical_alerts
     set escalated_at      = now(),
         escalated_by      = auth.uid(),
         escalation_reason = p_reason,
         attendance_status = 'PENDING',
         in_analysis_by    = null,
         in_analysis_at    = null,
         updated_at        = now()
   where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'ESCALATED', p_reason);

  perform public.audit_alert_action('ALERT_ESCALATED', v_alert.patient_id);

  -- Notifica os médicos da equipe pelo caminho já existente (0018).
  perform public.notify_team_of_alert(p_alert);
end;
$$;

comment on function public.alert_escalate_to_red(uuid, text) is
  'Escala um alerta AMARELO para o médico da equipe sem alterar clinical_alerts.status (a severidade clínica é imutável).';

grant execute on function public.alert_escalate_to_red(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Fallback: escalar para o vazio é o pior modo de falha.
--    Se ninguém da equipe assumir o alerta escalado dentro da janela, avisa o
--    Cirurgião Principal e os Admins. Marca `escalation_unanswered_at` para não
--    repetir o aviso.
-- ----------------------------------------------------------------------------
create or replace function public.notify_escalation_unanswered(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_alert      public.clinical_alerts;
  v_mode       boolean;
  v_recipients text[];
  v_env        text;
  v_msg        text := 'Atenção! Um caso escalado pela enfermagem segue sem atendimento. '
                    || 'Acesse o VitalSync para verificar os detalhes.';
  r            record;
  v_status     text;
  v_error      text;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return; end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  for r in
    select prof.id, prof.name, prof.whatsapp
    from (
      select t.main_surgeon_id as id
        from public.medical_teams t
       where t.id = v_alert.team_id and t.main_surgeon_id is not null
      union
      select p.id from public.profiles p where p.role::text = 'ADMIN'
    ) ids
    join public.profiles prof on prof.id = ids.id
    where prof.status = 'ACTIVE'
  loop
    -- Mesmo gate de homologação das demais notificações (0018).
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
end;
$$;

/**
 * Varredura dos escalados sem resposta. Roda no pg_cron; também pode ser
 * chamada manualmente pelo Admin.
 */
create or replace function public.check_unanswered_escalations()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_janela int := public.nursing_setting_num('escalationFallbackMinutes', 30)::int;
  v_count  int := 0;
  r        record;
begin
  for r in
    select a.id, a.patient_id, a.escalated_by
      from public.clinical_alerts a
     where a.escalated_at is not null
       and a.escalation_unanswered_at is null
       and a.attendance_status = 'PENDING'
       and a.attended = false
       and a.escalated_at < now() - make_interval(mins => v_janela)
  loop
    update public.clinical_alerts
       set escalation_unanswered_at = now(), updated_at = now()
     where id = r.id;

    insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
      values (r.patient_id, r.id, r.escalated_by, 'ESCALATION_UNANSWERED',
              'Nenhum médico da equipe assumiu o caso escalado em ' || v_janela
              || ' minutos. Cirurgião Principal e Administração foram avisados.');

    perform public.notify_escalation_unanswered(r.id);
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'ESCALATION_UNANSWERED',
            v_count || ' escalonamento(s) sem resposta encaminhado(s) ao Cirurgião Principal/Admin');
  end if;

  return v_count;
end;
$$;

revoke execute on function public.check_unanswered_escalations() from public;
grant  execute on function public.check_unanswered_escalations() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Agendamento a cada 5 minutos (idempotente, padrão 0038/0061).
--    O envio real das linhas PENDING continua sendo da Edge Function
--    send-whatsapp-alert, acionada pelo mesmo caminho já existente.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'check-unanswered-escalations';
    perform cron.schedule(
      'check-unanswered-escalations',
      '*/5 * * * *',
      $sql$select public.check_unanswered_escalations();$sql$
    );
  else
    raise warning 'pg_cron indisponível — o fallback de escalonamento NÃO rodará automaticamente.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- escalonamento preserva a severidade (cenário 7 do PR):
--   select public.alert_escalate_to_red('<alerta amarelo>', 'Paciente relatou piora da dor.');
--   select status, escalated_at, escalated_by, escalation_reason, attendance_status
--     from public.clinical_alerts where id = '<alerta amarelo>';
--   --> status CONTINUA 'YELLOW'; escalated_at preenchido; attendance_status 'PENDING'.
--
--   -- idempotência: a segunda chamada deve falhar com "já foi escalado".
--   -- vermelho não pode ser escalado: deve falhar com a mensagem de amarelos.
--
--   -- fallback (cenário 8):
--   update public.clinical_alerts set escalated_at = now() - interval '40 minutes' where id = '<alerta>';
--   select public.check_unanswered_escalations();   -- 1
--   select recipient_name, status from public.notification_logs where alert_id = '<alerta>';
-- ----------------------------------------------------------------------------
