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

/** Foto recebida do paciente (já em memória), antes de ser persistida. */
export interface IncomingPhoto {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Metadados de uma foto já armazenada com segurança. */
export interface StoredPhoto {
  /** Caminho da rota protegida (relativo a /api) usado pelo frontend. */
  url: string;
  /** Caminho físico no armazenamento — nunca exposto ao cliente. */
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

/**
 * Armazenamento de fotos sensíveis (ferida/dreno). Desacoplado da infraestrutura:
 * hoje grava em disco local; trocar por S3/GCS = nova implementação, sem tocar
 * nas use cases. O arquivo nunca é exposto em URL pública.
 */
export interface PhotoStorageService {
  save(input: { patientId: string; recordId: string; photo: IncomingPhoto }): Promise<StoredPhoto>;
  read(storagePath: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
  delete(storagePath: string): Promise<void>;
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
