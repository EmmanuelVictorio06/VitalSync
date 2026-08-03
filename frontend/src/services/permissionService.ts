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

  /** Perfil de Suporte (operacional, não clínico). */
  isSupport(user: AuthUser | null | undefined): boolean {
    return user?.role === Role.SUPPORT;
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
    return !!user && ([Role.ADM, Role.SURGEON, Role.ASSOCIATE, Role.SUPPORT, Role.MANAGER, Role.NURSE] as Role[]).includes(user.role);
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

  /** "Gerenciar Usuários": exclusivo do Administrador. */
  canManageUsers(user: AuthUser | null | undefined): boolean {
    return this.isAdmin(user);
  },

  /** Alterar o papel/perfil de um usuário — ação sensível, só Admin. */
  canChangeUserRole(user: AuthUser | null | undefined): boolean {
    return this.isAdmin(user);
  },

  /** Ativar/inativar um usuário — só Admin. */
  canDeactivateUser(user: AuthUser | null | undefined): boolean {
    return this.isAdmin(user);
  },

  /* ------------------------------- Alertas -------------------------------- */

  /**
   * Ver a aba Alertas: Admin, Cirurgião Principal, Médico Associado e Gerente
   * de Equipe (este último em modo somente-leitura — ver canAttendAlerts).
   */
  canViewAlerts(user: AuthUser | null | undefined): boolean {
    return !!user && ([Role.ADM, Role.SURGEON, Role.ASSOCIATE, Role.MANAGER, Role.NURSE] as Role[]).includes(user.role);
  },

  /**
   * Realizar atendimento clínico (em análise / atendido / ignorado): apenas
   * profissionais clínicos — inclui o Profissional de Enfermagem, triador
   * primário do protocolo do estudo. O Admin NÃO substitui a responsabilidade
   * clínica da equipe (vê tudo, mas não conclui o atendimento) e o Gerente de
   * Equipe também não — ele só acompanha (somente-leitura).
   */
  canAttendAlerts(user: AuthUser | null | undefined): boolean {
    return user?.role === Role.SURGEON || user?.role === Role.ASSOCIATE || user?.role === Role.NURSE;
  },

  /** Reenviar a notificação à equipe: Admin e Cirurgião Principal. */
  canResendAlertNotification(user: AuthUser | null | undefined): boolean {
    return user?.role === Role.ADM || user?.role === Role.SURGEON;
  },
};
