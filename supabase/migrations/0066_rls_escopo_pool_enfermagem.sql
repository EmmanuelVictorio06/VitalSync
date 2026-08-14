-- ============================================================================
-- Migration: 0066_rls_escopo_pool_enfermagem  (Triagem de Enfermagem — Fase 1.3)
--
-- Estende o escopo de LEITURA para o enfermeiro do pool. Até aqui o enfermeiro
-- só enxergava as equipes das quais era membro (`is_team_member`, 0054); agora
-- também enxerga os pacientes dos hospitais cobertos pelo seu pool
-- (`is_nurse_for_patient`, 0065), porque a triagem primária é feita por um
-- grupo de enfermeiros que cobre várias equipes.
--
-- TODAS as alterações são ADITIVAS: cada política ganha um `or
-- public.is_nurse_for_patient(...)` e nenhuma condição anterior é removida.
-- Nada é afrouxado para os demais papéis.
--
-- POLÍTICAS TOCADAS (versão viva reescrita a partir da migration indicada):
--   1. alerts_select                    (viva na 0030)  → + enfermeiro do pool
--   2. patients_select                  (viva na 0030)  → + enfermeiro do pool
--   3. vitals_select                    (viva na 0030)  → + enfermeiro do pool
--   4. attendance_select                (viva na 0039)  → + enfermeiro do pool
--   5. patient_followups_select         (viva na 0050)  → + enfermeiro do pool
--   6. patient_followups_insert         (viva na 0050)  → + enfermeiro do pool
--   7. missed_measurement_logs_select   (viva na 0060)  → + enfermeiro do pool
--
-- As GUARDAS INTERNAS das RPCs (alert_set_in_analysis, alert_mark_attended,
-- alert_ignore, alert_release_analysis, staff_insert_vital_record) são
-- estendidas na 0067, junto com a restrição "só amarelos" — assim cada RPC é
-- reescrita UMA vez só, com as duas mudanças.
--
-- LGPD: ampliar escopo remove a RLS por equipe como controle técnico de
-- minimização. O pool passa a ser essa fronteira, e a 0067 cria a trilha de
-- acesso (`patient_access_logs`). Ver docs/FLUXO_ENFERMAGEM.md.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0065.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Alertas — leitura (base: 0030).
-- ----------------------------------------------------------------------------
drop policy if exists alerts_select on public.clinical_alerts;
create policy alerts_select on public.clinical_alerts for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
    or public.is_nurse_for_patient(patient_id)
  );

-- ----------------------------------------------------------------------------
-- 2) Pacientes — leitura (base: 0030, que já inclui is_support() da 0016).
-- ----------------------------------------------------------------------------
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (
    public.is_admin()
    or public.is_support()
    or public.is_team_member(team_id)
    or public.is_team_manager_of(team_id)
    or public.is_nurse_for_patient(id)
  );

-- ----------------------------------------------------------------------------
-- 3) Sinais vitais — leitura (base: 0030).
-- ----------------------------------------------------------------------------
drop policy if exists vitals_select on public.vital_sign_records;
create policy vitals_select on public.vital_sign_records for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    or public.is_team_manager_of((select team_id from public.patients p where p.id = patient_id))
    or public.is_nurse_for_patient(patient_id)
  );

-- ----------------------------------------------------------------------------
-- 4) Timeline de atendimento — leitura (base: 0039).
-- ----------------------------------------------------------------------------
drop policy if exists attendance_select on public.attendance_confirmations;
create policy attendance_select on public.attendance_confirmations for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    or public.is_team_manager_of((select team_id from public.patients p where p.id = patient_id))
    or public.is_nurse_for_patient(patient_id)
  );

-- ----------------------------------------------------------------------------
-- 5) Videochamada de 48h — leitura E escrita (base: 0050).
--    O enfermeiro do pool é quem executa a chamada estruturada do protocolo
--    5.6.5 (ela já aparece na agenda do NurseDashboard), então precisa poder
--    registrá-la — não só lê-la. `performed_by = auth.uid()` continua valendo.
-- ----------------------------------------------------------------------------
drop policy if exists patient_followups_select on public.patient_followups;
create policy patient_followups_select on public.patient_followups for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    or public.is_nurse_for_patient(patient_id)
  );

drop policy if exists patient_followups_insert on public.patient_followups;
create policy patient_followups_insert on public.patient_followups for insert to authenticated
  with check (
    performed_by = auth.uid()
    and (
      public.is_admin()
      or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
      or public.is_nurse_for_patient(patient_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 6) Medição esquecida — leitura (base: 0060).
--    Usa patient_id (e não team_id) porque o escopo da enfermagem é por
--    hospital do paciente, não por equipe.
-- ----------------------------------------------------------------------------
drop policy if exists missed_measurement_logs_select on public.missed_measurement_logs;
create policy missed_measurement_logs_select on public.missed_measurement_logs for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member(team_id)
    or public.is_nurse_for_patient(patient_id)
  );

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar, logado como enfermeiro de um pool que cobre
-- o hospital do paciente mas SEM ser membro da equipe dele):
--
--   select count(*) from public.patients;              -- > 0 (antes: 0)
--   select count(*) from public.clinical_alerts;       -- enxerga os do pool
--   select count(*) from public.vital_sign_records;
--
--   -- e um paciente de hospital NÃO coberto continua invisível:
--   select public.is_nurse_for_patient('<paciente de hospital fora do pool>');  -- false
--
--   -- nenhum outro papel mudou: repita como SUPPORT/MANAGER e compare com o
--   -- comportamento anterior.
-- ----------------------------------------------------------------------------
