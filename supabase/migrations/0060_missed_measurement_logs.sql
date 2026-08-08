-- ============================================================================
-- Migration: 0060_missed_measurement_logs
--
-- Alerta OPERACIONAL (não clínico) para a equipe quando o paciente não
-- registrou um período depois que a janela de medição fechou (Manhã
-- 08:00-10:00 / Noite 18:00-20:00, America/Sao_Paulo). Complementa o lembrete
-- ao PACIENTE (0038/reminder_logs) com um segundo aviso, à EQUIPE, priorizando
-- o Profissional de Enfermagem.
--
-- Por que uma tabela NOVA em vez de reaproveitar reminder_logs ou
-- clinical_alerts:
--   • reminder_logs é modelada para 1 destinatário por paciente/período/dia
--     (o próprio paciente) — aqui pode haver VÁRIOS destinatários (um ou mais
--     enfermeiros da equipe, ou toda a equipe em fallback), então a
--     unicidade precisa incluir recipient_profile_id.
--   • clinical_alerts representa um status clínico GREEN/YELLOW/RED avaliado
--     por eval_clinical_status; "esquecimento" não é um status clínico —
--     misturar os dois poluiria a semântica de atendimento/lock (0044/0045)
--     que já existe para alertas clínicos de verdade.
--
-- O restante do desenho (channel/status/environment/is_test, gate de
-- homologação) espelha reminder_logs/notification_logs de propósito, para
-- reaproveitar o mesmo modo de homologação (0018) e o mesmo formato que as
-- Edge Functions de WhatsApp já usam.
--
-- resolved_at/resolved_by são preenchidos por staff_insert_vital_record
-- (0062) quando a equipe lança a medição faltante — encerra o "esquecimento"
-- independentemente de quantos destinatários foram notificados.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0059.
-- ============================================================================

create table if not exists public.missed_measurement_logs (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(id) on delete cascade,
  team_id              uuid references public.medical_teams(id) on delete set null,
  period               public.measurement_period not null,
  missed_date          date not null default current_date,
  recipient_profile_id uuid not null references public.profiles(id),
  recipient_name       text,
  recipient_phone      text,
  recipient_is_nurse   boolean not null default false,
  channel              text not null default 'whatsapp',
  status               text not null default 'PENDING',
  template_name        text,
  environment          text not null default 'production',
  is_test              boolean not null default false,
  provider_message_id  text,
  error_message        text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  resolved_at          timestamptz,
  resolved_by          uuid references public.profiles(id),
  unique (patient_id, period, missed_date, recipient_profile_id)
);

comment on column public.missed_measurement_logs.recipient_is_nurse is
  'true quando o destinatário foi escolhido pela prioridade de enfermagem; false quando veio do fallback (demais membros ativos da equipe).';
comment on column public.missed_measurement_logs.resolved_at is
  'Preenchido quando a equipe registra a medição faltante (staff_insert_vital_record) — encerra o esquecimento para TODOS os destinatários daquele patient_id/period/missed_date.';

create index if not exists idx_missed_measurement_logs_patient on public.missed_measurement_logs(patient_id);
create index if not exists idx_missed_measurement_logs_team_status on public.missed_measurement_logs(team_id, status);
create index if not exists idx_missed_measurement_logs_status on public.missed_measurement_logs(status);
create index if not exists idx_missed_measurement_logs_unresolved
  on public.missed_measurement_logs(patient_id, missed_date) where resolved_at is null;

alter table public.missed_measurement_logs enable row level security;

-- Diferente de reminder_logs (só ADMIN lê): aqui a própria equipe precisa
-- enxergar o esquecimento (badge/banner in-app), então a leitura segue o
-- mesmo escopo de is_team_member() já usado em clinical_alerts/patients.
drop policy if exists missed_measurement_logs_select on public.missed_measurement_logs;
create policy missed_measurement_logs_select on public.missed_measurement_logs for select to authenticated
  using (public.is_admin() or public.is_team_member(team_id));

-- Sem policy de INSERT/UPDATE para authenticated: escrita só via funções
-- SECURITY DEFINER (enqueue_missed_measurement_alerts, staff_insert_vital_record)
-- ou pela Edge Function (service_role), mesmo padrão de reminder_logs.
