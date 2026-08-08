/**
 * Regras derivadas da "Central de Enfermagem" (Dashboard do Profissional de
 * Enfermagem). São funções PURAS e testáveis — a busca dos dados fica em
 * `services/nurseDashboardService.ts`, e o escopo por equipe continua sendo
 * imposto pela RLS do Supabase (nunca por filtro de papel aqui).
 *
 * Datas civis (sem hora) usam o fuso da clínica via `daysSinceDischarge`/
 * `monitoringDay` do @vitalsync/shared — mesma convenção de
 * `submit_vital_record` (America/Sao_Paulo).
 */
import { daysSinceDischarge, monitoringDay, startOfToday } from '@vitalsync/shared';

/**
 * Videochamada estruturada do protocolo 5.6.5: acontece 48h após a alta. Em
 * datas civis (a convenção do projeto), 48h = 2 dias decorridos desde a alta.
 */
export const FOLLOWUP_48H_DAYS = 2;

/** Avaliação de desfechos do protocolo 5.8, no 30º dia após a alta. */
export const DAY30_DAYS = 30;

/** Últimos dias da janela de 10 dias — hora de preparar o desfecho. */
export const MONITORING_ENDING_DAYS = [9, 10] as const;

/**
 * true quando a videochamada de 48h já é devida e ainda não foi registrada.
 * `hasFollowup` vem de `patient_followups` (qualquer registro já cumpre — o
 * protocolo pede a chamada estruturada uma vez, na virada das 48h).
 */
export function needsFollowup48h(input: {
  dischargeDate: Date | null;
  hasFollowup: boolean;
  reference?: Date;
}): boolean {
  const { dischargeDate, hasFollowup, reference = startOfToday() } = input;
  if (!dischargeDate || hasFollowup) return false;
  return daysSinceDischarge(dischargeDate, reference) >= FOLLOWUP_48H_DAYS;
}

/**
 * true quando o paciente já completou 30 dias de alta e a avaliação D+30
 * (protocolo 5.8) ainda não foi registrada.
 */
export function needsDay30Assessment(input: {
  dischargeDate: Date | null;
  hasAssessment: boolean;
  reference?: Date;
}): boolean {
  const { dischargeDate, hasAssessment, reference = startOfToday() } = input;
  if (!dischargeDate || hasAssessment) return false;
  return daysSinceDischarge(dischargeDate, reference) >= DAY30_DAYS;
}

/**
 * true quando o paciente está nos dias 9–10 da janela de monitoramento — o
 * enfermeiro precisa preparar o encerramento (última coleta, orientações).
 */
export function isMonitoringEndingSoon(input: { dischargeDate: Date | null; reference?: Date }): boolean {
  const { dischargeDate, reference = startOfToday() } = input;
  if (!dischargeDate) return false;
  const day = monitoringDay(dischargeDate, reference);
  return day != null && (MONITORING_ENDING_DAYS as readonly number[]).includes(day);
}

export interface RecheckCountdown {
  /** Minutos até o prazo; negativo quando já venceu. */
  minutesRemaining: number;
  overdue: boolean;
  /** Rótulo pronto para exibição, ex.: "vence em 1h20" / "vencida há 35min". */
  label: string;
}

/** Formata uma duração em minutos como "45min" ou "2h05". */
function humanizeMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, totalMinutes);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}

/**
 * Contagem regressiva da reaferição de 2h (protocolo 5.7.2). `dueAt` é o
 * `clinical_alerts.recheck_due_at`; vencidas aparecem em destaque na fila.
 */
export function recheckCountdown(dueAt: string | Date, now: Date = new Date()): RecheckCountdown {
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const minutesRemaining = Math.round((due.getTime() - now.getTime()) / 60_000);
  const overdue = minutesRemaining < 0;
  return {
    minutesRemaining,
    overdue,
    label: overdue ? `vencida há ${humanizeMinutes(-minutesRemaining)}` : `vence em ${humanizeMinutes(minutesRemaining)}`,
  };
}

/** Item mínimo que a fila de triagem sabe ordenar (compatível com `AlertRow`). */
export interface TriageSortable {
  status: string;
  created_at: string;
}

/**
 * Ordem da fila de triagem: vermelho antes de amarelo e, dentro da mesma
 * severidade, o mais antigo primeiro (quem espera há mais tempo é atendido
 * antes). Não muta o array recebido.
 */
export function sortTriageQueue<T extends TriageSortable>(alerts: T[]): T[] {
  const severity = (s: string) => (s === 'RED' ? 0 : s === 'YELLOW' ? 1 : 2);
  return [...alerts].sort((a, b) => {
    const bySeverity = severity(a.status) - severity(b.status);
    if (bySeverity !== 0) return bySeverity;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/** Tempo em aberto de um alerta, para a coluna "há quanto tempo espera". */
export function openForLabel(createdAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes}min`;
  const days = Math.floor(minutes / 1440);
  if (days >= 1) return `há ${days}d`;
  return `há ${humanizeMinutes(minutes)}`;
}
