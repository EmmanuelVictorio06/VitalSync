/**
 * Regras puras da fila de triagem de enfermagem (migrations 0063–0069).
 *
 * Tudo aqui é DERIVAÇÃO PARA A UI: quem é o dono preferencial, quanto falta da
 * oferta, o que já está atrasado. As garantias reais (claim atômico, escopo do
 * pool, bloqueio de vermelho) vivem no banco — estas funções nunca decidem
 * permissão, só o que a tela mostra.
 */

/** Estado de um alerta amarelo do ponto de vista de UM enfermeiro. */
export type QueueBucket =
  /** Oferecido a mim, dentro da janela — tenho preferência. */
  | 'OFFERED_TO_ME'
  /** Sem dono, ou com oferta vencida: qualquer um do pool assume. */
  | 'OPEN'
  /** Oferecido a outro, janela ainda correndo — visível, mas esmaecido. */
  | 'OFFERED_TO_OTHER'
  /** Já travei para atender e preciso concluir. */
  | 'MINE_IN_ANALYSIS'
  /** Travado por outro profissional. */
  | 'LOCKED_BY_OTHER';

/** Campos que a classificação da fila precisa (compatível com `AlertRow`). */
export interface TriageAlertLike {
  status: string;
  attendance_status: string;
  attended: boolean;
  assigned_nurse_id: string | null;
  offer_expires_at: string | null;
  in_analysis_by: string | null;
  escalated_at: string | null;
  created_at: string;
  sla_breached_at?: string | null;
}

/** true quando a janela da oferta já venceu (ou nem existe). */
export function isOfferExpired(offerExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!offerExpiresAt) return true;
  return new Date(offerExpiresAt).getTime() <= now.getTime();
}

export interface OfferCountdown {
  secondsRemaining: number;
  expired: boolean;
  /** "mm:ss" enquanto corre; "expirada" depois. */
  label: string;
}

/** Contagem regressiva da oferta, para o "aguardando Fulano — 4:12". */
export function offerCountdown(offerExpiresAt: string | null, now: Date = new Date()): OfferCountdown {
  if (!offerExpiresAt) return { secondsRemaining: 0, expired: true, label: 'expirada' };
  const seconds = Math.floor((new Date(offerExpiresAt).getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return { secondsRemaining: 0, expired: true, label: 'expirada' };
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return { secondsRemaining: seconds, expired: false, label: `${mm}:${String(ss).padStart(2, '0')}` };
}

/**
 * Em qual bloco da fila o alerta cai para este enfermeiro.
 *
 * A ordem das checagens importa: o LOCK (estou atendendo) manda mais que a
 * ATRIBUIÇÃO (é meu para triar), porque atribuição é preferência e lock é
 * exclusividade — ver comentário da migration 0065.
 */
export function classifyQueueItem(
  alert: TriageAlertLike,
  myProfileId: string | null,
  now: Date = new Date(),
): QueueBucket | null {
  // Finalizados e escalados saem da fila da enfermagem.
  if (alert.attended || alert.attendance_status === 'ATTENDED' || alert.attendance_status === 'IGNORED') return null;
  if (alert.escalated_at) return null;
  if (alert.status !== 'YELLOW') return null;

  if (alert.in_analysis_by) {
    return alert.in_analysis_by === myProfileId ? 'MINE_IN_ANALYSIS' : 'LOCKED_BY_OTHER';
  }

  const expired = isOfferExpired(alert.offer_expires_at, now);
  if (!alert.assigned_nurse_id || expired) return 'OPEN';
  return alert.assigned_nurse_id === myProfileId ? 'OFFERED_TO_ME' : 'OFFERED_TO_OTHER';
}

/**
 * Ordem da fila aberta: o que já estourou o SLA primeiro, depois o mais antigo.
 * Não muta o array recebido.
 */
export function sortOpenQueue<T extends { created_at: string; sla_breached_at?: string | null }>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => {
    const aBreached = a.sla_breached_at ? 0 : 1;
    const bBreached = b.sla_breached_at ? 0 : 1;
    if (aBreached !== bBreached) return aBreached - bBreached;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/**
 * "Livre" espelha `nurse_is_free()` no banco: em plantão, não pausado e abaixo
 * do WIP. A tela usa isto só para explicar por que não está recebendo ofertas —
 * quem decide de verdade é o banco.
 */
export function isFreeToReceiveOffers(input: {
  onDuty: boolean;
  paused: boolean;
  activeLoad: number;
  wipLimit: number;
}): boolean {
  const { onDuty, paused, activeLoad, wipLimit } = input;
  return onDuty && !paused && activeLoad < wipLimit;
}

/** Explica em uma frase por que o enfermeiro não está recebendo ofertas. */
export function unavailableReason(input: {
  onDuty: boolean;
  paused: boolean;
  activeLoad: number;
  wipLimit: number;
}): string | null {
  if (!input.onDuty) return 'Você não está de plantão — abra o plantão para receber alertas.';
  if (input.paused) return 'Plantão pausado. Retome para voltar a receber alertas.';
  if (input.activeLoad >= input.wipLimit) {
    return `Você está no limite de ${input.wipLimit} alertas ativos. Conclua algum para receber novos.`;
  }
  return null;
}

/** Tamanho mínimo da justificativa de escalonamento (espelha o guard da RPC). */
export const MIN_ESCALATION_REASON = 10;

/**
 * Valida a justificativa do escalonamento. Devolve a mensagem de erro ou null.
 * O banco também recusa vazio (0064) — aqui é só para não gastar ida e volta.
 */
export function validateEscalationReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'Descreva por que este caso precisa do médico.';
  if (trimmed.length < MIN_ESCALATION_REASON) {
    return `Detalhe um pouco mais (mínimo ${MIN_ESCALATION_REASON} caracteres) — o médico vai ler isto antes de assumir.`;
  }
  return null;
}
