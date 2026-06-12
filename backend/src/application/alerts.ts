import { ClinicalStatus } from '@vitalsync/shared';
import type { AlertRepository, UserRepository } from '../domain/repositories.js';
import type { AuditLogger, NotificationGateway } from './ports.js';

/**
 * Geração e envio de alertas clínicos (use case "Gerar alerta" + "Enviar WhatsApp").
 * O canal de notificação é injetado (NotificationGateway) — trocar de provedor
 * não afeta esta regra. Status verde NÃO gera alerta.
 */
export class AlertDispatcher {
  constructor(
    private readonly users: UserRepository,
    private readonly alerts: AlertRepository,
    private readonly gateway: NotificationGateway,
    private readonly audit: AuditLogger,
  ) {}

  async dispatch(input: {
    patientId: string;
    patientName: string;
    teamId: string;
    vitalSignRecordId: string;
    status: ClinicalStatus;
  }): Promise<void> {
    if (input.status === ClinicalStatus.GREEN) return; // sem alerta para verde

    const label = input.status === ClinicalStatus.RED ? 'Vermelho' : 'Amarelo';
    const body = `⚠️ Atenção! Alerta ${label}. Paciente: ${input.patientName}. Verifique no VitalSync.`;

    // Notifica TODOS os médicos da equipe (cirurgião responsável + associados).
    const members = await this.users.findTeamMembers(input.teamId);
    const recipients: Array<{ userId: string; channel: string; deliveryStatus: string; detail?: string }> = [];

    for (const member of members) {
      if (!member.whatsapp) {
        recipients.push({
          userId: member.id,
          channel: this.gateway.channel,
          deliveryStatus: 'failed',
          detail: 'Sem WhatsApp cadastrado',
        });
        continue;
      }
      const result = await this.gateway.send({ to: member.whatsapp, body });
      recipients.push({
        userId: member.id,
        channel: result.channel,
        deliveryStatus: result.deliveryStatus,
        detail: result.detail,
      });
    }

    const alert = await this.alerts.create({
      patientId: input.patientId,
      vitalSignRecordId: input.vitalSignRecordId,
      status: input.status,
      message: body,
      recipients,
    });

    await this.audit.log({
      action: 'ALERT_SENT',
      entityType: 'ClinicalAlert',
      entityId: alert.id,
      metadata: { patientId: input.patientId, status: input.status, recipients: recipients.length },
    });
  }
}
