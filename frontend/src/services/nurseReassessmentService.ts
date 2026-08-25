/**
 * Reavaliação de enfermagem em 2h (migration 0078).
 *
 * Depois de atender um alerta AMARELO, a enfermagem precisa recontatar o
 * paciente dentro do prazo (`app_settings.nursing.reassessmentMinutes`, default
 * 120) e registrar se melhorou, manteve ou piorou.
 *
 * Toda escrita passa por RPC `security definer` — o front nunca faz `update`
 * direto em `nurse_reassessments` (não existe policy de escrita). A leitura vai
 * por RPC também, para a mesma guarda de escopo valer na tela e na fila.
 */
import { supabase } from '../lib/supabase';

export type ReassessmentStatus = 'PENDING' | 'DONE' | 'CANCELLED';
export type ReassessmentOutcome = 'IMPROVED' | 'UNCHANGED' | 'WORSENED';

export interface NurseReassessment {
  id: string;
  alert_id: string;
  patient_id: string;
  team_id: string | null;
  scheduled_by: string | null;
  due_at: string;
  status: ReassessmentStatus;
  outcome: ReassessmentOutcome | null;
  observation: string | null;
  performed_by: string | null;
  performed_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

/** Linha da fila da enfermagem (pendentes de todos os pacientes visíveis). */
export interface DueReassessment {
  id: string;
  alert_id: string;
  patient_id: string;
  patient_name: string;
  team_id: string | null;
  due_at: string;
  overdue: boolean;
  scheduled_by_name: string | null;
}

export const OUTCOME_LABEL: Record<ReassessmentOutcome, string> = {
  IMPROVED: 'Melhorou',
  UNCHANGED: 'Mantém',
  WORSENED: 'Piorou',
};

/**
 * Quanto falta (ou há quanto tempo passou) do prazo, em minutos.
 * Negativo = atrasada. Puro para poder ser testado.
 */
export function minutesUntil(dueAtIso: string, now: Date = new Date()): number {
  return Math.round((new Date(dueAtIso).getTime() - now.getTime()) / 60000);
}

/** "em 1h20", "em 15 min", "atrasada há 40 min", "atrasada há 2h05". */
export function dueLabel(dueAtIso: string, now: Date = new Date()): string {
  const m = minutesUntil(dueAtIso, now);
  const atrasada = m < 0;
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  const quanto = h > 0 ? `${h}h${String(min).padStart(2, '0')}` : `${min} min`;
  if (abs === 0) return 'agora';
  return atrasada ? `atrasada há ${quanto}` : `em ${quanto}`;
}

export const nurseReassessmentService = {
  /** Reavaliações de um paciente (todas, para montar histórico + pendência). */
  async listByPatient(patientId: string): Promise<NurseReassessment[]> {
    const { data, error } = await supabase.rpc('nurse_reassessments_for_patient', { p_patient: patientId });
    if (error) throw new Error(error.message);
    return (data as NurseReassessment[]) ?? [];
  },

  /** Fila: pendentes visíveis ao usuário, mais atrasadas primeiro. */
  async listDue(): Promise<DueReassessment[]> {
    const { data, error } = await supabase.rpc('nurse_reassessments_due');
    if (error) throw new Error(error.message);
    return (data as DueReassessment[]) ?? [];
  },

  /**
   * Registra o desfecho. Devolve `shouldEscalate` = o banco julgou que ainda
   * faz sentido oferecer a escalada (piorou + alerta amarelo não escalado).
   * A escalada em si continua sendo um segundo ato explícito.
   */
  async complete(
    id: string,
    outcome: ReassessmentOutcome,
    observation: string,
  ): Promise<{ shouldEscalate: boolean; alertId: string | null }> {
    const { data, error } = await supabase.rpc('nurse_reassessment_complete', {
      p_id: id,
      p_outcome: outcome,
      p_observation: observation,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { should_escalate: boolean; alert_id: string }
      | undefined;
    return { shouldEscalate: Boolean(row?.should_escalate), alertId: row?.alert_id ?? null };
  },

  /**
   * Escala para o médico a partir da reavaliação "piorou". Reabre o alerta
   * (que estava atendido) e delega a `alert_escalate_to_red` — ver 0078 §5b.
   */
  async escalate(id: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('nurse_reassessment_escalate', { p_id: id, p_reason: reason });
    if (error) throw new Error(error.message);
  },

  /** Adia o recontato (paciente não atendeu), mantendo a pendência viva. */
  async postpone(id: string, minutes: number, reason: string): Promise<string> {
    const { data, error } = await supabase.rpc('nurse_reassessment_postpone', {
      p_id: id,
      p_minutes: minutes,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },
};
