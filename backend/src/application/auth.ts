import { Role } from '@vitalsync/shared';
import type { AuthenticatedUser } from '../domain/entities.js';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.js';
import type { UserRepository } from '../domain/repositories.js';
import type { AuditLogger, PasswordHasher, TokenService } from './ports.js';

/**
 * Regras de autorização reutilizáveis (serviço de autorização).
 * Centraliza "quem pode ver o quê" — validado SEMPRE no backend.
 */
export const AccessControl = {
  /** Escopo de equipe aplicado às consultas. ADM = sem restrição (undefined). */
  teamScope(user: AuthenticatedUser): string | undefined {
    return user.role === Role.ADM ? undefined : user.teamId ?? '__none__';
  },

  /** Garante que o usuário pode acessar um paciente de determinada equipe. */
  assertCanAccessTeam(user: AuthenticatedUser, teamId: string): void {
    if (user.role === Role.ADM) return;
    if (user.teamId && user.teamId === teamId) return;
    throw new ForbiddenError('Este paciente pertence a outra equipe.');
  },

  /** Menu "Gerenciar Equipes": somente ADM e cirurgião responsável. */
  assertCanManageTeams(user: AuthenticatedUser): void {
    if (user.role === Role.ADM || user.role === Role.SURGEON) return;
    throw new ForbiddenError('Apenas administradores e cirurgiões responsáveis podem gerenciar equipes.');
  },

  /** Gestão de uma equipe específica: ADM (qualquer) ou cirurgião da própria equipe. */
  assertCanManageTeam(user: AuthenticatedUser, teamId: string): void {
    if (user.role === Role.ADM) return;
    if (user.role === Role.SURGEON && user.teamId === teamId) return;
    throw new ForbiddenError('Você só pode gerenciar a sua própria equipe.');
  },

  assertIsAdmin(user: AuthenticatedUser): void {
    if (user.role !== Role.ADM) {
      throw new ForbiddenError('Apenas administradores podem executar esta ação.');
    }
  },
};

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: { email: string; password: string; ip?: string }): Promise<{
    token: string;
    user: AuthenticatedUser;
  }> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());
    // Mesma mensagem genérica para usuário inexistente ou senha errada (anti-enumeração).
    if (!user || !user.isActive) throw new UnauthorizedError();

    const ok = await this.hasher.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedError();

    const authUser: AuthenticatedUser = {
      id: user.id,
      role: user.role,
      teamId: user.teamId,
      name: user.name,
    };
    const token = this.tokens.sign(authUser);

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ip: input.ip,
    });

    return { token, user: authUser };
  }
}
