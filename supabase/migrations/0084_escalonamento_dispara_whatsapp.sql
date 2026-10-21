-- ============================================================================
-- Migration: 0084_escalonamento_dispara_whatsapp
--
-- PROBLEMA 1 — a notificação de escalonamento NUNCA era enviada.
--
-- A 0034 ligou o envio do WhatsApp por um trigger `after INSERT on
-- clinical_alerts`. Isso cobre o alerta que NASCE, e só ele. Escalonamento é
-- UPDATE: `alert_escalate_to_red` (0077) grava `escalated_at` e chama
-- `notify_team_of_alert`, que cria `notification_logs` novos em PENDING — e
-- nada mais acontece. Os mesmos caminhos ficavam mudos:
--   • escalada pela enfermagem        (alert_escalate_to_red, 0077)
--   • auto-escalonamento de 8h        (reoffer_expired_alerts, 0068)
--   • escalado sem resposta           (notify_escalation_unanswered, 0064)
--   • reenvio manual do Admin         (alert_resend_notification, 0008)
-- Em todos, o log nascia PENDING e permanecia PENDING para sempre. Ninguém era
-- avisado e o painel acumulava "pendentes" que não eram falha de entrega.
--
-- CORREÇÃO: o disparo deixa de depender de trigger de INSERT e passa a ficar
-- ONDE os logs são criados. `dispatch_whatsapp_alert(uuid)` é o novo ponto
-- único; `notify_team_of_alert` e `notify_escalation_unanswered` a chamam no
-- fim, e só quando criaram ao menos um log PENDING (em homologação, com tudo
-- SKIPPED_TEST_MODE, não há o que enviar). O trigger de INSERT é REMOVIDO para
-- não disparar duas vezes pelo mesmo alerta: toda criação de alerta passa por
-- notify_team_of_alert (0008/0021/0047/0051/0053/0062/0067/0074/0082).
--
-- Ordem dentro da transação: a chamada fica depois dos INSERTs dos logs, e o
-- pg_net só executa o POST após o COMMIT (ele enfileira em
-- net.http_request_queue). A Edge Function, portanto, lê os logs já gravados —
-- é a mesma garantia em que a 0034 se apoiava, agora com a ordem correta
-- também dentro da função.
--
-- PROBLEMA 2 — a mensagem do escalonamento era a mesma do alerta novo.
--
-- `template_name` já existia em notification_logs desde a 0018, mas era sempre
-- 'alerta_clinico_vitalsync' e a Edge Function nem o lia (usava um nome fixo
-- de env). Agora o log de um alerta ESCALADO (ou de um escalado sem resposta)
-- grava 'alerta_escalonado_vitalsync', e a função envia o template que o log
-- pede. Enquanto esse template não estiver aprovado na Meta, a Edge Function
-- cai automaticamente no template padrão e registra o fallback no log — por
-- isso esta migration pode subir ANTES da aprovação, sem nada ficar pendente.
--
-- Texto do template a cadastrar: docs/CONFIG_WHATSAPP_CLOUD_API.md.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) dispatch_whatsapp_alert — POST para a Edge Function send-whatsapp-alert.
--
--    Mesmo corpo que o trigger da 0034 usava (Vault + pg_net), agora como
--    função chamável por qualquer caminho que crie logs PENDING. Falta de
--    segredo não derruba a transação do alerta: avisa e segue.
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_whatsapp_alert(p_alert uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'send-whatsapp-alert não disparado: configure os secrets project_url/service_role_key no Vault.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-whatsapp-alert',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('record', jsonb_build_object('id', p_alert))
  );
end;
$$;

comment on function public.dispatch_whatsapp_alert(uuid) is
  'Pede à Edge Function send-whatsapp-alert que entregue os notification_logs PENDING do alerta. Ponto ÚNICO de disparo (0084) — substitui o trigger de INSERT da 0034, que não cobria escalonamento nem reenvio.';

revoke execute on function public.dispatch_whatsapp_alert(uuid) from public, anon;

-- ----------------------------------------------------------------------------
-- 2) Remove o disparo por trigger de INSERT (agora redundante e duplicador).
-- ----------------------------------------------------------------------------
drop trigger if exists trg_alert_dispatch_whatsapp on public.clinical_alerts;
drop function if exists public.trg_dispatch_whatsapp_alert();

-- ----------------------------------------------------------------------------
-- 3) notify_team_of_alert — base VIVA (0077), com três mudanças cirúrgicas:
--      a) template_name por tipo de evento (escalado x alerta novo);
--      b) contagem de logs PENDING criados;
--      c) disparo do envio no fim, só se houver PENDING.
--    Todo o resto (roteamento amarelo/vermelho, fallback sem enfermeiro,
--    auditoria de "sem destinatário", gate de homologação) é cópia literal.
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
  v_efetiva text;
  v_targets uuid[];
  v_rota_enfermagem boolean := false;
  v_template text;
  v_pendentes int := 0;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return; end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env := case when v_mode then 'homologation' else 'production' end;

  -- NOVO (0084): caso escalado tem mensagem própria. O template é apenas o
  -- NOME — o texto aprovado vive na Meta, e a Edge Function cai no padrão se
  -- este ainda não existir lá.
  v_template := case
                  when v_alert.escalated_at is not null then 'alerta_escalonado_vitalsync'
                  else 'alerta_clinico_vitalsync'
                end;

  -- Severidade EFETIVA: escalado conta como vermelho ainda que `status` siga
  -- 'YELLOW' (a severidade clínica é imutável — ver cabeçalho e 0064).
  v_efetiva := case
                 when v_alert.status::text = 'RED' or v_alert.escalated_at is not null then 'RED'
                 else v_alert.status::text
               end;

  if v_efetiva = 'YELLOW' then
    select coalesce(array_agg(distinct t.n), '{}')
      into v_targets
      from public.alert_nurse_recipients(v_alert.team_id, v_alert.patient_id) as t(n);

    if coalesce(array_length(v_targets, 1), 0) > 0 then
      v_rota_enfermagem := true;
    else
      -- FALLBACK: sem enfermeiro, o amarelo vai para os médicos da equipe.
      select coalesce(array_agg(distinct t.d), '{}')
        into v_targets
        from public.alert_doctor_recipients(v_alert.team_id) as t(d);

      insert into public.audit_logs (actor_name, actor_role, action, entity)
      values ('Sistema', 'SYSTEM', 'YELLOW_NO_NURSE_FALLBACK',
              'Alerta amarelo ' || p_alert || ' sem enfermeiro na equipe nem no pool do hospital: '
              || 'roteado para ' || coalesce(array_length(v_targets, 1), 0) || ' médico(s) da equipe.');
    end if;
  else
    select coalesce(array_agg(distinct t.d), '{}')
      into v_targets
      from public.alert_doctor_recipients(v_alert.team_id) as t(d);
  end if;

  -- Nenhum destinatário é um MODO DE FALHA, não um caso normal: fica auditado.
  if coalesce(array_length(v_targets, 1), 0) = 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'ALERT_NO_RECIPIENT',
            'Alerta ' || p_alert || ' (severidade efetiva ' || v_efetiva
            || ') não tem nenhum destinatário ativo na equipe ' || coalesce(v_alert.team_id::text, '—') || '.');
    return;
  end if;

  for r in
    select prof.id, prof.name, prof.whatsapp
      from public.profiles prof
     where prof.id = any(v_targets)
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
      v_pendentes := v_pendentes + 1;
    end if;

    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at,
       recipient_is_nurse)
    values
      (v_alert.patient_id, p_alert, r.id, r.name, r.whatsapp,
       'whatsapp', v_status, v_msg, v_template, v_env,
       coalesce(v_alert.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end,
       v_rota_enfermagem);
  end loop;

  -- NOVO (0084): pede a entrega. Sem PENDING não há o que enviar.
  if v_pendentes > 0 then
    perform public.dispatch_whatsapp_alert(p_alert);
  end if;
end; $$;

comment on function public.notify_team_of_alert(uuid) is
  'Notifica a equipe conforme a severidade EFETIVA do alerta: AMARELO → enfermagem (equipe ∪ pool); VERMELHO ou escalado → médicos da equipe. Sem enfermeiro, cai para os médicos e audita YELLOW_NO_NURSE_FALLBACK. Grava o template do evento e dispara a entrega (0084).';

revoke execute on function public.notify_team_of_alert(uuid) from public, anon;
grant  execute on function public.notify_team_of_alert(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) notify_escalation_unanswered — base VIVA (0064). Mesmas três mudanças;
--    aqui o template é sempre o de escalonamento (o aviso só existe para caso
--    escalado). Resto é cópia literal.
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
  v_pendentes  int := 0;
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
      v_pendentes := v_pendentes + 1;
    end if;

    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at)
    values
      (v_alert.patient_id, p_alert, r.id, r.name, r.whatsapp,
       'whatsapp', v_status, v_msg, 'alerta_escalonado_vitalsync', v_env,
       coalesce(v_alert.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end);
  end loop;

  if v_pendentes > 0 then
    perform public.dispatch_whatsapp_alert(p_alert);
  end if;
end;
$$;

comment on function public.notify_escalation_unanswered(uuid) is
  'Avisa Cirurgião Principal e Admins de caso escalado sem atendimento na janela (0064). Usa o template de escalonamento e dispara a entrega (0084).';

-- ----------------------------------------------------------------------------
-- 5) Logs de escalonamento que ficaram presos em PENDING antes desta migration.
--
--    NÃO são reenviados aqui: a Edge Function os pegará no próximo disparo do
--    mesmo alerta, e disparar em massa agora poderia mandar dezenas de
--    mensagens de casos antigos de uma vez. O bloco apenas AUDITA o que ficou
--    para trás, para a decisão ser humana e informada.
-- ----------------------------------------------------------------------------
do $$
declare v_presos int;
begin
  select count(*) into v_presos
    from public.notification_logs l
    join public.clinical_alerts a on a.id = l.alert_id
   where l.status = 'PENDING'
     and a.escalated_at is not null;

  if v_presos > 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'ESCALATION_NOTIFICATION_BACKLOG',
            v_presos || ' notificação(ões) de alerta escalado estavam em PENDING sem disparo (corrigido na 0084). '
            || 'Reenvio, se desejado, pelo botão Reenviar do alerta.');
    raise notice '0084: % notificação(ões) de escalonamento presas em PENDING — ver audit_logs.', v_presos;
  end if;
end;
$$;

-- ============================================================================
-- VERIFICAÇÃO (rode após o db push)
--
--   -- (a) o trigger antigo saiu e a função nova existe:
--   select tgname from pg_trigger where tgname = 'trg_alert_dispatch_whatsapp';   --> 0 linhas
--   select proname from pg_proc where proname = 'dispatch_whatsapp_alert';        --> 1 linha
--
--   -- (b) um alerta novo continua enviando (fluxo normal, sem regressão):
--   --     registre uma medição alterada e confira:
--   select status, template_name, sent_at from public.notification_logs
--    where alert_id = '<alerta recém-criado>';
--   --> SENT (ou 'logged' sem credencial), template alerta_clinico_vitalsync.
--
--   -- (c) escalonamento agora sai de PENDING (o que esta migration conserta):
--   --     select public.alert_escalate_to_red('<alerta amarelo>', 'teste');
--   select status, template_name, error_message from public.notification_logs
--    where alert_id = '<alerta escalado>' order by created_at desc;
--   --> template alerta_escalonado_vitalsync e status SENT. Antes da aprovação
--       do template na Meta: SENT com error_message citando o fallback.
--
--   -- (d) backlog registrado:
--   select entity from public.audit_logs
--    where action = 'ESCALATION_NOTIFICATION_BACKLOG' order by created_at desc limit 1;
-- ============================================================================
