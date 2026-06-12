/**
 * Entidades de domínio — tipos planos, independentes de Prisma/framework.
 * As implementações de repositório (infraestrutura) mapeiam os modelos do banco
 * para estas estruturas, mantendo o domínio desacoplado da persistência.
 */
import type { ClinicalStatus, Period, Role } from '@vitalsync/shared';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  whatsapp: string | null;
  isActive: boolean;
  teamId: string | null;
}

/** Usuário sem o hash de senha — formato seguro para trafegar/serializar. */
export type SafeUser = Omit<User, 'passwordHash'>;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: Role;
}

export interface MedicalTeam {
  id: string;
  number: number;
  surgeonId: string | null;
  members: TeamMember[];
}

export interface Patient {
  id: string;
  name: string;
  birthDate: Date;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: Date;
  dischargeDate: Date;
  hospitalId: string;
  teamId: string;
  currentStatus: ClinicalStatus;
  lastMeasurementAt: Date | null;
  attendedById: string | null;
  attendedAt: Date | null;
  isActive: boolean;
}

export interface VitalSignRecord {
  id: string;
  patientId: string;
  recordDate: Date;
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
  submittedAt: Date;
}

export interface MonitoringLink {
  id: string;
  patientId: string;
  tokenHash: string;
  expiresAt: Date;
  isActive: boolean;
}

/** Identidade do usuário autenticado, propagada pelas camadas. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  teamId: string | null;
  name: string;
}
