-- ============================================================================
-- Migration: 0077_roteamento_amarelo_enfermagem
--
-- O AMARELO PASSA A SER UM EVENTO DA ENFERMAGEM; O VERMELHO, DOS MÉDICOS.
--
-- Até aqui `notify_team_of_alert` (viva na 0018) notificava, para QUALQUER
-- severidade, o mesmo conjunto: `main_surgeon_id` + TODOS os `team_members`
-- ativos. Agora o destinatário depende da severidade.
--
-- ─── SEVERIDADE EFETIVA (o conceito que faz isto funcionar) ─────────────────
-- `clinical_alerts.status` NUNCA é sobrescrito por decisão humana — é a
-- severidade que `eval_clinical_status` calculou e alimenta as métricas do
-- estudo (0055). Escalar grava numa camada separada (`escalated_at`, 0064).
-- Logo, um alerta escalado continua com `status = 'YELLOW'`.
--
-- Se o roteamento olhasse só `status`, o escalonamento notificaria a
-- ENFERMAGEM de novo — o oposto do objetivo. Por isso o roteamento usa a
-- severidade EFETIVA:
--
--     efetiva = RED   quando  status = 'RED'  OU  escalated_at is not null
--     efetiva = YELLOW  caso contrário
--
-- Isso cobre de graça os três caminhos que já chamam esta função:
--   • criação do alerta (staff_insert_vital_record / submit_vital_record)
--         → escalated_at null → amarelo vai para a enfermagem;
--   • `alert_escalate_to_red` (0064) → escalated_at preenchido → vai p/ médicos;
--   • auto-escalonamento de 8h (`nurse_queue_sweep`, 0068) → idem, e continua
--     funcionando sem depender de pool nenhum (rede de segurança preservada).
--
-- ─── ESCOPO DA ENFERMAGEM: EQUIPE **OU** POOL (aditivo) ─────────────────────
-- Decisão explícita do usuário. O amarelo vai para os enfermeiros ATIVOS
-- vinculados à EQUIPE do paciente (`team_members.role_in_team =
-- 'NURSING_PROFESSIONAL'`, liberado na 0076) UNIÃO os enfermeiros do POOL que
-- cobre o hospital do paciente (`nurse_pool_*`, 0065). Nenhuma via é removida:
-- o pool é o desenho vivo de `docs/FLUXO_ENFERMAGEM.md` (que substituiu a
-- premissa de escopo por equipe da 0054) e a via de equipe é o que o piloto
-- usa (`_scripts/func2_enfermeiro_piloto_por_equipe.sql`). Segue a regra do
-- repo: estender com `or`, nunca reescrever removendo condições.
--
-- ─── FALLBACK: UM AMARELO NUNCA FICA ÓRFÃO ──────────────────────────────────
-- Escolha registrada: se a equipe do paciente não tiver enfermeiro ativo E o
-- pool não cobrir o hospital dele, o amarelo é roteado para os MÉDICOS da
-- equipe (comportamento anterior à esta migration) e o desvio é gravado em
-- `audit_logs` com a ação `YELLOW_NO_NURSE_FALLBACK`. Preferido ao "esperar o
-- auto-escalonamento de 8h" porque 8h de silêncio em cima de um paciente
-- pós-operatório é tempo demais; o auto-escalonamento continua existindo como
-- segunda rede, não como primeira. Se nem médicos houver, grava
-- `ALERT_NO_RECIPIENT` — visível, nunca silencioso.
--
-- ─── QUEM ESCALA ────────────────────────────────────────────────────────────
-- `alert_escalate_to_red` passa a exigir `is_nurse()`. Antes, qualquer membro
-- da equipe (ou Admin) escalava. MUDANÇA DE COMPORTAMENTO DELIBERADA: o
-- Admin perde o escalonamento manual, porque escalar é juízo clínico, não ato
-- administrativo. As redes automáticas (8h) não passam por esta RPC e seguem
-- intactas.
--
-- ASSINATURAS INALTERADAS em ambas as funções → `create or replace` (o
-- DROP+recreate do repo é para mudança de assinatura). Grants reafirmados.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0076.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Marcador de rota no log — torna o critério de aceite verificável.
--    Espelha `missed_measurement_logs.recipient_is_nurse` (0060).
-- ----------------------------------------------------------------------------
alter table public.notification_logs
  add column if not exists recipient_is_nurse boolean not null default false;

comment on column public.notification_logs.recipient_is_nurse is
  'true quando a linha foi gerada pela rota AMARELA (destinatário é enfermagem). false = rota vermelha (médicos) ou fallback por ausência de enfermeiro.';

-- ----------------------------------------------------------------------------
-- 2) Destinatários da rota AMARELA: enfermeiros da equipe UNIÃO enfermeiros do
--    pool que cobre o hospital do paciente. Conta ativa é exigida nos dois
--    ramos; `is_nurse()` garante que o papel em `profiles` é o de enfermagem
--    (um vínculo velho com papel trocado não vaza para cá).
-- ----------------------------------------------------------------------------
create or replace function public.alert_nurse_recipients(p_team uuid, p_patient uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id from public.team_active_nurses(p_team) as t(id)
  union
  select m.profile_id
    from public.nurse_pool_members m
    join public.nurse_pools pool         on pool.id = m.pool_id and pool.is_active
    join public.nurse_pool_hospitals nph on nph.pool_id = pool.id
    join public.patients pat             on pat.id = p_patient
    join public.profiles prof            on prof.id = m.profile_id
   where m.is_active
     and pat.hospital_id is not null
     and nph.hospital_id = pat.hospital_id
     and prof.status = 'ACTIVE'
     and public.is_nurse(m.profile_id);
$$;

comment on function public.alert_nurse_recipients(uuid, uuid) is
  'Enfermeiros que devem receber o alerta AMARELO: vínculo de equipe (0076) OU pool do hospital (0065). Aditivo — nenhuma das duas vias substitui a outra.';

revoke execute on function public.alert_nurse_recipients(uuid, uuid) from public, anon;
grant  execute on function public.alert_nurse_recipients(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Destinatários da rota VERMELHA: exatamente o conjunto de hoje (0018),
--    MENOS a enfermagem. Antes da 0076 o enfermeiro do piloto estava gravado
--    como 'ASSOCIATED_DOCTOR' e entrava aqui; com o papel correto ele sai — é
--    o requisito 6 ("dispara para os MÉDICOS da equipe").
-- ----------------------------------------------------------------------------
create or replace function public.alert_doctor_recipients(p_team uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select ids.id
    from (
      select t.main_surgeon_id as id
        from public.medical_teams t
       where t.id = p_team and t.main_surgeon_id is not null
      union
      select m.doctor_id as id
        from public.team_members m
       where m.team_id = p_team
         and m.status = 'ACTIVE'
         and m.role_in_team::text <> 'NURSING_PROFESSIONAL'
    ) ids
    join public.profiles prof on prof.id = ids.id
   where prof.status = 'ACTIVE';
$$;

comment on function public.alert_doctor_recipients(uuid) is
  'Médicos da equipe (cirurgião responsável + membros ativos que não são enfermagem). Conjunto histórico da 0018 menos a enfermagem.';

revoke execute on function public.alert_doctor_recipients(uuid) from public, anon;
grant  execute on function public.alert_doctor_recipients(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) notify_team_of_alert — base 0018 + roteamento por severidade efetiva.
--    O GATE DE HOMOLOGAÇÃO, a mensagem, o template e o formato das linhas de
--    `notification_logs` são IDÊNTICOS aos de hoje. Só o conjunto de
--    destinatários mudou.
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
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return; end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env := case when v_mode then 'homologation' else 'production' end;

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
    end if;

    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at,
       recipient_is_nurse)
    values
      (v_alert.patient_id, p_alert, r.id, r.name, r.whatsapp,
       'whatsapp', v_status, v_msg, 'alerta_clinico_vitalsync', v_env,
       coalesce(v_alert.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end,
       v_rota_enfermagem);
  end loop;
end; $$;

comment on function public.notify_team_of_alert(uuid) is
  'Notifica a equipe conforme a severidade EFETIVA do alerta: AMARELO → enfermagem (equipe ∪ pool); VERMELHO ou escalado → médicos da equipe. Sem enfermeiro, cai para os médicos e audita YELLOW_NO_NURSE_FALLBACK.';

revoke execute on function public.notify_team_of_alert(uuid) from public, anon;
grant  execute on function public.notify_team_of_alert(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) alert_escalate_to_red — base 0064 + escalonamento é ato da ENFERMAGEM.
--    Corpo idêntico ao da 0064, exceto o bloco de permissão. A ordem dos
--    guards é preservada para que o gerente continue recebendo
--    MANAGER_READ_ONLY (código que o front já trata).
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

  -- REQUISITO: só a enfermagem escala. Médico não escala amarelo (nem o vê
  -- como pendência); Admin também não — escalar é juízo clínico. O
  -- auto-escalonamento de 8h (0068) NÃO passa por aqui e segue intacto.
  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o profissional de enfermagem escala um caso para o médico.';
  end if;

  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Só faz sentido escalar o que é da fila da enfermagem.
  if v_alert.status <> 'YELLOW' then
    raise exception 'Só alertas amarelos são escalados pela enfermagem. Vermelhos já são do médico da equipe.';
  end if;

  if v_alert.attendance_status in ('ATTENDED', 'IGNORED') or v_alert.attended = true then
    raise exception 'Este alerta já foi finalizado.';
  end if;

  -- Idempotência: o `for update` acima serializa dois enfermeiros simultâneos;
  -- o segundo encontra `escalated_at` preenchido e para aqui, ANTES do
  -- `notify_team_of_alert`. Uma única leva de notificação vermelha, sempre.
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

  -- Caminho vermelho já existente. Como `escalated_at` acabou de ser gravado, a
  -- severidade EFETIVA lida lá dentro é RED → vai para os médicos da equipe.
  perform public.notify_team_of_alert(p_alert);
end;
$$;

comment on function public.alert_escalate_to_red(uuid, text) is
  'A ENFERMAGEM escala um alerta AMARELO para o médico da equipe. Não altera clinical_alerts.status (a severidade clínica é imutável) — grava escalated_at/by/reason e dispara a rota vermelha.';

revoke execute on function public.alert_escalate_to_red(uuid, text) from public, anon;
grant  execute on function public.alert_escalate_to_red(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar — sempre pelo caminho REAL, nunca por INSERT
-- cru em clinical_alerts, que não dispara notify_team_of_alert):
--
--   -- 2. amarelo só para a enfermagem (ex.: 37,8 °C via staff_insert_vital_record):
--   select recipient_name, recipient_is_nurse, status
--     from public.notification_logs where alert_id = '<alerta amarelo>';
--   --> só enfermeiros, recipient_is_nurse = true, nenhum médico.
--
--   -- 4. escalada leva aos médicos, sem mexer na severidade:
--   select public.alert_escalate_to_red('<alerta amarelo>', 'Paciente relatou piora da dor.');
--   select status, escalated_at, escalated_by from public.clinical_alerts where id = '<alerta>';
--   --> status CONTINUA 'YELLOW'; escalated_at/by preenchidos.
--   select recipient_name, recipient_is_nurse from public.notification_logs
--    where alert_id = '<alerta>' order by created_at desc;
--   --> nova leva com recipient_is_nurse = false (médicos).
--
--   -- 5/6. autorização e idempotência:
--   -- como médico: alert_escalate_to_red → 'Apenas o profissional de enfermagem...'
--   -- segunda chamada do enfermeiro → 'já foi escalado', sem nova leva de logs.
--
--   -- 7. fallback (equipe sem enfermeiro e pool sem o hospital):
--   select action, entity from public.audit_logs
--    where action in ('YELLOW_NO_NURSE_FALLBACK', 'ALERT_NO_RECIPIENT')
--    order by created_at desc limit 5;
-- ----------------------------------------------------------------------------
