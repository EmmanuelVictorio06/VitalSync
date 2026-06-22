/**
 * Regras de permissão da interface.
 *
 * O backend SEMPRE revalida (ex.: /api/export exige Role.ADM); aqui apenas
 * controlamos o que cada perfil enxerga. Centralizado para manutenção única.
 */
import { Role } from '@vitalsync/shared';

/**
 * Cirurgiões principais só acessam a Administração se autorizados
 * explicitamente. Quando o backend expuser essa autorização (ex.: flag no
 * usuário ou em /api/admin/settings), basta passá-la aqui.
 */
const SURGEON_ADMIN_ACCESS = false;

/** Seção Administração: Hospitais, Tipos de Cirurgia, Exportações, Configurações. */
export function canAccessAdmin(role: Role | undefined): boolean {
  if (role === Role.ADM) return true;
  if (role === Role.SURGEON) return SURGEON_ADMIN_ACCESS;
  return false;
}

/** Papéis aceitos nas rotas administrativas (espelha canAccessAdmin). */
export function adminRoles(): Role[] {
  return SURGEON_ADMIN_ACCESS ? [Role.ADM, Role.SURGEON] : [Role.ADM];
}

/** Exportações gerais do sistema: somente o Administrador. */
export function canExportData(role: Role | undefined): boolean {
  return role === Role.ADM;
}

/** Gestão de equipes: ADM (todas) e cirurgião principal (a própria). */
export function canManageTeams(role: Role | undefined): boolean {
  return role === Role.ADM || role === Role.SURGEON;
}
