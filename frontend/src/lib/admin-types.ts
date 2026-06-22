/** Tipos e interfaces da seção Administração. */
import type { ClinicalStatus } from '@vitalsync/shared';

export type EntityStatus = 'ACTIVE' | 'INACTIVE';

/* ---------------- Hospitais ---------------- */
export interface Hospital {
  id: string;
  name: string;
  city: string;
  state: string;
  address?: string;
  phone?: string;
  status: EntityStatus;
  createdAt: string; // ISO
  /** Nº de pacientes vinculados — define se exclusão vira inativação. */
  linkedPatients: number;
}

export interface HospitalInput {
  name: string;
  city: string;
  state: string;
  address?: string;
  phone?: string;
  status: EntityStatus;
}

/* ---------------- Tipos de Cirurgia ---------------- */
export interface SurgeryTypeAdmin {
  id: string;
  name: string;
  specialty?: string;
  description?: string;
  status: EntityStatus;
  createdAt: string;
  linkedPatients: number;
}

export interface SurgeryTypeInput {
  name: string;
  specialty?: string;
  description?: string;
  status: EntityStatus;
}

/* ---------------- Exportações ---------------- */
export type ExportDataset = 'PATIENTS' | 'VITALS' | 'ALERTS' | 'CARE' | 'FULL';
export type ExportFormat = 'csv' | 'xlsx';
export type ExportStatus = 'GENERATING' | 'DONE' | 'ERROR';

export const EXPORT_DATASET_LABEL: Record<ExportDataset, string> = {
  PATIENTS: 'Dados dos pacientes',
  VITALS: 'Registros de sinais vitais',
  ALERTS: 'Alertas clínicos',
  CARE: 'Atendimentos realizados',
  FULL: 'Exportação completa',
};

export interface ExportFilters {
  fromDate?: string;
  toDate?: string;
  patient?: string;
  teamId?: string;
  surgeonId?: string;
  hospitalId?: string;
  surgeryTypeId?: string;
  clinicalStatus?: ClinicalStatus | '';
  monitoring?: 'ACTIVE' | 'FINISHED' | '';
}

export interface ExportHistoryItem {
  id: string;
  datetime: string;
  userName: string;
  dataset: ExportDataset;
  filtersSummary: string;
  format: ExportFormat;
  status: ExportStatus;
  /** Query string usada — permite baixar novamente. Ausente em registros antigos. */
  query?: string;
}

/* ---------------- Configurações ---------------- */
export interface GeneralSettings {
  systemName: string;
  supportEmail: string;
  supportPhone: string;
  monitoringDays: number;
  timezone: string;
  language: string;
}

export type WhatsAppProvider = 'log' | 'twilio' | 'meta';

export interface WhatsAppSettings {
  provider: WhatsAppProvider;
  /** Mascarado após salvo — o valor completo nunca volta do servidor. */
  apiTokenMasked: string;
  senderNumber: string;
  integrationActive: boolean;
  templateYellow: string;
  templateRed: string;
}

export interface SecuritySettings {
  sessionExpiry: string;
  passwordMinLength: number;
  maxLoginAttempts: number;
  lockoutMinutes: number;
  patientLinkGraceHours: number;
  allowResendSamePeriod: boolean;
  confirmBeforeDelete: boolean;
}

/* ---------------- Auditoria ---------------- */
export type AuditAction =
  | 'LOGIN'
  | 'TEAM_CREATE'
  | 'TEAM_UPDATE'
  | 'DELETE_OR_INACTIVATE'
  | 'PATIENT_CREATE'
  | 'PATIENT_UPDATE'
  | 'VITALS_RECORD'
  | 'ALERT_GENERATED'
  | 'PATIENT_ATTENDED'
  | 'DATA_EXPORT'
  | 'SETTINGS_CHANGE';

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Login',
  TEAM_CREATE: 'Cadastro de equipe',
  TEAM_UPDATE: 'Alteração de equipe',
  DELETE_OR_INACTIVATE: 'Exclusão ou inativação',
  PATIENT_CREATE: 'Cadastro de paciente',
  PATIENT_UPDATE: 'Alteração de paciente',
  VITALS_RECORD: 'Registro de sinais vitais',
  ALERT_GENERATED: 'Geração de alerta',
  PATIENT_ATTENDED: 'Paciente marcado como atendido',
  DATA_EXPORT: 'Exportação de dados',
  SETTINGS_CHANGE: 'Alteração de configurações',
};

export interface AuditEvent {
  id: string;
  datetime: string;
  userName: string;
  userRole: string;
  action: AuditAction;
  entity: string;
  origin?: string; // IP/origem
}

export interface AuditFilters {
  user?: string;
  action?: AuditAction | '';
  fromDate?: string;
  toDate?: string;
  entity?: string;
}
