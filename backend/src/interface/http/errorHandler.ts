import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors.js';

const CODE_TO_STATUS: Record<string, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

/**
 * Handler central de erros: traduz erros de domínio/validação para respostas
 * HTTP com mensagens claras e SEM termos técnicos (heurística de Nielsen).
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof DomainError) {
    reply.status(CODE_TO_STATUS[error.code] ?? 400).send({
      error: error.code,
      message: error.userMessage,
      details: error.details,
    });
    return;
  }

  if (error instanceof ZodError) {
    const first = error.issues[0];
    reply.status(400).send({
      error: 'VALIDATION',
      message: first ? `${first.path.join('.')}: ${first.message}` : 'Dados inválidos.',
      details: error.flatten().fieldErrors,
    });
    return;
  }

  // Erros de unicidade do Prisma (P2002) — mensagem amigável.
  if ((error as { code?: string }).code === 'P2002') {
    reply.status(409).send({ error: 'CONFLICT', message: 'Já existe um registro com estes dados.' });
    return;
  }

  if (error.validation) {
    reply.status(400).send({ error: 'VALIDATION', message: 'Verifique os campos enviados.' });
    return;
  }

  request.log.error(error);
  reply.status(500).send({ error: 'INTERNAL', message: 'Ocorreu um erro inesperado. Tente novamente.' });
}
