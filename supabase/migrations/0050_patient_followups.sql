-- ============================================================================
-- VitalSync — Atendimento a cada 48h: registro manual do resultado (piloto,
-- ago/2026). Fase 5.1 do ajuste (5.2 — lembrete automático — fica para depois,
-- ver nota no rodapé).
--
-- Nova tabela `patient_followups`: cada linha é um contato de acompanhamento
-- registrado manualmente pela equipe (data/hora, quem fez, resultado em texto
-- livre). É um LOG append-only — sem edição/exclusão pelo frontend.
--
-- RLS espelha `attendance_confirmations` (0001/0024): is_admin() OR
-- is_team_member(patient.team_id), tanto para leitura quanto para inserir.
-- Sem policy de update/delete — histórico imutável.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0049.
-- ============================================================================

create table if not exists public.patient_followups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  performed_by uuid references auth.users(id),
  result text not null,
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.patient_followups is
  'Registro manual de atendimento periódico (a cada 48h) durante o monitoramento pós-operatório: quem fez, quando e o resultado (texto livre).';

create index if not exists idx_patient_followups_patient on public.patient_followups(patient_id, performed_at desc);

alter table public.patient_followups enable row level security;

drop policy if exists patient_followups_select on public.patient_followups;
create policy patient_followups_select on public.patient_followups for select to authenticated
  using (
    public.is_admin()
    or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
  );

drop policy if exists patient_followups_insert on public.patient_followups;
create policy patient_followups_insert on public.patient_followups for insert to authenticated
  with check (
    performed_by = auth.uid()
    and (
      public.is_admin()
      or public.is_team_member((select team_id from public.patients p where p.id = patient_id))
    )
  );

-- ----------------------------------------------------------------------------
-- Fase 5.2 (lembrete automático a cada 48h) NÃO está nesta migration — depende
-- de decisão do dono sobre canal (WhatsApp para a equipe? item pendente na
-- tela?) e âncora da contagem (a partir da alta? do último atendimento
-- registrado?). O padrão a espelhar quando definido é o de
-- `0038_lembrete_medicao.sql` + `supabase/functions/send-measurement-reminder`.
-- ----------------------------------------------------------------------------
