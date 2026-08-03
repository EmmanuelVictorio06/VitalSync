/**
 * Tempo de resposta do alerta (protocolo do estudo, 5.6.6/5.6.7/5.11) —
 * funções puras compartilhadas entre "Detalhes do Alerta" e "Detalhes do
 * Atendimento". Metas: vermelho → imediato (0 min); amarelo → 30 min.
 */
import type { ClinicalStatus } from '@vitalsync/shared';

export interface SlaTimestamps {
  createdAt: string;
  inAnalysisAt?: string | null;
  attendedAt?: string | null;
}

/** Primeira ação da equipe (o que vier primeiro: travar para análise ou atender/ignorar). */
export function firstActionAt(t: SlaTimestamps): string | null {
  const candidates = [t.inAnalysisAt, t.attendedAt].filter((v): v is string => !!v);
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, cur) => (new Date(cur) < new Date(earliest) ? cur : earliest));
}

/** Minutos entre a criação do alerta e a primeira ação. Null se ainda sem ação. */
export function responseMinutes(t: SlaTimestamps): number | null {
  const first = firstActionAt(t);
  if (!first) return null;
  const ms = new Date(first).getTime() - new Date(t.createdAt).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/** Meta de tempo de resposta (minutos) por severidade — vermelho é imediato. */
export function slaTargetMinutes(status: ClinicalStatus): number {
  return status === 'RED' ? 0 : 30;
}

/** true quando a resposta (ou a demora até agora, se ainda pendente) já estourou a meta. */
export function isSlaBreached(t: SlaTimestamps, status: ClinicalStatus): boolean {
  const target = slaTargetMinutes(status);
  const elapsed = responseMinutes(t) ?? Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60000);
  return elapsed > target;
}

/** Rótulo curto e humano para exibir no drawer. */
export function slaLabel(t: SlaTimestamps, status: ClinicalStatus): string {
  const target = slaTargetMinutes(status);
  const targetLabel = target === 0 ? 'imediato' : `${target} min`;
  const minutes = responseMinutes(t);
  if (minutes == null) {
    const pendingMin = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60000);
    const breached = pendingMin > target;
    return `Sem ação ainda — ${pendingMin} min desde o alerta (meta: ${targetLabel})${breached ? ' · FORA DA META' : ''}`;
  }
  const breached = minutes > target;
  return `Respondido em ${minutes} min (meta: ${targetLabel})${breached ? ' · fora da meta' : ' · dentro da meta'}`;
}
