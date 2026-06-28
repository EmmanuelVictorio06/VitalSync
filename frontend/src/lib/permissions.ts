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

/**
 * Gestão GERAL de equipes ("Gerenciar Equipes"): criar/editar/excluir/inativar
 * qualquer equipe e definir o cirurgião responsável. Exclusivo do Administrador.
 */
export function canManageTeams(role: Role | undefined): boolean {
  return role === Role.ADM;
}

/**
 * "Minhas Equipes" (somente leitura): médico ASSOCIADO visualiza as equipes em
 * que está vinculado e acessa pacientes/alertas delas. Sem ações administrativas.
 * O backend revalida o vínculo a cada requisição.
 */
export function canViewMyTeams(role: Role | undefined): boolean {
  return role === Role.ASSOCIATE;
}

/**
 * "Minha Equipe": o CIRURGIÃO PRINCIPAL visualiza e gerencia apenas a própria
 * equipe (não cria equipes do zero nem acessa equipes de outros cirurgiões).
 */
export function canManageOwnTeam(role: Role | undefined): boolean {
  return role === Role.SURGEON;
}

/**
 * Dentro de "Minha Equipe", permite ao cirurgião adicionar/editar/remover
 * médicos associados. Gate explícito ("se permitido"): quando o backend expuser
 * a autorização (flag no usuário/equipe), basta passá-la aqui. O servidor
 * sempre revalida a ação e a posse da equipe.
 */
const SURGEON_CAN_MANAGE_MEMBERS = true;
export function canManageTeamMembers(role: Role | undefined): boolean {
  return role === Role.SURGEON && SURGEON_CAN_MANAGE_MEMBERS;
}

/** Cadastro de pacientes: Administrador e Cirurgião Principal (não o Associado). */
export function canRegisterPatients(role: Role | undefined): boolean {
  return role === Role.ADM || role === Role.SURGEON;
}

/**
 * Rota inicial (home) por perfil. O Suporte é operacional e NÃO tem Dashboard;
 * sua home é "Pacientes em Monitoramento". Usado no login e como destino de
 * redirecionamento quando o perfil não pode acessar uma rota (evita cair em
 * tela vazia ou em loop de redirecionamento — M-03).
 */
export function homeRouteFor(role: Role | undefined): string {
  return role === Role.SUPPORT ? '/monitoring' : '/dashboard';
}
