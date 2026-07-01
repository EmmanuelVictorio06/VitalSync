/**
 * De-para ÚNICO de papéis (D-04).
 *
 * O banco usa profiles.role (ADMIN/MAIN_SURGEON/ASSOCIATED_DOCTOR/SUPPORT) e o
 * app usa o enum Role (ADM/SURGEON/ASSOCIATE/SUPPORT). Antes esse mapeamento e
 * os rótulos PT-BR estavam duplicados em AuthContext, MyProfilePage, profile e
 * exportService. Centralizado aqui para manutenção única.
 */
import { Role } from '@vitalsync/shared';
import type { UserRole } from '../services/types';

/** profiles.role (banco) → enum Role (app). */
export const DB_ROLE_TO_APP_ROLE: Record<UserRole, Role> = {
  ADMIN: Role.ADM,
  MEDICAL_SURGEON: Role.SURGEON,
  ASSOCIATED_DOCTOR: Role.ASSOCIATE,
  SUPPORT: Role.SUPPORT,
  TEAM_MANAGER: Role.MANAGER,
};

/** Converte o papel do banco no papel do app (fallback: associado). */
export function dbRoleToAppRole(role: UserRole): Role {
  return DB_ROLE_TO_APP_ROLE[role] ?? Role.ASSOCIATE;
}

/** Rótulo PT-BR por papel do app (Role). */
export const APP_ROLE_LABEL_PT: Record<Role, string> = {
  [Role.ADM]: 'Administrador',
  [Role.SURGEON]: 'Médico Cirurgião',
  [Role.ASSOCIATE]: 'Médico Associado',
  [Role.SUPPORT]: 'Suporte',
  [Role.MANAGER]: 'Gerente de Equipe',
};

/** Rótulo PT-BR a partir do papel do BANCO (profiles.role). */
export function dbRoleLabelPt(role: string): string {
  const app = DB_ROLE_TO_APP_ROLE[role as UserRole];
  return app ? APP_ROLE_LABEL_PT[app] : role;
}
