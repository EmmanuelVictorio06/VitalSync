/** Tipos das respostas da API consumidos pelo frontend. */
import type { ClinicalStatus, Period, Role } from '@vitalsync/shared';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  teamId: string | null;
  /** Caminho do avatar no bucket `profile-avatars` (null = sem foto). */
  avatarUrl: string | null;
  /** Tag única do profissional (ex.: "Joao#4821"). Null para papéis não médicos. */
  professionalTag: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface SelectItem {
  id: string;
  name: string;
}

export interface SurgeonItem extends SelectItem {
  teamId: string | null;
  teamNumber: number | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: Role;
}

export interface Team {
  id: string;
  number: number;
  surgeonId: string | null;
  members: TeamMember[];
}

export interface PatientCardData {
  id: string;
  name: string;
  phone: string;
  surgeonName: string | null;
  surgeryTypeName: string;
  hospitalName: string;
  teamNumber: number;
  surgeryDate: string;
  dischargeDate: string;
  currentStatus: ClinicalStatus;
  attendedById: string | null;
  attendedByName: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VitalRecord {
  id: string;
  recordDate: string;
  period: Period;
  monitoringDay: number;
  temperature: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  heartRate: number;
  pain: number;
  dyspnea: number;
  urinatedNormally: boolean;
  urinationCount: number | null;
  hadVomit: boolean;
  vomitCount: number | null;
  hadBleeding: boolean;
  stepsCount: number | null;
  overallStatus: ClinicalStatus;
  statusByVital: Record<string, ClinicalStatus>;
  /** Foto da cicatriz operatória (opcional). */
  patientId: string;
  woundPhotoUrl: string | null;
  woundPhotoFileName: string | null;
  woundPhotoMimeType: string | null;
  woundPhotoSize: number | null;
  woundPhotoUploadedAt: string | null;
  /** Dreno: o paciente informou possuir? E a foto do dreno (opcional). */
  hasDrain: boolean;
  drainPhotoUrl: string | null;
  drainPhotoFileName: string | null;
  drainPhotoUploadedAt: string | null;
  /** PATIENT = enviado pelo paciente. STAFF = lançado pela equipe em nome dele. */
  source: 'PATIENT' | 'STAFF';
  /** Nome do profissional que lançou, quando source = STAFF. */
  enteredByName: string | null;
}

/** Estado do esquecimento de um período de HOJE, para o banner do painel individual. */
export interface MissedPeriodInfo {
  status: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

export interface PatientDashboard {
  patient: {
    id: string;
    name: string;
    surgeonName: string | null;
    surgeryTypeName: string;
    hospitalName: string;
    surgeryDate: string;
    dischargeDate: string;
    phone: string;
    currentStatus: ClinicalStatus;
    currentAlertId: string | null;
    currentAlertStatus: 'PENDING' | 'IN_ANALYSIS' | 'ATTENDED' | 'IGNORED' | null;
    attendedById: string | null;
    attendedByName: string | null;
    daysSinceDischarge: number;
    monitoringDay: number | null;
    /** Resumo de prontuário (texto livre, opcional). */
    medicalRecordSummary: string | null;
    /** Esquecimento de hoje (janela fechada, sem registro) — null quando não se aplica. */
    missedToday: { morning: MissedPeriodInfo | null; night: MissedPeriodInfo | null };
  };
  records: VitalRecord[];
  teamMembers: SelectItem[];
}

export interface PatientLinkInfo {
  patient: {
    id: string;
    name: string;
    age: number;
    surgeryDate: string;
    dischargeDate: string;
    monitoringDay: number | null;
    daysSinceDischarge: number;
    withinWindow: boolean;
  };
}
