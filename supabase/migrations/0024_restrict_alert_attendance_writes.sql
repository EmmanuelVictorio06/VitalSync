-- ============================================================================
-- VitalSync — Fase 6 / M-08: escrita em alertas e atendimentos só via RPC.
--
-- PROBLEMA: as policies permitiam UPDATE direto em clinical_alerts e escrita
-- ampla (for all) em attendance_confirmations por qualquer membro da equipe.
-- Isso deixa o cliente "marcar atendido" / mexer na trilha sem passar pelas
-- regras (observação obrigatória, timeline, auditoria) das RPCs SECURITY DEFINER.
--
-- ALVO: SELECT por RLS; INSERT/UPDATE só pelas RPCs (alert_set_in_analysis,
-- alert_mark_attended, alert_ignore, alert_update_observation), que rodam como
-- owner (bypass RLS) e revalidam o vínculo por equipe.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0008.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) clinical_alerts: remove o UPDATE direto. SELECT (alerts_select, 0001)
--    permanece. INSERT já não tinha policy (só as RPCs/submit inserem).
-- ----------------------------------------------------------------------------
drop policy if exists alerts_update on public.clinical_alerts;

-- ----------------------------------------------------------------------------
-- 2) attendance_confirmations: troca a policy ampla (for all) por SELECT apenas.
--    A escrita passa a ser exclusivamente pelas RPCs.
-- ----------------------------------------------------------------------------
drop policy if exists attendance_rw on public.attendance_confirmations;
drop policy if exists attendance_select on public.attendance_confirmations;
create policy attendance_select on public.attendance_confirmations for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
  );

-- ----------------------------------------------------------------------------
-- 3) RPC para editar a observação de um atendimento (substitui o UPDATE direto
--    que o frontend fazia). Revalida o vínculo por equipe.
-- ----------------------------------------------------------------------------
create or replace function public.alert_update_observation(p_id uuid, p_observation text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid;
  v_team    uuid;
begin
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

grant execute on function public.alert_update_observation(uuid, text) to authenticated;
