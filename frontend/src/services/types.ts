/** Tipos das linhas das tabelas do Supabase (camada de serviços). */

export type UserRole = 'ADMIN' | 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';
export type RoleInTeam = 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';
export type EntityStatus = 'ACTIVE' | 'INACTIVE';
export type MeasurementPeriod = 'MORNING' | 'NIGHT';
export type ClinicalStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface NotificationPrefs {
  whatsapp_alerts_enabled: boolean;
  email_alerts_enabled: boolean;
  yellow_alerts_enabled: boolean;
  red_alerts_enabled: boolean;
  pending_attendance_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  whatsapp_alerts_enabled: true,
  email_alerts_enabled: false,
  yellow_alerts_enabled: true,
  red_alerts_enabled: true,
  pending_attendance_enabled: true,
};

export interface Profile {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: UserRole;
  avatar_url: string | null;
  specialty: string | null;
  crm: string | null;
  notes: string | null;
  status: EntityStatus;
  notification_prefs: Partial<NotificationPrefs> | null;
  created_at: string;
  updated_at: string | null;
}

/** Linha da tela "Gerenciar Usuários" (vem da RPC admin_get_users_overview). */
export interface UserOverview {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: UserRole;
  status: EntityStatus;
  avatar_url: string | null;
  specialty: string | null;
  crm: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  last_sign_in_at: string | null;
  team_count: number;
}

/** Vínculo de um usuário com uma equipe (resumo exibido nos detalhes). */
export interface UserTeamLink {
  teamId: string;
  teamNumber: number;
  roleInTeam: RoleInTeam;
  surgeonName: string;
  patientCount: number;
  teamStatus: EntityStatus;
}

export interface AccountRequest {
  id: string;
  profile_id: string;
  type: 'DEACTIVATION';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Hospital {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface SurgeryType {
  id: string;
  name: string;
  specialty: string | null;
  description: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface MedicalTeam {
  id: string;
  team_number: number;
  main_surgeon_id: string | null;
  status: EntityStatus;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  doctor_id: string;
  role_in_team: RoleInTeam;
  status: EntityStatus;
  created_at: string;
}

export interface Patient {
  id: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  surgery_type_id: string | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
  hospital_id: string | null;
  team_id: string;
  secure_token: string;
  status: EntityStatus;
  current_status: ClinicalStatus;
  /** Paciente fictício cadastrado durante a homologação médica. */
  is_test: boolean;
  created_at: string;
  /** Exclusão lógica: nulo = ativo; preenchido = arquivado (some das telas). */
  deleted_at: string | null;
  deleted_by?: string | null;
  updated_at?: string | null;
}

export interface VitalSignRecord {
  id: string;
  patient_id: string;
  record_date: string;
  period: MeasurementPeriod;
  monitoring_day: number | null;
  temperature: number | null;
  oxygen_saturation: number | null;
  systolic_pressure: number | null;
  diastolic_pressure: number | null;
  heart_rate: number | null;
  pain_level: number | null;
  dyspnea_level: number | null;
  urination_count: number | null;
  vomiting_count: number | null;
  has_bleeding: boolean | null;
  steps: number | null;
  wound_photo_path: string | null;
  has_drain: boolean | null;
  drain_photo_path: string | null;
  clinical_status: ClinicalStatus;
  created_at: string;
}

/** Tipo da foto de acompanhamento. */
export type PhotoType = 'SURGICAL_WOUND' | 'DRAIN';

/** Foto de acompanhamento (cicatriz/dreno) — espelha public.measurement_photos. */
export interface MeasurementPhoto {
  id: string;
  patient_id: string;
  vital_record_id: string | null;
  photo_type: PhotoType;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

/** Status do ATENDIMENTO do alerta (diferente do status clínico GREEN/YELLOW/RED). */
export type AttendanceStatus = 'PENDING' | 'IN_ANALYSIS' | 'ATTENDED' | 'IGNORED';

export interface ClinicalAlert {
  id: string;
  patient_id: string;
  team_id: string;
  vital_record_id: string | null;
  status: ClinicalStatus;
  /** Tipo do sinal que disparou (Temperatura, Saturação, Dor, Sangramento…). */
  type: string | null;
  description: string;
  attended: boolean;
  attendance_status: AttendanceStatus;
  ignored_reason: string | null;
  attended_by: string | null;
  attended_at: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Status de uma notificação de WhatsApp. Em homologação, números fora da
 *  whitelist ficam SKIPPED_TEST_MODE. (Linhas antigas usam minúsculas.) */
export type NotificationStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'SKIPPED_TEST_MODE'
  | 'logged'
  | (string & {});

/** Registro de notificação (WhatsApp via Meta Cloud API / Edge Function). */
export interface NotificationLog {
  id: string;
  patient_id: string | null;
  alert_id: string | null;
  recipient_profile_id: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  channel: string;
  status: NotificationStatus;
  message: string | null;
  template_name: string | null;
  /** 'production' ou 'homologation'. */
  environment: string;
  is_test: boolean;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

/** Evento de atendimento (linha do tempo do alerta). */
export interface AttendanceConfirmation {
  id: string;
  patient_id: string;
  alert_id: string | null;
  attended_by: string;
  status: string | null; // IN_ANALYSIS | ATTENDED | IGNORED
  observation: string | null;
  created_at: string;
}
