-- ============================================================================
-- Migration: 0039_gerente_integrantes_e_alertas_ro
--
-- Duas features do papel TEAM_MANAGER (Gerente de Equipe):
--
-- 1) Card "Integrantes da Equipe" (cirurgião E associado) precisa enxergar o
--    Gerente vinculado. teamViewService.getTeamDetail() já busca isso via
--    teamManagerService.getManagersOfSurgeon(), mas o RLS de
--    team_manager_surgeons só liberava o PRÓPRIO gerente (tms_own_select,
--    0030) e o cirurgião responsável (tms_surgeon_select, 0037) — o médico
--    ASSOCIADO não tinha nenhuma policy, então a query voltava vazia
--    (best-effort catch em getTeamDetail) e o gerente sumia do card dele.
--
-- 2) Gerente vê Alertas em modo somente-leitura. A UI já bloqueia
--    (permissionService.canAttendAlerts nunca inclui MANAGER); esta migration
--    reforça no banco. ACHADO ao auditar: a 0030_team_manager_schema.sql
--    reintroduziu, sem perceber, exatamente a brecha que a
--    0024_restrict_alert_attendance_writes.sql (M-08) tinha fechado — ela
--    recriou `alerts_update` (UPDATE direto em clinical_alerts) e uma
--    `attendance_rw` "for all" em attendance_confirmations, ambas incluindo
--    is_team_manager_of. Isso não é só um problema do Gerente: qualquer
--    membro de equipe também podia escrever direto nessas tabelas contornando
--    as RPCs (observação obrigatória, timeline, auditoria). Esta migration
--    fecha a brecha de novo (mantendo leitura para o Gerente) e, por cima,
--    adiciona um bloqueio explícito de TEAM_MANAGER nas 4 RPCs de escrita,
--    para a proteção não depender só da RLS.
--
-- ADITIVA/IDEMPOTENTE onde possível (funções via CREATE OR REPLACE); as
-- policies de escrita são DROP + (não recriadas) para restaurar o estado
-- RPC-only do M-08.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) team_manager_surgeons: membro ATIVO da equipe (cirurgião OU associado) lê
--    os vínculos ATIVOS do(s) gerente(s) do seu cirurgião responsável — só o
--    vínculo corrente, não o histórico de vínculos desfeitos (is_active).
--    Aditivo às policies existentes (tms_admin, tms_own_select,
--    tms_surgeon_select) — só acrescenta mais uma policy permissiva de SELECT.
-- ----------------------------------------------------------------------------
drop policy if exists tms_team_member_select on public.team_manager_surgeons;
create policy tms_team_member_select on public.team_manager_surgeons for select to authenticated
  using (
    is_active
    and exists (
      select 1 from public.medical_teams t
      where t.main_surgeon_id = team_manager_surgeons.surgeon_id
        and public.is_team_member(t.id)
    )
  );

-- ----------------------------------------------------------------------------
-- 2) profiles: estende profiles_select (0025 → 0036 → 0037) para o médico
--    (cirurgião ou associado) também ler o PERFIL do gerente da sua equipe —
--    sem essa leitura, o nome/contato do gerente não resolve no embed do
--    teamViewService mesmo com o item 1 acima liberado.
-- ----------------------------------------------------------------------------
create or replace function public.team_member_sees_manager(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.team_manager_surgeons tms
    join public.medical_teams t on t.main_surgeon_id = tms.surgeon_id
    where tms.team_manager_id = p_other
      and tms.is_active
      and public.is_team_member(t.id)
  );
$$;
grant execute on function public.team_member_sees_manager(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.shares_team_with(id)
    or public.manager_scope_includes(id)
    or public.surgeon_sees_manager(id)
    or public.team_member_sees_manager(id)
  );

-- ----------------------------------------------------------------------------
-- 3) clinical_alerts: remove de novo o UPDATE direto (regressão da 0030).
--    SELECT (alerts_select, 0030) permanece — inclui is_team_manager_of, então
--    o Gerente continua enxergando os alertas das suas equipes. Escrita só
--    pelas RPCs alert_set_in_analysis / alert_mark_attended / alert_ignore,
--    que rodam como owner (bypass RLS) e revalidam o vínculo.
-- ----------------------------------------------------------------------------
drop policy if exists alerts_update on public.clinical_alerts;

-- ----------------------------------------------------------------------------
-- 4) attendance_confirmations: troca a "for all" (regressão da 0030) de volta
--    por SELECT apenas — estendendo o alcance de leitura ao Gerente (ele vê a
--    timeline de atendimento no drawer de detalhes do alerta). Escrita só via
--    alert_mark_attended / alert_set_in_analysis / alert_ignore /
--    alert_update_observation.
-- ----------------------------------------------------------------------------
drop policy if exists attendance_rw on public.attendance_confirmations;
drop policy if exists attendance_select on public.attendance_confirmations;
create policy attendance_select on public.attendance_confirmations for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    or public.is_team_manager_of((select team_id from public.patients p where p.id = patient_id))
  );

-- ----------------------------------------------------------------------------
-- 5) Defesa em profundidade: bloqueio explícito de TEAM_MANAGER no início das
--    4 RPCs de escrita de alerta/atendimento. Hoje elas já rejeitam o Gerente
--    indiretamente (checam is_team_member, que não inclui gerente) — este
--    bloqueio é redundante de propósito, para não depender só desse detalhe
--    de implementação, e dá um erro mais claro (MANAGER_READ_ONLY) do que o
--    genérico "Sem permissão para este alerta.".
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
  update public.clinical_alerts
    set attendance_status = 'IN_ANALYSIS', updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IN_ANALYSIS', null);
  perform public.audit_alert_action('ALERT_IN_ANALYSIS', v_alert.patient_id);
end; $$;

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

create or replace function public.alert_ignore(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert public.clinical_alerts;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe a justificativa para ignorar o alerta.';
  end if;
  select * into v_alert from public.clinical_alerts where id = p_alert;
  if not found then raise exception 'Alerta não encontrado.'; end if;
  if not (public.is_admin() or public.is_team_member(v_alert.team_id)) then
    raise exception 'Sem permissão para este alerta.';
  end if;
  update public.clinical_alerts
    set attendance_status = 'IGNORED', ignored_reason = p_reason,
        attended = true, attended_by = auth.uid(), attended_at = now(), updated_at = now()
    where id = p_alert;
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
    values (v_alert.patient_id, p_alert, auth.uid(), 'IGNORED', p_reason);
  perform public.audit_alert_action('ALERT_IGNORED', v_alert.patient_id);
end; $$;

create or replace function public.alert_update_observation(p_id uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid;
  v_team    uuid;
begin
  if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;

  if coalesce(trim(p_observation), '') = '' then
    raise exception 'Informe a observação do atendimento.';
  end if;

  select patient_id into v_patient from public.attendance_confirmations where id = p_id;
  if v_patient is null then raise exception 'Registro de atendimento não encontrado.'; end if;

  select team_id into v_team from public.patients where id = v_patient;
  if not (public.is_admin() or public.is_team_member(v_team)) then
    raise exception 'Sem permissão para editar este atendimento.';
  end if;

  update public.attendance_confirmations set observation = p_observation where id = p_id;
end;
$$;

grant execute on function public.alert_set_in_analysis(uuid)        to authenticated;
grant execute on function public.alert_mark_attended(uuid, uuid, text) to authenticated;
grant execute on function public.alert_ignore(uuid, text)            to authenticated;
grant execute on function public.alert_update_observation(uuid, text) to authenticated;
