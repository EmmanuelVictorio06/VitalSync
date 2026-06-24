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
};
