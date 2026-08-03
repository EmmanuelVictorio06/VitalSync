-- ============================================================================
-- VitalSync — Fase 4 de conformidade com o Fluxo Operacional do estudo piloto:
-- coorte (5.10) e avaliação em 30 dias (5.8). A adesão/completude (5.11, item
-- 4.1) não precisa de coluna nova — é calculada sob demanda a partir de
-- `vital_sign_records` já existente (ver frontend/src/services/adherenceService.ts).
--
--   1) `patients.study_group` ('INTERVENTION'/'HISTORICAL_CONTROL', default
--      INTERVENTION): todo paciente cadastrado pelo app é do grupo
--      intervenção por definição (usa o monitoramento remoto). O grupo
--      controle histórico é coletado retrospectivamente por prontuário, FORA
--      do app — este campo só existe para permitir marcar/filtrar no export
--      quando a equipe do estudo precisar comparar os dois grupos.
--
--   2) `patient_day30_assessments`: contato telefônico de 30 dias (5.8) —
--      desfechos (procura por pronto atendimento, reinternação, avaliação não
--      programada, persistência de sintomas) + questionário de satisfação
--      (escala Likert 1–5: segurança/facilidade/comunicação/geral + comentário
--      aberto). ASSUNÇÃO: o protocolo não especifica a escala exata da
--      satisfação — 1–5 é o padrão adotado aqui, a confirmar com o time do
--      estudo (ver docs/PONTOS_PENDENTES.md).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0054.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Coorte (5.10).
-- ----------------------------------------------------------------------------
alter table public.patients add column if not exists study_group text not null default 'INTERVENTION';

alter table public.patients drop constraint if exists patients_study_group_check;
alter table public.patients add constraint patients_study_group_check
  check (study_group in ('INTERVENTION', 'HISTORICAL_CONTROL'));

comment on column public.patients.study_group is
  'Coorte do estudo (protocolo 5.10): INTERVENTION (monitoramento remoto, via app) ou HISTORICAL_CONTROL (retrospectivo, fora do app — marcado manualmente para fins de export/comparação).';

-- ----------------------------------------------------------------------------
-- 2) Avaliação em 30 dias (5.8).
-- ----------------------------------------------------------------------------
create table if not exists public.patient_day30_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  performed_by uuid references auth.users(id),
  performed_at timestamptz not null default now(),

  -- Desfechos (5.8).
  sought_er boolean,               -- Procurou pronto atendimento?
  readmitted boolean,              -- Foi reinternado?
  unplanned_visit boolean,         -- Avaliação médica não programada?
  persistent_symptoms boolean,     -- Persistência de sintomas?
  outcomes_notes text,             -- Observações livres sobre os desfechos.

  -- Satisfação (escala Likert 1-5 — ver comentário no topo da migration).
  satisfaction_safety int,
  satisfaction_ease int,
  satisfaction_communication int,
  satisfaction_overall int,
  satisfaction_comment text,       -- Campo aberto.

  created_at timestamptz not null default now()
);

alter table public.patient_day30_assessments drop constraint if exists day30_satisfaction_range_check;
alter table public.patient_day30_assessments add constraint day30_satisfaction_range_check check (
  (satisfaction_safety is null or satisfaction_safety between 1 and 5) and
  (satisfaction_ease is null or satisfaction_ease between 1 and 5) and
  (satisfaction_communication is null or satisfaction_communication between 1 and 5) and
  (satisfaction_overall is null or satisfaction_overall between 1 and 5)
);

comment on table public.patient_day30_assessments is
  'Contato telefônico de 30 dias pós-alta (protocolo 5.8): desfechos clínicos + satisfação do paciente. Um paciente pode ter mais de um registro (reagendamento/tentativas).';

create index if not exists idx_day30_patient on public.patient_day30_assessments(patient_id, performed_at desc);

alter table public.patient_day30_assessments enable row level security;

-- RLS espelha patient_followups (0050): is_admin() OR is_team_member(equipe do paciente).
drop policy if exists day30_select on public.patient_day30_assessments;
create policy day30_select on public.patient_day30_assessments for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
  );

drop policy if exists day30_insert on public.patient_day30_assessments;
create policy day30_insert on public.patient_day30_assessments for insert to authenticated
  with check (
    performed_by = auth.uid()
    and (
      public.is_admin()
      or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    )
  );
