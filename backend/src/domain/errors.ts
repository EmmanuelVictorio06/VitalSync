/**
 * Erros de domínio — independentes de HTTP/framework.
 * A camada de interface (HTTP) os traduz para status codes e mensagens claras.
 */

export type DomainErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    /** Mensagem amigável (sem termos técnicos) para exibir ao usuário final. */
    public readonly userMessage: string = message,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(userMessage: string, details?: unknown) {
    super('VALIDATION', userMessage, userMessage, details);
  }
}
export class UnauthorizedError extends DomainError {
  constructor(userMessage = 'E-mail ou senha incorretos.') {
    super('UNAUTHORIZED', userMessage);
  }
}
export class ForbiddenError extends DomainError {
  constructor(userMessage = 'Você não tem permissão para acessar este recurso.') {
    super('FORBIDDEN', userMessage);
  }
}
export class NotFoundError extends DomainError {
  constructor(userMessage = 'Registro não encontrado.') {
    super('NOT_FOUND', userMessage);
  }
}
export class ConflictError extends DomainError {
  constructor(userMessage: string) {
    super('CONFLICT', userMessage);
  }
}
