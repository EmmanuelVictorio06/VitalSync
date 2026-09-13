/**
 * Severidade EFETIVA de um alerta e de quem é a fila — espelho no FRONT da
 * regra de roteamento da migration 0077.
 *
 * O banco nunca sobrescreve `clinical_alerts.status`: a severidade clínica é
 * imutável e alimenta as métricas do estudo (0055). Quando a enfermagem escala
 * um caso, isso é gravado numa camada separada (`escalated_at`, 0064). Por
 * isso `notify_team_of_alert` roteia pela severidade EFETIVA:
 *
 *     efetiva = RED  quando  status = 'RED'  OU  escalated_at is not null
 *     efetiva = YELLOW  caso contrário
 *
 * Até a 0077 esse conceito existia só no SQL, e a tela de Alertas continuava
 * lendo `status` cru — o médico via todo amarelo como pendência dele e o alerta
 * escalado ficava visualmente idêntico a um amarelo comum. Estas funções são a
 * fonte única da derivação no front.
 *
 * NADA aqui decide permissão: a RLS e as RPCs `security definer` continuam
 * sendo a autoridade. Isto define apenas o que a tela mostra e o que ela
 * oferece como ação.
 */
import { ClinicalStatus, Role } from '@vitalsync/shared';

/** Mesmo domínio de `ClinicalStatus` — casa direto com `StatusBadge` e afins. */
export type EffectiveSeverity = ClinicalStatus;

/** Campos necessários para derivar severidade/propriedade (compatível com `AlertRow`). */
export interface SeverityAlertLike {
  status: string;
  escalated_at: string | null;
  attendance_status: string;
  attended?: boolean;
  in_analysis_by?: string | null;
}

/** true quando a enfermagem (ou o SLA de 8h) escalou o caso para o médico. */
export function isEscalated(a: Pick<SeverityAlertLike, 'escalated_at'>): boolean {
  return a.escalated_at != null;
}

/**
 * Severidade que a UI deve usar para cor, ordenação e contagem.
 * Um amarelo escalado É vermelho para o médico, mesmo com `status = 'YELLOW'`.
 */
export function effectiveSeverity(a: Pick<SeverityAlertLike, 'status' | 'escalated_at'>): EffectiveSeverity {
  if (a.status === ClinicalStatus.RED || isEscalated(a)) return ClinicalStatus.RED;
  if (a.status === ClinicalStatus.YELLOW) return ClinicalStatus.YELLOW;
  return ClinicalStatus.GREEN;
}

/** Alerta já finalizado (atendido ou ignorado) — é histórico, não fila de ninguém. */
export function isResolvedAlert(a: Pick<SeverityAlertLike, 'attendance_status' | 'attended'>): boolean {
  return a.attendance_status === 'ATTENDED' || a.attendance_status === 'IGNORED' || a.attended === true;
}

/**
 * Papéis cuja fila acionável é a dos MÉDICOS. Para eles o amarelo não escalado
 * é evento da enfermagem (0077) e não deve aparecer como tarefa própria.
 *
 * Admin e Gerente ficam de fora de propósito: o Admin é supervisão e precisa
 * enxergar a fila inteira; o Gerente já é somente-leitura em todo o resto da
 * tela. O enfermeiro tem a fila dele no Painel de Enfermagem.
 */
export function ownsDoctorQueue(role: Role | null | undefined): boolean {
  return role === Role.SURGEON || role === Role.ASSOCIATE;
}

/**
 * Espelho no FRONT da guarda `nurse_may_finalize` (0080): a enfermagem não
 * conclui (atender/ignorar) alerta de severidade EFETIVA vermelha — vermelho no
 * banco OU já escalado ao médico. Nesses casos o caminho dela é registrar o
 * contato ativo, que não exige o lock e não fecha o alerta.
 *
 * Médicos e Admin não são afetados. A tela não é autoridade — o banco repete a
 * checagem. Isto existe para não OFERECER um botão que a RPC vai recusar e,
 * no caso do escalado, para o enfermeiro não travar um alerta que já é fila do
 * médico (o lock bloquearia a conclusão dele até o TTL ou um "Liberar").
 */
export function canFinalizeAlert(
  a: Pick<SeverityAlertLike, 'status' | 'escalated_at'>,
  role: Role | null | undefined,
): boolean {
  if (role !== Role.NURSE) return true;
  return effectiveSeverity(a) !== ClinicalStatus.RED;
}

/**
 * true = este alerta está COM A ENFERMAGEM do ponto de vista deste usuário:
 * visível, porém não acionável por ele.
 *
 * Um alerta que o próprio usuário já travou (`in_analysis_by === viewerId`)
 * continua sendo dele — é o caso de quem assumiu antes desta regra existir, e
 * tirar a ação dali deixaria o alerta preso sem ninguém para concluí-lo.
 */
export function isWithNursing(
  a: SeverityAlertLike,
  role: Role | null | undefined,
  viewerId?: string | null,
): boolean {
  if (!ownsDoctorQueue(role)) return false;
  if (isResolvedAlert(a)) return false;
  if (effectiveSeverity(a) !== ClinicalStatus.YELLOW) return false;
  if (viewerId && a.in_analysis_by === viewerId) return false;
  return true;
}
