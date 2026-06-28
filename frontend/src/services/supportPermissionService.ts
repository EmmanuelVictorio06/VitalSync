/**
 * Capacidades do perfil SUPPORT (Suporte) — camada de UI.
 *
 * O Suporte é operacional, NÃO clínico. O backend (RLS + RPCs SECURITY DEFINER)
 * é a autoridade: aqui só decidimos o que mostrar/habilitar. Todas as ações
 * sensíveis são revalidadas no servidor.
 *
 * PODE: ver/buscar pacientes, editar telefone de contato, reenviar o link
 * público, ver status básico de WhatsApp/logs, gerar convite de profissional.
 * NÃO PODE: excluir paciente, alterar dados clínicos, atender alertas, mudar
 * equipe, ver fotos sensíveis, exportar dados sensíveis, gerenciar usuários.
 */
import { Role } from '@vitalsync/shared';
import type { AuthUser } from '../lib/dto';

type U = AuthUser | null | undefined;

const is = (user: U, ...roles: Role[]) => !!user && roles.includes(user.role);

export const supportPermissionService = {
  isSupport: (user: U) => is(user, Role.SUPPORT),

  /* --------------------------- Pode (allow) ---------------------------- */

  /** Ver a lista de pacientes (Admin, clínicos e Suporte). */
  canViewPatients: (user: U) => is(user, Role.ADM, Role.SURGEON, Role.ASSOCIATE, Role.SUPPORT),

  /** Buscar pacientes — mesma audiência da listagem. */
  canSearchPatients: (user: U) => is(user, Role.ADM, Role.SURGEON, Role.ASSOCIATE, Role.SUPPORT),

  /** Editar telefone/contato do paciente (Admin e Suporte). */
  canEditPatientContact: (user: U) => is(user, Role.ADM, Role.SUPPORT),

  /** Reenviar o link público do paciente (Admin, Cirurgião e Suporte). */
  canResendPublicLink: (user: U) => is(user, Role.ADM, Role.SURGEON, Role.SUPPORT),

  /** Ver status básico de WhatsApp / logs de notificação (Admin e Suporte). */
  canViewBasicLogs: (user: U) => is(user, Role.ADM, Role.SUPPORT),

  /**
   * Reenviar a notificação de alerta por WhatsApp à equipe. NÃO é ação do
   * Suporte — a RPC `alert_resend_notification` só aceita Admin ou Cirurgião
   * Principal da equipe (M-02). Mantido aqui só para deixar explícito que o
   * Suporte não pode; o botão é gated por permissionService.canResendAlertNotification.
   */
  canResendWhatsapp: (user: U) => is(user, Role.ADM),

  /** Gerar convite de médico/cirurgião (Admin e Suporte) — usado no fluxo de convites. */
  canGenerateInvite: (user: U) => is(user, Role.ADM, Role.SUPPORT),

  /* ------------------------- Não pode (deny) --------------------------- */

  /** Excluir paciente: NUNCA o Suporte. */
  canDeletePatient: (user: U) => is(user, Role.ADM, Role.SURGEON),

  /** Ver fotos sensíveis (cicatriz/dreno): clínicos e Admin; nunca o Suporte. */
  canViewSensitivePhotos: (user: U) => is(user, Role.ADM, Role.SURGEON, Role.ASSOCIATE),

  /** Alterar dados clínicos / atender alertas: somente clínicos. */
  canEditClinicalData: (user: U) => is(user, Role.SURGEON, Role.ASSOCIATE),
};
