import type { AuditLogger } from '../../application/ports.js';
import { prisma } from '../prisma/client.js';

/** Trilha de auditoria persistida (LGPD: rastreabilidade das ações). */
export class PrismaAuditLogger implements AuditLogger {
  async log(entry: {
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: (entry.metadata ?? undefined) as object | undefined,
          ip: entry.ip,
        },
      });
    } catch (err) {
      // Auditoria nunca deve derrubar a operação principal.
      console.error('[audit] falha ao registrar log:', err);
    }
  }
}
