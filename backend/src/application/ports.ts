/**
 * Portas de serviços (application boundary). As use cases dependem destas
 * interfaces; as implementações concretas vivem na infraestrutura.
 */
import type { AuthenticatedUser } from '../domain/entities.js';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export interface TokenService {
  sign(payload: AuthenticatedUser): string;
  verify(token: string): AuthenticatedUser;
}

/** Geração e verificação do token do link do paciente (somente hash é persistido). */
export interface LinkTokenService {
  /** Gera um token aleatório forte e seu hash (o cru vai só na URL). */
  generate(): { raw: string; hash: string };
  hash(raw: string): string;
}

/** Mensagem a enviar por um canal de notificação (hoje WhatsApp). */
export interface NotificationMessage {
  to: string; // número (somente dígitos, com DDI)
  body: string;
}

export interface NotificationResult {
  channel: string;
  deliveryStatus: 'sent' | 'failed' | 'logged';
  detail?: string;
}

/**
 * Gateway de notificação desacoplado. Trocar de provedor (Twilio, Meta, etc.)
 * = trocar a implementação, sem alterar as use cases.
 */
export interface NotificationGateway {
  readonly channel: string;
  send(message: NotificationMessage): Promise<NotificationResult>;
}

export interface AuditLogger {
  log(entry: {
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void>;
}

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

import type { ExportRow } from '../domain/repositories.js';

export interface ExportService {
  build(rows: ExportRow[], format: ExportFormat): Promise<ExportFile>;
}

/** Contexto de auditoria de uma requisição (quem + de onde). */
export interface RequestContext {
  user?: AuthenticatedUser;
  ip?: string;
}
