import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@vitalsync/shared';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors.js';
import type { Container } from '../../container.js';

/**
 * preHandler de autenticação: valida o JWT do header Authorization e popula
 * request.authUser. A autorização fina (por equipe) é feita nas use cases.
 */
export function authenticate(container: Container) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Faça login para continuar.');
    }
    request.authUser = container.auth.tokens.verify(header.slice(7));
  };
}

/** preHandler de RBAC grosso por perfil (defesa em profundidade). */
export function requireRoles(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.authUser) throw new UnauthorizedError('Faça login para continuar.');
    if (!roles.includes(request.authUser.role)) {
      throw new ForbiddenError('Você não tem permissão para acessar este recurso.');
    }
  };
}

/** Garante e retorna o usuário autenticado (uso interno nos handlers). */
export function getUser(request: FastifyRequest) {
  if (!request.authUser) throw new UnauthorizedError('Faça login para continuar.');
  return request.authUser;
}

export function clientIp(request: FastifyRequest): string | undefined {
  return request.ip;
}
