/**
 * Regras de permissão aplicadas sobre o USUÁRIO autenticado (camada de UI).
 *
 * Reaproveita lib/permissions (regras por papel) expondo uma API orientada ao
 * objeto `user`, como pedido pela feature de Gerenciar Equipes. O backend
 * (RLS/SECURITY DEFINER) SEMPRE revalida: aqui só controlamos o que aparece.
 */
import { Role } from '@vitalsync/shared';
import type { AuthUser } from '../lib/dto';
import { canManageTeams as canManageTeamsByRole } from '../lib/permissions';

export const permissionService = {
  /** Administrador do sistema. */
  isAdmin(user: AuthUser | null | undefined): boolean {
    return user?.role === Role.ADM;
  },

  /** Pode gerenciar equipes (criar/editar/inativar/excluir) — só Admin. */
  canManageTeams(user: AuthUser | null | undefined): boolean {
    return canManageTeamsByRole(user?.role);
  },

  /**
   * "Meu Perfil": disponível a qualquer usuário autenticado do painel (ADMIN,
   * cirurgião e associado). O paciente não tem login — não chega aqui.
   */
  canAccessMyProfile(user: AuthUser | null | undefined): boolean {
    return !!user && [Role.ADM, Role.SURGEON, Role.ASSOCIATE].includes(user.role);
  },

  /** Pode editar o próprio perfil (mesma regra do acesso). */
  canEditOwnProfile(user: AuthUser | null | undefined): boolean {
    return this.canAccessMyProfile(user);
  },

  /** Pode solicitar a desativação da própria conta (a aprovação é do ADMIN). */
  canRequestAccountDeactivation(user: AuthUser | null | undefined): boolean {
    return this.canAccessMyProfile(user);
  },

  /** Só médicos (cirurgião/associado) veem a seção "Minhas equipes" no perfil. */
  canSeeOwnTeams(user: AuthUser | null | undefined): boolean {
    return user?.role === Role.SURGEON || user?.role === Role.ASSOCIATE;
  },
};
