/**
 * Portas de persistência (repository interfaces). As use cases dependem destas
 * abstrações, nunca do Prisma — permitindo trocar o banco sem tocar nas regras.
 */
import type { ClinicalStatus, Period } from '@vitalsync/shared';
import type {
  MedicalTeam,
  MonitoringLink,
  Patient,
  TeamMember,
  User,
  VitalSignRecord,
} from './entities.js';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /** Médicos (cirurgião + associados) de uma equipe, para alertas e dropdowns. */
  findTeamMembers(teamId: string): Promise<TeamMember[]>;
  existsByEmail(email: string): Promise<boolean>;
}

export interface NewTeamMemberInput {
  name: string;
  email: string;
  passwordHash: string;
  whatsapp: string | null;
}

export interface TeamRepository {
  findById(id: string): Promise<MedicalTeam | null>;
  findByNumber(number: number): Promise<MedicalTeam | null>;
  list(): Promise<MedicalTeam[]>;
  /** Cria a equipe junto com o cirurgião principal e os associados (transação). */
  createWithMembers(input: {
    number: number;
    surgeon: NewTeamMemberInput;
    associates: NewTeamMemberInput[];
  }): Promise<MedicalTeam>;
  updateNumber(teamId: string, number: number): Promise<void>;
  addAssociate(teamId: string, member: NewTeamMemberInput): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
  updateMember(userId: string, data: Partial<NewTeamMemberInput> & { name?: string }): Promise<void>;
  delete(teamId: string): Promise<void>;
  countPatients(teamId: string): Promise<number>;
}

export interface PatientListFilter {
  teamId?: string; // restrição de escopo (RBAC)
  search?: string; // nome do paciente
  status?: ClinicalStatus;
  fromDate?: Date; // período (data da cirurgia/alta)
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface PatientWithRelations extends Patient {
  surgeonName: string | null;
  surgeryTypeName: string;
  hospitalName: string;
  teamNumber: number;
  attendedByName: string | null;
}

export interface PatientRepository {
  create(input: Omit<Patient, 'id' | 'currentStatus' | 'lastMeasurementAt' | 'attendedById' | 'attendedAt' | 'isActive'>): Promise<Patient>;
  findById(id: string): Promise<Patient | null>;
  findWithRelations(id: string): Promise<PatientWithRelations | null>;
  list(filter: PatientListFilter): Promise<Paginated<PatientWithRelations>>;
  /** Lista simples (id+nome) para dropdowns, respeitando o escopo de equipe. */
  listForSelect(teamId?: string): Promise<Array<{ id: string; name: string }>>;
  softDelete(id: string): Promise<void>;
  updateStatusAfterMeasurement(id: string, status: ClinicalStatus, measuredAt: Date): Promise<void>;
  setAttendance(id: string, attendanceId: string | null, attendedAt: Date | null): Promise<void>;
}

export interface MonitoringLinkRepository {
  create(input: { patientId: string; tokenHash: string; expiresAt: Date }): Promise<MonitoringLink>;
  findActiveByTokenHash(tokenHash: string): Promise<MonitoringLink | null>;
  deactivateForPatient(patientId: string): Promise<void>;
  touch(id: string): Promise<void>;
}

/** Metadados da foto a vincular a um registro já criado. */
export interface WoundPhotoData {
  url: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

export interface VitalSignRepository {
  create(
    input: Omit<
      VitalSignRecord,
      | 'id'
      | 'submittedAt'
      | 'woundPhotoUrl'
      | 'woundPhotoStoragePath'
      | 'woundPhotoFileName'
      | 'woundPhotoMimeType'
      | 'woundPhotoSize'
      | 'woundPhotoUploadedAt'
    >,
  ): Promise<VitalSignRecord>;
  findById(id: string): Promise<VitalSignRecord | null>;
  findByPatientDayPeriod(patientId: string, recordDate: Date, period: Period): Promise<VitalSignRecord | null>;
  /** Registros do paciente na janela de monitoramento (para gráficos). */
  listByPatient(patientId: string): Promise<VitalSignRecord[]>;
  /** Soma de passos do dia anterior (regra relativa de passos). */
  previousNightSteps(patientId: string, beforeMonitoringDay: number): Promise<number | null>;
  /** Vincula a foto da ferida a um registro já existente. */
  attachWoundPhoto(recordId: string, photo: WoundPhotoData): Promise<void>;
}

export interface AttendanceRepository {
  create(input: { patientId: string; attendedByUserId: string }): Promise<{ id: string; attendedAt: Date }>;
}

export interface AlertRepository {
  create(input: {
    patientId: string;
    vitalSignRecordId: string;
    status: ClinicalStatus;
    message: string;
    recipients: Array<{ userId: string; channel: string; deliveryStatus: string; detail?: string }>;
  }): Promise<{ id: string }>;
}

export interface CatalogRepository {
  listSurgeryTypes(): Promise<Array<{ id: string; name: string }>>;
  listHospitals(): Promise<Array<{ id: string; name: string }>>;
  listSurgeons(): Promise<Array<{ id: string; name: string; teamId: string | null; teamNumber: number | null }>>;
}

/** Dados completos para exportação (após aplicar filtros e RBAC). */
export interface ExportRepository {
  exportRows(filter: PatientListFilter): Promise<ExportRow[]>;
}

export interface ExportRow {
  patientName: string;
  birthDate: Date;
  phone: string;
  teamNumber: number;
  surgeonName: string | null;
  surgeryType: string;
  hospital: string;
  surgeryDate: Date;
  dischargeDate: Date;
  record: VitalSignRecord | null;
}
