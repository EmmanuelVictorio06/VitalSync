-- ============================================================================
-- Migration: 0078_reavaliacao_2h_enfermagem
--
-- REAVALIAÇÃO DE ENFERMAGEM EM 2H APÓS ATENDER UM AMARELO.
--
-- Quando a enfermagem atende um alerta AMARELO, o caso não termina ali: é
-- preciso recontatar o paciente algumas horas depois para saber se melhorou.
-- Hoje isso depende da memória de quem atendeu. Esta migration transforma o
-- recontato num COMPROMISSO RASTREÁVEL: `alert_mark_attended` agenda sozinha
-- uma reavaliação PENDING, que aparece na fila da enfermagem e vence no prazo.
--
-- ─── POR QUE SÓ AMARELO E SÓ ENFERMAGEM ─────────────────────────────────────
-- É a mesma fronteira da 0077: o amarelo é evento da enfermagem, o vermelho é
-- dos médicos. Então a reavaliação nasce apenas quando quem atendeu é
-- enfermagem (`is_nurse`) E a severidade EFETIVA do alerta é amarela
-- (`status = 'YELLOW'` e `escalated_at is null`). Médico que atende um amarelo
-- não gera reavaliação — ele não está na fila de triagem. Vermelho nunca gera:
-- já é caso do médico.
--
-- Note que a severidade EFETIVA (0077) é obrigatória aqui. Um alerta escalado
-- continua com `status = 'YELLOW'`; se olhássemos só o status, escalar e depois
-- atender criaria uma reavaliação de enfermagem para um caso que já é do
-- médico.
--
-- ─── O PRAZO É PARÂMETRO, NÃO CONSTANTE ─────────────────────────────────────
-- `reassessmentMinutes` entra em `app_settings.nursing` (default 120), lido por
-- `nursing_setting_num` como todos os outros parâmetros operacionais (0063).
-- "2h" é o default clínico de hoje, não uma verdade cravada em código.
--
-- ─── A REAVALIAÇÃO MORRE COM O CASO ─────────────────────────────────────────
-- Se o alerta for escalado (vira do médico) ou finalizado antes do prazo, a
-- reavaliação PENDING é CANCELADA — cobrar um recontato de enfermagem sobre um
-- caso que saiu das mãos dela seria ruído. Isso é feito por TRIGGER em
-- `clinical_alerts`, e não dentro de `alert_escalate_to_red`, de propósito: o
-- `escalated_at` também é gravado pelo auto-escalonamento de 8h
-- (`reoffer_expired_alerts`, 0068), que não passa por RPC nenhuma. Um trigger
-- pega os dois caminhos; um `update` dentro da RPC pegaria só um.
--
-- ─── TERMINOLOGIA: "reavaliação" no código, "recontato" na tela ─────────────
-- A UI chama isto de **"Recontato de enfermagem"**, não de "reavaliação". O
-- motivo é concreto: a central de enfermagem já tinha um bloco **"Reaferições
-- de 2h"** (protocolo 5.7.2 — pedir ao paciente uma NOVA MEDIÇÃO em 2h após um
-- amarelo isolado), e os dois blocos ficam adjacentes na mesma página. Chamar o
-- recontato de "reavaliação em 2h" ao lado de "reaferição em 2h" era pedir
-- confusão no piloto.
--
-- Os identificadores de banco e código continuam `nurse_reassessment*` porque é
-- o conceito clínico (o enfermeiro REAVALIA o paciente; o recontato é o meio).
-- Se você procurou por "recontato" no SQL e não achou, é por isso — procure por
-- `nurse_reassessments`.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0077.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Parâmetro operacional: prazo da reavaliação (minutos).
--    `||` preserva o que já existe na seção e só acrescenta a chave nova.
-- ----------------------------------------------------------------------------
insert into public.app_settings (section, data)
values ('nursing', jsonb_build_object('reassessmentMinutes', 120))
on conflict (section) do update
  set data = public.app_settings.data || jsonb_build_object(
    'reassessmentMinutes',
    coalesce(public.app_settings.data -> 'reassessmentMinutes', to_jsonb(120))
  );

-- ----------------------------------------------------------------------------
-- 2) Tabela das reavaliações.
-- ----------------------------------------------------------------------------
create table if not exists public.nurse_reassessments (
  id            uuid primary key default gen_random_uuid(),
  alert_id      uuid not null references public.clinical_alerts(id) on delete cascade,
  patient_id    uuid not null references public.patients(id) on delete cascade,
  team_id       uuid          references public.medical_teams(id) on delete set null,
  scheduled_by  uuid          references public.profiles(id) on delete set null,
  due_at        timestamptz not null,
  status        text not null default 'PENDING'
                  check (status in ('PENDING', 'DONE', 'CANCELLED')),
  outcome       text          check (outcome in ('IMPROVED', 'UNCHANGED', 'WORSENED')),
  observation   text,
  performed_by  uuid          references public.profiles(id) on delete set null,
  performed_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  -- Coerência de estado: PENDING não tem desfecho; DONE exige desfecho, autor e
  -- horário. Sem isso, uma RPC futura poderia gravar meia conclusão.
  constraint nurse_reassessments_estado_chk check (
    (status = 'PENDING'   and outcome is null and performed_at is null)
    or (status = 'DONE'   and outcome is not null and performed_at is not null)
    or (status = 'CANCELLED')
  )
);

comment on table public.nurse_reassessments is
  'Recontato de enfermagem agendado após atender um alerta AMARELO (prazo em app_settings.nursing.reassessmentMinutes). Criada por alert_mark_attended, concluída por nurse_reassessment_complete, cancelada por trigger quando o alerta é escalado ou finalizado.';
comment on column public.nurse_reassessments.due_at is
  'Horário previsto do recontato = attended_at + reassessmentMinutes. "Em atraso" é due_at < now(); a UI formata em America/Sao_Paulo.';
comment on column public.nurse_reassessments.outcome is
  'IMPROVED / UNCHANGED / WORSENED. WORSENED NÃO escala sozinho — a escalada segue sendo ato explícito via alert_escalate_to_red.';

-- Só UMA reavaliação PENDING por alerta. É esta constraint que torna o
-- agendamento idempotente sob corrida — não o `if not exists` do código.
create unique index if not exists nurse_reassessments_uma_pendente_por_alerta
  on public.nurse_reassessments(alert_id)
  where status = 'PENDING';

create index if not exists idx_nurse_reassessments_pendentes
  on public.nurse_reassessments(due_at)
  where status = 'PENDING';
create index if not exists idx_nurse_reassessments_equipe
  on public.nurse_reassessments(team_id, status);
create index if not exists idx_nurse_reassessments_paciente
  on public.nurse_reassessments(patient_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3) RLS: leitura para quem já pode agir no alerta (equipe OU enfermeiro do
--    pool do paciente) + Admin. NENHUMA policy de escrita — só as RPCs definer
--    gravam, como em clinical_alerts.
-- ----------------------------------------------------------------------------
alter table public.nurse_reassessments enable row level security;

drop policy if exists nurse_reassessments_select on public.nurse_reassessments;
create policy nurse_reassessments_select
  on public.nurse_reassessments for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
    or public.is_nurse_for_patient(patient_id)
  );

revoke all on public.nurse_reassessments from anon, authenticated;
grant select on public.nurse_reassessments to authenticated;

-- ----------------------------------------------------------------------------
-- 4) alert_mark_attended — base viva (0067) + agendamento da reavaliação.
--    MESMA assinatura → create or replace. Todo o corpo anterior é preservado;
--    o bloco novo é só o final.
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

  -- §3.4: vermelho é do médico da equipe.
  if not public.nurse_may_finalize(v_alert.status) then
    raise exception 'Alertas vermelhos são atendidos pelo médico da equipe. Registre o contato e, se precisar, avise a equipe.';
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

  -- ── NOVO (0078): agenda o recontato de enfermagem ────────────────────────
  -- Severidade EFETIVA amarela + quem atendeu é enfermagem. `v_quem` (e não
  -- auth.uid()) porque a tela permite registrar o atendimento em nome do
  -- profissional que de fato atendeu — a reavaliação é de quem atendeu.
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
  'Finaliza o atendimento do alerta e, quando quem atendeu é enfermagem e o alerta é amarelo não escalado, agenda a reavaliação de recontato (0078).';

revoke execute on function public.alert_mark_attended(uuid, uuid, text) from public, anon;
grant  execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Conclusão da reavaliação.
--    WORSENED **não** escala aqui: devolve `should_escalate = true` e o front
--    oferece o botão. Escalar continua sendo ato explícito e auditável de uma
--    pessoa (0077), não efeito colateral de preencher um formulário.
-- ----------------------------------------------------------------------------
create or replace function public.nurse_reassessment_complete(
  p_id uuid,
  p_outcome text,
  p_observation text
)
returns table (should_escalate boolean, alert_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_r     public.nurse_reassessments;
  v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if p_outcome not in ('IMPROVED', 'UNCHANGED', 'WORSENED') then
    raise exception 'Desfecho inválido. Use melhorou, mantém ou piorou.';
  end if;

  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Descreva o que o paciente relatou na reavaliação.';
  end if;

  select * into v_r from public.nurse_reassessments where id = p_id for update;
  if not found then raise exception 'Reavaliação não encontrada.'; end if;

  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o profissional de enfermagem registra a reavaliação.';
  end if;

  if not public.can_act_on_alert(v_r.team_id, v_r.patient_id) then
    raise exception 'Sem permissão para esta reavaliação.';
  end if;

  if v_r.status = 'DONE' then
    raise exception 'Esta reavaliação já foi registrada.';
  end if;
  if v_r.status = 'CANCELLED' then
    raise exception 'Esta reavaliação foi cancelada porque o caso saiu da enfermagem.';
  end if;

  update public.nurse_reassessments
     set status = 'DONE',
         outcome = p_outcome,
         observation = p_observation,
         performed_by = auth.uid(),
         performed_at = now()
   where id = p_id;

  -- Timeline do alerta: o recontato entra junto com os outros eventos.
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_r.patient_id, v_r.alert_id, auth.uid(), 'REASSESSED',
            case p_outcome
              when 'IMPROVED'  then 'Reavaliação: melhorou. '
              when 'UNCHANGED' then 'Reavaliação: mantém. '
              else                  'Reavaliação: piorou. '
            end || p_observation);

  perform public.audit_alert_action('NURSE_REASSESSMENT_DONE', v_r.patient_id);
  perform public.log_patient_access(v_r.patient_id, 'reavaliação de enfermagem registrada');

  -- Só sugere escalar se ainda fizer sentido: piorou, alerta ainda amarelo,
  -- não escalado e não finalizado. Evita oferecer um botão que a RPC recusaria.
  select * into v_alert from public.clinical_alerts where id = v_r.alert_id;
  return query
    select p_outcome = 'WORSENED'
             and v_alert.status = 'YELLOW'
             and v_alert.escalated_at is null,
           v_r.alert_id;
end; $$;

comment on function public.nurse_reassessment_complete(uuid, text, text) is
  'Registra o desfecho do recontato (IMPROVED/UNCHANGED/WORSENED). Devolve should_escalate para a UI oferecer alert_escalate_to_red — nunca escala sozinha.';

revoke execute on function public.nurse_reassessment_complete(uuid, text, text) from public, anon;
grant  execute on function public.nurse_reassessment_complete(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5b) Escalar A PARTIR da reavaliação — REABRE o alerta e delega à 0077.
--
--    POR QUE ISTO PRECISA EXISTIR: a reavaliação só nasce depois que o alerta
--    foi ATENDIDO, e `alert_escalate_to_red` recusa alerta finalizado ("Este
--    alerta já foi finalizado."). Sem esta RPC, o caminho "piorou → escalar"
--    seria impossível — a tela ofereceria um botão que o banco sempre recusa.
--
--    A guarda da 0077 existe para impedir que alguém ressuscite um caso
--    encerrado do nada. A reavaliação é justamente a via SANCIONADA para isso:
--    o paciente piorou dentro da janela de recontato. Então aqui o alerta é
--    REABERTO (volta a PENDING) e a escalada em si continua sendo feita por
--    `alert_escalate_to_red` — não reimplementada. A 0077 segue como fonte
--    única da semântica de escalonamento (grava escalated_at/by/reason, põe
--    ESCALATED na timeline, audita e dispara a rota vermelha).
--
--    A reabertura zera os campos de ESTADO ATUAL (attended*), não o histórico:
--    `attendance_confirmations` preserva quem atendeu e quando, e ganha um
--    evento REOPENED. É o mesmo modelo que a própria 0077 usa ao devolver o
--    alerta para PENDING.
-- ----------------------------------------------------------------------------
create or replace function public.nurse_reassessment_escalate(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_r     public.nurse_reassessments;
  v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Descreva por que este caso precisa do médico.';
  end if;

  select * into v_r from public.nurse_reassessments where id = p_id for update;
  if not found then raise exception 'Reavaliação não encontrada.'; end if;

  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o profissional de enfermagem escala um caso para o médico.';
  end if;
  if not public.can_act_on_alert(v_r.team_id, v_r.patient_id) then
    raise exception 'Sem permissão para esta reavaliação.';
  end if;

  -- Escalar é consequência de um desfecho REGISTRADO, não atalho: obriga a
  -- reavaliação a estar concluída como "piorou".
  if v_r.status <> 'DONE' or v_r.outcome <> 'WORSENED' then
    raise exception 'Só um caso reavaliado como "piorou" é escalado por aqui. Registre o desfecho primeiro.';
  end if;

  select * into v_alert from public.clinical_alerts where id = v_r.alert_id for update;
  if v_alert.escalated_at is not null then
    raise exception 'Este alerta já foi escalado para o médico.';
  end if;
  if v_alert.status <> 'YELLOW' then
    raise exception 'Só alertas amarelos são escalados pela enfermagem.';
  end if;

  -- Reabre: o caso volta a ser fila ativa para poder ser escalado.
  update public.clinical_alerts
     set attendance_status = 'PENDING',
         attended     = false,
         attended_by  = null,
         attended_at  = null,
         updated_at   = now()
   where id = v_r.alert_id;

  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_r.patient_id, v_r.alert_id, auth.uid(), 'REOPENED',
            'Reaberto pela reavaliação de enfermagem (paciente piorou).');

  -- A escalada em si é da 0077 — inclusive a rota vermelha para os médicos.
  perform public.alert_escalate_to_red(v_r.alert_id, p_reason);
end; $$;

comment on function public.nurse_reassessment_escalate(uuid, text) is
  'Reabre o alerta atendido cuja reavaliação deu "piorou" e delega a escalada a alert_escalate_to_red (0077). Existe porque a reavaliação nasce com o alerta já ATENDIDO, estado que a 0077 recusa.';

revoke execute on function public.nurse_reassessment_escalate(uuid, text) from public, anon;
grant  execute on function public.nurse_reassessment_escalate(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Adiar o recontato (paciente não atendeu o telefone).
--    Registrar "não consegui falar" é diferente de concluir: mantém a pendência
--    viva com prazo novo e deixa rastro da tentativa.
-- ----------------------------------------------------------------------------
create or replace function public.nurse_reassessment_postpone(
  p_id uuid,
  p_minutes int,
  p_reason text
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_r    public.nurse_reassessments;
  v_novo timestamptz;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Diga por que a reavaliação está sendo adiada.';
  end if;
  if coalesce(p_minutes, 0) < 5 or p_minutes > 1440 then
    raise exception 'O adiamento precisa ser entre 5 minutos e 24 horas.';
  end if;

  select * into v_r from public.nurse_reassessments where id = p_id for update;
  if not found then raise exception 'Reavaliação não encontrada.'; end if;

  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o profissional de enfermagem adia a reavaliação.';
  end if;
  if not public.can_act_on_alert(v_r.team_id, v_r.patient_id) then
    raise exception 'Sem permissão para esta reavaliação.';
  end if;
  if v_r.status <> 'PENDING' then
    raise exception 'Só uma reavaliação pendente pode ser adiada.';
  end if;

  v_novo := now() + make_interval(mins => p_minutes);
  update public.nurse_reassessments set due_at = v_novo where id = p_id;

  -- A tentativa de contato fica na timeline do alerta.
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_r.patient_id, v_r.alert_id, auth.uid(), 'CONTACT',
            'Reavaliação adiada: ' || p_reason);

  perform public.audit_alert_action('NURSE_REASSESSMENT_POSTPONED', v_r.patient_id);
  return v_novo;
end; $$;

revoke execute on function public.nurse_reassessment_postpone(uuid, int, text) from public, anon;
grant  execute on function public.nurse_reassessment_postpone(uuid, int, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) Cancelamento automático quando o caso sai da enfermagem.
--    TRIGGER (e não código dentro da RPC) porque `escalated_at` é gravado por
--    DOIS caminhos: `alert_escalate_to_red` (0077) e o auto-escalonamento de 8h
--    dentro de `reoffer_expired_alerts` (0068), que não passa por RPC.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_reassessment_on_alert_exit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_motivo text;
begin
  if NEW.escalated_at is not null and OLD.escalated_at is null then
    v_motivo := 'Alerta escalado para o médico.';
  elsif NEW.attendance_status = 'IGNORED' and OLD.attendance_status <> 'IGNORED' then
    v_motivo := 'Alerta finalizado (ignorado).';
  else
    return NEW;
  end if;

  update public.nurse_reassessments
     set status = 'CANCELLED', cancel_reason = v_motivo
   where alert_id = NEW.id and status = 'PENDING';

  return NEW;
end; $$;

drop trigger if exists trg_cancel_reassessment_on_alert_exit on public.clinical_alerts;
create trigger trg_cancel_reassessment_on_alert_exit
  after update on public.clinical_alerts
  for each row execute function public.cancel_reassessment_on_alert_exit();

-- ----------------------------------------------------------------------------
-- 8) Leitura para a tela e para a fila.
--    `security definer` + guarda explícita: RPC definer ignora RLS, então a
--    checagem é repetida no corpo (regra do repo).
-- ----------------------------------------------------------------------------
create or replace function public.nurse_reassessments_for_patient(p_patient uuid)
returns setof public.nurse_reassessments
language sql stable security definer set search_path = public as $$
  select r.* from public.nurse_reassessments r
   where r.patient_id = p_patient
     and (public.is_admin()
          or public.is_team_member(r.team_id)
          or public.is_team_manager_of(r.team_id)
          or public.is_nurse_for_patient(r.patient_id))
   order by r.created_at desc;
$$;

revoke execute on function public.nurse_reassessments_for_patient(uuid) from public, anon;
grant  execute on function public.nurse_reassessments_for_patient(uuid) to authenticated;

/**
 * Fila da enfermagem: pendentes visíveis a quem está logado, mais atrasadas
 * primeiro. É o que garante que o recontato não dependa de abrir paciente por
 * paciente.
 */
create or replace function public.nurse_reassessments_due()
returns table (
  id           uuid,
  alert_id     uuid,
  patient_id   uuid,
  patient_name text,
  team_id      uuid,
  due_at       timestamptz,
  overdue      boolean,
  scheduled_by_name text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.alert_id, r.patient_id, p.name, r.team_id, r.due_at,
         r.due_at < now(),
         sb.name
    from public.nurse_reassessments r
    join public.patients p  on p.id = r.patient_id
    left join public.profiles sb on sb.id = r.scheduled_by
   where r.status = 'PENDING'
     and p.status = 'ACTIVE'
     and (public.is_admin()
          or public.is_team_member(r.team_id)
          or public.is_nurse_for_patient(r.patient_id))
   order by r.due_at;
$$;

revoke execute on function public.nurse_reassessments_due() from public, anon;
grant  execute on function public.nurse_reassessments_due() to authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar — sempre pelo caminho REAL):
--
--   -- 1. amarelo atendido por ENFERMEIRO agenda 1 pendente:
--   select status, due_at, due_at - now() as falta
--     from public.nurse_reassessments where alert_id = '<alerta amarelo>';
--
--   -- 2. amarelo atendido por MÉDICO não agenda nada: 0 linhas.
--
--   -- 3. prazo vem do parâmetro, não do código:
--   select public.nursing_setting_num('reassessmentMinutes', 120);
--
--   -- 4. escalar cancela a pendente:
--   select public.alert_escalate_to_red('<alerta>', 'piora');
--   select status, cancel_reason from public.nurse_reassessments where alert_id = '<alerta>';
--   --> CANCELLED / 'Alerta escalado para o médico.'
--
--   -- 5. só uma pendente por alerta (o índice único é quem garante):
--   select indexdef from pg_indexes
--    where indexname = 'nurse_reassessments_uma_pendente_por_alerta';
-- ----------------------------------------------------------------------------
