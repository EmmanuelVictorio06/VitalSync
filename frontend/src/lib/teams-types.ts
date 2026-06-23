/**
 * Tipos da área "Minhas Equipes" (perfil profissional).
 *
 * Modelam a relação MUITOS-PARA-MUITOS entre médicos e equipes, permitindo que
 * o mesmo médico participe de várias equipes. A fonte da verdade no servidor
 * será a tabela `doctor_team_memberships` (ver teams-api.ts para o contrato).
 */
import type { ClinicalStatus } from '@vitalsync/shared';

/** Papel do médico DENTRO de uma equipe específica (não é o Role global). */
export type RoleInTeam = 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';

export const ROLE_IN_TEAM_LABEL: Record<RoleInTeam, string> = {
  MAIN_SURGEON: 'Cirurgião Responsável',
  ASSOCIATED_DOCTOR: 'Médico Associado',
};

/** Status do vínculo do médico com a equipe / status da própria equipe. */
export type ActiveStatus = 'ACTIVE' | 'INACTIVE';

/** Severidade de um alerta clínico (espelha o semáforo). */
export type AlertSeverity = 'RED' | 'YELLOW';

/** Médico que compõe a equipe (visão "Minhas Equipes", somente leitura). */
export interface TeamDoctor {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  roleInTeam: RoleInTeam;
}

/** Paciente vinculado a uma equipe (resumo para listagem). */
export interface TeamPatient {
  id: string;
  name: string;
  surgeryType: string;
  /** Data da alta hospitalar (ISO yyyy-mm-dd). */
  dischargeDate: string;
  /** Dia de monitoramento (D+n). */
  monitoringDay: number;
  status: ClinicalStatus;
}

/** Alerta recente de uma equipe. */
export interface TeamAlert {
  id: string;
  patientName: string;
  description: string;
  datetime: string;
  severity: AlertSeverity;
  /** Falso enquanto ninguém da equipe marcou como atendido. */
  attended: boolean;
}

/** Números agregados da equipe (considerando apenas pacientes vinculados). */
export interface TeamStats {
  doctors: number;
  monitoring: number;
  stable: number;
  attention: number;
  alert: number;
  unattendedAlerts: number;
}

/** Equipe à qual o médico logado está vinculado. */
export interface MyTeam {
  id: string;
  number: number;
  surgeonName: string;
  status: ActiveStatus;
  /** Data de criação (ISO) — pode não existir em registros antigos. */
  createdAt: string | null;
  /** Papel do médico LOGADO nesta equipe. */
  myRole: RoleInTeam;
  stats: TeamStats;
  doctors: TeamDoctor[];
  /**
   * Amostra de pacientes vinculados (para o modal de detalhes). Os totais
   * exibidos vêm sempre de `stats`, calculados pelo servidor.
   */
  patients: TeamPatient[];
  recentAlerts: TeamAlert[];
}

/** Cards de resumo do topo — somam apenas as equipes do médico logado. */
export interface MyTeamsSummary {
  teams: number;
  monitoring: number;
  attention: number;
  alert: number;
  unattendedAlerts: number;
}

/** Filtro de status clínico aplicado na listagem de equipes. */
export type PatientStatusFilter = 'ALL' | ClinicalStatus;
