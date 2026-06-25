/** Tipos das respostas da API consumidos pelo frontend. */
import type { ClinicalStatus, Period, Role } from '@vitalsync/shared';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  teamId: string | null;
  /** Caminho do avatar no bucket `profile-avatars` (null = sem foto). */
  avatarUrl: string | null;
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
    attendedById: string | null;
    attendedByName: string | null;
    daysSinceDischarge: number;
    monitoringDay: number | null;
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
  inputRanges: Record<InputRangeKey, InputRangeInfo>;
}

export type InputRangeKey = 'temperature' | 'spo2' | 'systolic' | 'diastolic' | 'heartRate' | 'steps';
export interface InputRangeInfo {
  min: number;
  max: number;
  example: string;
  unit: string;
  PENDING_MEDICAL_VALIDATION: boolean;
}
