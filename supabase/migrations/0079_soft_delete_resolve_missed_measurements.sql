-- ============================================================================
-- Migration: 0079_soft_delete_resolve_missed_measurements
--
-- Bug: o badge "Pacientes em Monitoramento" (sidebar) usa
-- missedMeasurementService.getPendingCount(), que conta linhas de
-- missed_measurement_logs com resolved_at is null (deduplicadas por
-- patient_id/period/missed_date). soft_delete_patient (0026) já deixa
-- clinical_alerts em estado coerente ao excluir (IGNORED + attended=true),
-- mas NUNCA tocava missed_measurement_logs — como resolved_at só é
-- preenchido quando a equipe lança a medição faltante (staff_insert_vital_record,
-- 0062), um paciente excluído com esquecimento em aberto fica "PENDING" PARA
-- SEMPRE, inflando o badge mesmo depois de excluído (relatado: 2 pacientes
-- ativos, badge mostrando 20+).
--
-- Fix: soft_delete_patient passa a encerrar os esquecimentos abertos do
-- paciente, no MESMO padrão já usado por staff_insert_vital_record (0062) —
-- WhatsApp ainda PENDING vira CANCELLED, os já SENT só ganham resolved_at/by.
-- Backfill abaixo corrige o estoque já acumulado (pacientes já excluídos
-- antes desta migration).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após o 0078.
-- ============================================================================

create or replace function public.soft_delete_patient(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from public.patients where id = p_id;
  if v_team is null then
    raise exception 'Paciente não encontrado.';
  end if;
  if not (public.is_admin() or public.is_main_surgeon_of(v_team)) then
    raise exception 'Sem permissão para excluir este paciente.';
  end if;

  update public.patients
     set deleted_at = now(),
         deleted_by = auth.uid(),
         status     = 'INACTIVE'
   where id = p_id and deleted_at is null;

  -- Alertas pendentes/em análise → IGNORED e attended = true (estado coerente).
  update public.clinical_alerts
     set attendance_status = 'IGNORED',
         ignored_reason     = 'Paciente excluído do monitoramento',
         attended           = true,
         attended_by        = coalesce(attended_by, auth.uid()),
         attended_at        = coalesce(attended_at, now()),
         updated_at         = now()
   where patient_id = p_id
     and attendance_status in ('PENDING', 'IN_ANALYSIS');

  -- Esquecimentos abertos (missed_measurement_logs) nunca seriam encerrados
  -- para um paciente excluído (resolved_at só é setado quando a medição
  -- faltante é lançada) — sem isto, ficam "PENDING" para sempre e inflam o
  -- badge da sidebar (getPendingCount). Mesmo padrão de 0062.
  update public.missed_measurement_logs
     set resolved_at = now(),
         resolved_by = auth.uid(),
         status = case when status = 'PENDING' then 'CANCELLED' else status end
   where patient_id = p_id
     and resolved_at is null;
end;
$$;

grant execute on function public.soft_delete_patient(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Backfill: resolve o estoque já acumulado de esquecimentos abertos que
-- pertencem a pacientes JÁ excluídos antes desta migration existir.
-- resolved_by fica null (correção de sistema, não ação de um profissional).
-- ----------------------------------------------------------------------------
update public.missed_measurement_logs m
   set resolved_at = now(),
       status = case when m.status = 'PENDING' then 'CANCELLED' else m.status end
  from public.patients p
 where m.patient_id = p.id
   and p.deleted_at is not null
   and m.resolved_at is null;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rodar após o db push)
-- ----------------------------------------------------------------------------
-- 1) Não deve sobrar esquecimento aberto de paciente já excluído:
--    select count(*) from missed_measurement_logs m
--      join patients p on p.id = m.patient_id
--     where p.deleted_at is not null and m.resolved_at is null;
--    -- esperado: 0
--
-- 2) Contagem que alimenta o badge (getPendingCount) deve bater com o que a
--    UI mostra:
--    select count(distinct (patient_id, period, missed_date))
--      from missed_measurement_logs where resolved_at is null;
