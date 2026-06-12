import 'fastify';
import type { AuthenticatedUser } from '../../domain/entities.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuário autenticado, preenchido pelo preHandler de autenticação. */
    authUser?: AuthenticatedUser;
  }
}
