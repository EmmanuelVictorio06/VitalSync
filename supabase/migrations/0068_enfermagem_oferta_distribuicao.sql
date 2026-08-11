-- ============================================================================
-- Migration: 0068_enfermagem_oferta_distribuicao  (Triagem de Enfermagem — Fase 2)
--
-- Distribuição dos alertas AMARELOS por OFERTA, atrás de feature flag
-- (`app_settings.nursing.autoRouting`, default FALSE — a primeira coorte roda
-- em modo manual, com a fila aberta).
--
-- ATRIBUIÇÃO POR OFERTA, NÃO POR EXCLUSIVIDADE. O alerta é oferecido a um
-- enfermeiro (dono preferencial, com contagem regressiva) mas PERMANECE
-- VISÍVEL para todo o pool de plantão, marcado "aguardando Fulano — 4 min".
-- Vencida a janela sem aceite, cai para a fila aberta. Direcionamento sem
-- perder a redundância do broadcast: um alerta nunca fica preso e invisível.
-- É por isso que a visibilidade continua governada pela RLS da 0066 (todo o
-- pool lê) e a atribuição é só uma PREFERÊNCIA gravada em `assigned_nurse_id`
-- (colunas criadas na 0065).
--
-- REDE DE SEGURANÇA (o risco aqui não é o vermelho — é o amarelo fechado como
-- "tudo bem" que não era):
--   • SLA de fila: amarelo esperando além de `slaYellowMinutes` COM alguém de
--     plantão é marcado como atrasado (o relógio só corre em horário coberto).
--   • SLA máximo: amarelo além de `slaMaxHours` de tempo CORRIDO escala
--     automaticamente para o médico. Nenhum amarelo morre em silêncio.
--   • Amostragem de revisão: uma fração dos amarelos finalizados fica marcada
--     para conferência de um médico revisor.
--
-- MUDANÇA DE SCHEMA: `attendance_confirmations.attended_by` passa a aceitar
-- NULL. Eventos gerados pelo SISTEMA (escalonamento automático por tempo,
-- expiração de oferta sem dono) não têm autor humano, e inventar um autor
-- (ex.: o cirurgião da equipe) falsificaria a trilha de auditoria.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0067.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Eventos de sistema na timeline (sem autor humano).
-- ----------------------------------------------------------------------------
alter table public.attendance_confirmations alter column attended_by drop not null;

comment on column public.attendance_confirmations.attended_by is
  'Autor do evento. NULL = evento gerado pelo sistema (expiração de oferta, escalonamento automático por tempo).';

-- ----------------------------------------------------------------------------
-- 2) Marcadores de fila / SLA / revisão em clinical_alerts.
-- ----------------------------------------------------------------------------
alter table public.clinical_alerts
  add column if not exists sla_breached_at   timestamptz,
  add column if not exists auto_escalated    boolean not null default false,
  add column if not exists review_pending    boolean not null default false;

comment on column public.clinical_alerts.sla_breached_at is
  'Quando o amarelo passou de slaYellowMinutes em fila COM plantão aberto. Fora de plantão o relógio fica parado (§4.5).';
comment on column public.clinical_alerts.auto_escalated is
  'true quando o escalonamento partiu do SLA máximo, não de um julgamento humano.';
comment on column public.clinical_alerts.review_pending is
  'Amarelo finalizado sorteado para revisão médica por amostragem (rede contra falso-negativo).';

create index if not exists idx_alerts_fila_amarela
  on public.clinical_alerts(status, attendance_status)
  where attendance_status = 'PENDING' and escalated_at is null;

create index if not exists idx_alerts_review_pending
  on public.clinical_alerts(review_pending) where review_pending;

-- ----------------------------------------------------------------------------
-- 3) offer_yellow_alert — escolhe o enfermeiro LIVRE mais ocioso do pool que
--    cobre o hospital do paciente. Empate → quem recebeu oferta há mais tempo
--    (round-robin justo; quem nunca recebeu vem primeiro).
--
--    Se NÃO houver ninguém livre, deixa `assigned_nurse_id = null` de
--    propósito: o alerta NÃO some, vai para a fila aberta com o relógio de SLA
--    correndo. Retorna o enfermeiro escolhido (ou null).
-- ----------------------------------------------------------------------------
create or replace function public.offer_yellow_alert(p_alert uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_alert   public.clinical_alerts;
  v_hosp    uuid;
  v_nurse   uuid;
  v_janela  int := public.nursing_setting_num('offerWindowMinutes', 5)::int;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then return null; end if;

  -- Só amarelo, pendente, ainda sem dono e não escalado.
  if v_alert.status <> 'YELLOW'
     or v_alert.attendance_status <> 'PENDING'
     or v_alert.assigned_nurse_id is not null
     or v_alert.escalated_at is not null
     or v_alert.attended = true then
    return null;
  end if;

  select hospital_id into v_hosp from public.patients where id = v_alert.patient_id;
  if v_hosp is null then return null; end if;   -- fail-closed (ver is_nurse_for_patient)

  select cand.profile_id into v_nurse
    from (
      select m.profile_id,
             public.nurse_active_load(m.profile_id) as carga,
             (select max(a2.assigned_at) from public.clinical_alerts a2
               where a2.assigned_nurse_id = m.profile_id) as ultima_oferta
        from public.nurse_pool_members m
        join public.nurse_pools pool         on pool.id = m.pool_id and pool.is_active
        join public.nurse_pool_hospitals nph on nph.pool_id = pool.id and nph.hospital_id = v_hosp
       where m.is_active
         and public.nurse_is_free(m.profile_id)
    ) cand
   order by cand.carga asc, cand.ultima_oferta asc nulls first
   limit 1;

  if v_nurse is null then
    return null;   -- ninguém livre: fila aberta, visível a todo o pool
  end if;

  -- Atribuição atômica: só grava se ninguém foi atribuído nesse meio-tempo.
  update public.clinical_alerts
     set assigned_nurse_id = v_nurse,
         assigned_at       = now(),
         offer_expires_at  = now() + make_interval(mins => v_janela),
         updated_at        = now()
   where id = p_alert and assigned_nurse_id is null;

  if not found then return null; end if;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, v_nurse, 'OFFERED',
            'Alerta oferecido; janela de ' || v_janela || ' minutos para assumir.');

  return v_nurse;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Ações do enfermeiro sobre a oferta / fila aberta.
-- ----------------------------------------------------------------------------

/**
 * Assume o alerta (da oferta ou da fila aberta) e já o coloca em análise.
 * O claim atômico do lock (0044, preservado na 0067) é quem decide a corrida
 * entre dois enfermeiros — cenário 5 do PR.
 */
create or replace function public.nurse_claim_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o Profissional de Enfermagem assume alertas da fila de triagem.';
  end if;

  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not public.can_act_on_alert(v_alert.team_id, v_alert.patient_id) then
    raise exception 'Sem permissão para este alerta.';
  end if;

  -- Oferta ainda válida de OUTRO enfermeiro: respeite a janela dele.
  if v_alert.assigned_nurse_id is not null
     and v_alert.assigned_nurse_id <> auth.uid()
     and v_alert.offer_expires_at is not null
     and v_alert.offer_expires_at > now() then
    raise exception 'Este alerta está oferecido a outro profissional até o fim da janela. Assim que expirar, ele volta para a fila aberta.';
  end if;

  update public.clinical_alerts
     set assigned_nurse_id = auth.uid(),
         assigned_at       = coalesce(assigned_at, now()),
         offer_expires_at  = null,
         updated_at        = now()
   where id = p_alert;

  -- Coloca em análise pelo caminho oficial (claim atômico + timeline + auditoria).
  perform public.alert_set_in_analysis(p_alert);
end;
$$;

/** Devolve o alerta à fila aberta (recusa explícita). */
create or replace function public.nurse_decline_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  select * into v_alert from public.clinical_alerts where id = p_alert for update;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if v_alert.assigned_nurse_id <> auth.uid() and not public.is_admin() then
    raise exception 'Este alerta não está atribuído a você.';
  end if;

  update public.clinical_alerts
     set assigned_nurse_id = null,
         offer_expires_at  = null,
         updated_at        = now()
   where id = p_alert;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'DECLINED', 'Devolvido à fila aberta.');

  -- Tenta reencaminhar imediatamente (se a distribuição automática estiver ligada).
  if public.nursing_setting_bool('autoRouting', false) then
    perform public.offer_yellow_alert(p_alert);
  end if;
end;
$$;

grant execute on function public.offer_yellow_alert(uuid)  to authenticated;
grant execute on function public.nurse_claim_alert(uuid)   to authenticated;
grant execute on function public.nurse_decline_alert(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) reoffer_expired_alerts — o motor da fila. Roda a cada 2 min e faz três
--    coisas, nesta ordem: expirar ofertas, marcar atraso de SLA e escalar
--    automaticamente o que passou do SLA máximo.
-- ----------------------------------------------------------------------------
create or replace function public.reoffer_expired_alerts()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_auto     boolean := public.nursing_setting_bool('autoRouting', false);
  v_sla_min  int := public.nursing_setting_num('slaYellowMinutes', 60)::int;
  v_sla_max  int := public.nursing_setting_num('slaMaxHours', 8)::int;
  v_count    int := 0;
  r          record;
begin
  ------------------------------------------------------------------ (a) ofertas vencidas
  for r in
    select a.id, a.patient_id, a.assigned_nurse_id
      from public.clinical_alerts a
     where a.assigned_nurse_id is not null
       and a.offer_expires_at is not null
       and a.offer_expires_at < now()
       and a.in_analysis_by is null           -- ninguém começou a atender
       and a.attendance_status = 'PENDING'
       and a.attended = false
       and a.escalated_at is null
  loop
    update public.clinical_alerts
       set assigned_nurse_id = null, offer_expires_at = null, updated_at = now()
     where id = r.id;

    insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
      values (r.patient_id, r.id, r.assigned_nurse_id, 'OFFER_EXPIRED',
              'Oferta expirada sem aceite; alerta devolvido à fila aberta.');

    if v_auto then perform public.offer_yellow_alert(r.id); end if;
    v_count := v_count + 1;
  end loop;

  ------------------------------------------------------------------ (b) fila aberta → oferta
  if v_auto then
    for r in
      select a.id from public.clinical_alerts a
       where a.status = 'YELLOW'
         and a.attendance_status = 'PENDING'
         and a.assigned_nurse_id is null
         and a.escalated_at is null
         and a.attended = false
       order by a.created_at asc
    loop
      perform public.offer_yellow_alert(r.id);
    end loop;
  end if;

  ------------------------------------------------------------------ (c) SLA de fila
  -- O relógio só corre em horário COBERTO: sem ninguém de plantão no pool que
  -- cobre o hospital, o amarelo espera sem ser marcado como atrasado (§4.5).
  update public.clinical_alerts a
     set sla_breached_at = now(), updated_at = now()
   where a.status = 'YELLOW'
     and a.attendance_status = 'PENDING'
     and a.escalated_at is null
     and a.attended = false
     and a.sla_breached_at is null
     and a.created_at < now() - make_interval(mins => v_sla_min)
     and exists (
       select 1
         from public.patients pat
         join public.nurse_pool_hospitals nph on nph.hospital_id = pat.hospital_id
         join public.nurse_pools pool         on pool.id = nph.pool_id and pool.is_active
         join public.nurse_pool_members m     on m.pool_id = pool.id and m.is_active
        where pat.id = a.patient_id
          and public.is_nurse_on_duty(m.profile_id)
     );

  ------------------------------------------------------------------ (d) SLA máximo → escala sozinho
  -- Tempo CORRIDO (inclusive madrugada): nenhum amarelo pode morrer em silêncio.
  for r in
    select a.id, a.patient_id
      from public.clinical_alerts a
     where a.status = 'YELLOW'
       and a.attendance_status in ('PENDING', 'IN_ANALYSIS')
       and a.escalated_at is null
       and a.attended = false
       and a.created_at < now() - make_interval(hours => v_sla_max)
  loop
    update public.clinical_alerts
       set escalated_at      = now(),
           escalated_by      = null,          -- decisão do sistema, não de uma pessoa
           escalation_reason = 'Escalonamento automático por tempo: amarelo sem atendimento além do limite de ' || v_sla_max || 'h.',
           auto_escalated    = true,
           attendance_status = 'PENDING',
           assigned_nurse_id = null,
           offer_expires_at  = null,
           in_analysis_by    = null,
           in_analysis_at    = null,
           updated_at        = now()
     where id = r.id;

    insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
      values (r.patient_id, r.id, null, 'ESCALATED',
              'Escalonamento automático por tempo (mais de ' || v_sla_max || 'h sem atendimento).');

    perform public.notify_team_of_alert(r.id);
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'NURSE_QUEUE_SWEEP',
            v_count || ' alerta(s) reencaminhado(s)/escalado(s) pela varredura da fila de enfermagem');
  end if;

  return v_count;
end;
$$;

revoke execute on function public.reoffer_expired_alerts() from public;
grant  execute on function public.reoffer_expired_alerts() to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Oferta imediata ao criar um amarelo (latência ~0 em vez de até 2 min).
--    Trigger AFTER INSERT, guardado pela feature flag. Nunca deixa o INSERT do
--    alerta falhar por causa da distribuição.
-- ----------------------------------------------------------------------------
create or replace function public.trg_offer_new_yellow_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'YELLOW' and public.nursing_setting_bool('autoRouting', false) then
    begin
      perform public.offer_yellow_alert(new.id);
    exception when others then
      raise warning 'Falha ao ofertar o alerta % à enfermagem: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_alert_offer_nursing on public.clinical_alerts;
create trigger trg_alert_offer_nursing
  after insert on public.clinical_alerts
  for each row execute function public.trg_offer_new_yellow_alert();

-- ----------------------------------------------------------------------------
-- 7) Amostragem de revisão: sorteia amarelos finalizados para conferência.
--    Roda junto da varredura; usa random() no momento da finalização detectada.
-- ----------------------------------------------------------------------------
create or replace function public.sample_yellow_for_review()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_pct   int := public.nursing_setting_num('reviewSamplingPct', 10)::int;
  v_count int := 0;
begin
  if v_pct <= 0 then return 0; end if;

  with sorteados as (
    update public.clinical_alerts a
       set review_pending = true, updated_at = now()
     where a.status = 'YELLOW'
       and a.attendance_status in ('ATTENDED', 'IGNORED')
       and a.review_pending = false
       and a.attended_at > now() - interval '1 day'
       and a.escalated_at is null
       and (random() * 100) < v_pct
    returning a.id
  )
  select count(*) into v_count from sorteados;

  return v_count;
end;
$$;

revoke execute on function public.sample_yellow_for_review() from public;
grant  execute on function public.sample_yellow_for_review() to authenticated;

-- ----------------------------------------------------------------------------
-- 8) Agendamentos (idempotentes, padrão 0038/0061).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
      where jobname in ('nurse-queue-sweep', 'nurse-review-sampling');

    perform cron.schedule(
      'nurse-queue-sweep',
      '*/2 * * * *',
      $sql$select public.reoffer_expired_alerts();$sql$
    );

    -- Amostragem 1x/dia (03:10 UTC = 00:10 America/Sao_Paulo).
    perform cron.schedule(
      'nurse-review-sampling',
      '10 3 * * *',
      $sql$select public.sample_yellow_for_review();$sql$
    );
  else
    raise warning 'pg_cron indisponível — a fila de enfermagem NÃO será varrida automaticamente (ofertas não expiram, SLA não escala). Habilite a extensão e rode esta migration novamente.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (cenários 1–4 do PR):
--
--   -- ligar a distribuição automática:
--   update public.app_settings set data = data || '{"autoRouting": true}'::jsonb where section = 'nursing';
--
--   -- 1) dois enfermeiros livres, três amarelos → distribuição balanceada:
--   select public.reoffer_expired_alerts();
--   select assigned_nurse_id, count(*) from public.clinical_alerts
--    where status='YELLOW' and attendance_status='PENDING' group by 1;
--
--   -- 2) oferta expira sem aceite → re-oferecida (o alerta nunca some):
--   update public.clinical_alerts set offer_expires_at = now() - interval '1 minute' where id = '<alerta>';
--   select public.reoffer_expired_alerts();
--   select status, observation from public.attendance_confirmations where alert_id='<alerta>' order by created_at desc limit 2;
--
--   -- 3) ninguém de plantão → fica em fila aberta e NÃO é marcado como atrasado:
--   select public.nurse_close_shift();   -- em cada enfermeiro
--   select public.reoffer_expired_alerts();
--   select sla_breached_at from public.clinical_alerts where id='<alerta>';   -- null
--
--   -- 4) amarelo além do SLA máximo → escala sozinho, status CONTINUA YELLOW:
--   update public.clinical_alerts set created_at = now() - interval '9 hours' where id = '<alerta>';
--   select public.reoffer_expired_alerts();
--   select status, escalated_at, escalated_by, auto_escalated from public.clinical_alerts where id='<alerta>';
--   --> YELLOW / preenchido / null / true
-- ----------------------------------------------------------------------------
