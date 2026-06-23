import type { Prisma } from '@prisma/client';
import type { ClinicalStatus, Period } from '@vitalsync/shared';
import { Role } from '@vitalsync/shared';
import type {
  MedicalTeam,
  MonitoringLink,
  Patient,
  TeamMember,
  User,
  VitalSignRecord,
} from '../../domain/entities.js';
import type {
  AlertRepository,
  AttendanceRepository,
  CatalogRepository,
  ExportRepository,
  ExportRow,
  MonitoringLinkRepository,
  NewTeamMemberInput,
  Paginated,
  PatientListFilter,
  PatientRepository,
  PatientWithRelations,
  TeamRepository,
  UserRepository,
  VitalSignRepository,
  WoundPhotoData,
} from '../../domain/repositories.js';
import { prisma } from './client.js';

// ----------------------------------------------------------------------------
// Mappers (Prisma -> domínio)
// ----------------------------------------------------------------------------

function mapUser(u: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  whatsapp: string | null;
  isActive: boolean;
  teamId: string | null;
}): User {
  return { ...u, role: u.role as Role };
}

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const u = await prisma.user.findUnique({ where: { email } });
    return u ? mapUser(u) : null;
  }
  async findById(id: string): Promise<User | null> {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? mapUser(u) : null;
  }
  async findTeamMembers(teamId: string): Promise<TeamMember[]> {
    const users = await prisma.user.findMany({
      where: { teamId, isActive: true },
      orderBy: { role: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      whatsapp: u.whatsapp,
      role: u.role as Role,
    }));
  }
  async existsByEmail(email: string): Promise<boolean> {
    return (await prisma.user.count({ where: { email } })) > 0;
  }
}

// ----------------------------------------------------------------------------
// Teams
// ----------------------------------------------------------------------------

type TeamWithMembers = Prisma.MedicalTeamGetPayload<{ include: { members: true } }>;

function mapTeam(t: TeamWithMembers): MedicalTeam {
  return {
    id: t.id,
    number: t.number,
    surgeonId: t.surgeonId,
    members: t.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      whatsapp: m.whatsapp,
      role: m.role as Role,
    })),
  };
}

export class PrismaTeamRepository implements TeamRepository {
  async findById(id: string): Promise<MedicalTeam | null> {
    const t = await prisma.medicalTeam.findUnique({ where: { id }, include: { members: true } });
    return t ? mapTeam(t) : null;
  }
  async findByNumber(number: number): Promise<MedicalTeam | null> {
    const t = await prisma.medicalTeam.findUnique({ where: { number }, include: { members: true } });
    return t ? mapTeam(t) : null;
  }
  async list(): Promise<MedicalTeam[]> {
    const teams = await prisma.medicalTeam.findMany({
      include: { members: true },
      orderBy: { number: 'asc' },
    });
    return teams.map(mapTeam);
  }

  async createWithMembers(input: {
    number: number;
    surgeon: NewTeamMemberInput;
    associates: NewTeamMemberInput[];
  }): Promise<MedicalTeam> {
    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.medicalTeam.create({ data: { number: input.number } });
      const surgeon = await tx.user.create({
        data: {
          name: input.surgeon.name,
          email: input.surgeon.email,
          passwordHash: input.surgeon.passwordHash,
          whatsapp: input.surgeon.whatsapp,
          role: 'SURGEON',
          teamId: created.id,
        },
      });
      await tx.medicalTeam.update({ where: { id: created.id }, data: { surgeonId: surgeon.id } });
      if (input.associates.length) {
        await tx.user.createMany({
          data: input.associates.map((a) => ({
            name: a.name,
            email: a.email,
            passwordHash: a.passwordHash,
            whatsapp: a.whatsapp,
            role: 'ASSOCIATE' as const,
            teamId: created.id,
          })),
        });
      }
      return tx.medicalTeam.findUniqueOrThrow({ where: { id: created.id }, include: { members: true } });
    });
    return mapTeam(team);
  }

  async updateNumber(teamId: string, number: number): Promise<void> {
    await prisma.medicalTeam.update({ where: { id: teamId }, data: { number } });
  }
  async addAssociate(teamId: string, member: NewTeamMemberInput): Promise<void> {
    await prisma.user.create({
      data: {
        name: member.name,
        email: member.email,
        passwordHash: member.passwordHash,
        whatsapp: member.whatsapp,
        role: 'ASSOCIATE',
        teamId,
      },
    });
  }
  /** Remoção lógica do médico: desvincula da equipe e desativa o login (preserva auditoria/LGPD). */
  async removeMember(teamId: string, userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false, teamId: null } });
  }
  async updateMember(
    userId: string,
    data: Partial<NewTeamMemberInput> & { name?: string },
  ): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        whatsapp: data.whatsapp,
        passwordHash: data.passwordHash,
      },
    });
  }
  async delete(teamId: string): Promise<void> {
    await prisma.$transaction([
      prisma.user.updateMany({ where: { teamId }, data: { isActive: false, teamId: null } }),
      prisma.medicalTeam.delete({ where: { id: teamId } }),
    ]);
  }
  async countPatients(teamId: string): Promise<number> {
    return prisma.patient.count({ where: { teamId, isActive: true } });
  }
}

// ----------------------------------------------------------------------------
// Patients
// ----------------------------------------------------------------------------

const patientInclude = {
  surgeryType: true,
  hospital: true,
  team: { include: { surgeon: true } },
  attendedBy: { include: { attendedBy: true } },
} satisfies Prisma.PatientInclude;

type PatientFull = Prisma.PatientGetPayload<{ include: typeof patientInclude }>;

function mapPatient(p: {
  id: string;
  name: string;
  birthDate: Date;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: Date;
  dischargeDate: Date;
  hospitalId: string;
  teamId: string;
  currentStatus: string;
  lastMeasurementAt: Date | null;
  attendedById: string | null;
  attendedAt: Date | null;
  isActive: boolean;
}): Patient {
  return { ...p, currentStatus: p.currentStatus as ClinicalStatus };
}

function mapPatientWithRelations(p: PatientFull): PatientWithRelations {
  return {
    ...mapPatient(p),
    surgeonName: p.team.surgeon?.name ?? null,
    surgeryTypeName: p.surgeryType.name,
    hospitalName: p.hospital.name,
    teamNumber: p.team.number,
    attendedByName: p.attendedBy?.attendedBy.name ?? null,
  };
}

export class PrismaPatientRepository implements PatientRepository {
  async create(
    input: Omit<
      Patient,
      'id' | 'currentStatus' | 'lastMeasurementAt' | 'attendedById' | 'attendedAt' | 'isActive'
    >,
  ): Promise<Patient> {
    const p = await prisma.patient.create({
      data: {
        name: input.name,
        birthDate: input.birthDate,
        phone: input.phone,
        surgeryTypeId: input.surgeryTypeId,
        surgeryDate: input.surgeryDate,
        dischargeDate: input.dischargeDate,
        hospitalId: input.hospitalId,
        teamId: input.teamId,
      },
    });
    return mapPatient(p);
  }

  async findById(id: string): Promise<Patient | null> {
    const p = await prisma.patient.findUnique({ where: { id } });
    return p ? mapPatient(p) : null;
  }

  async findWithRelations(id: string): Promise<PatientWithRelations | null> {
    const p = await prisma.patient.findUnique({ where: { id }, include: patientInclude });
    return p ? mapPatientWithRelations(p) : null;
  }

  async list(filter: PatientListFilter): Promise<Paginated<PatientWithRelations>> {
    const where: Prisma.PatientWhereInput = {
      isActive: true,
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.status ? { currentStatus: filter.status } : {}),
      ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      ...(filter.fromDate || filter.toDate
        ? { surgeryDate: { gte: filter.fromDate, lte: filter.toDate } }
        : {}),
    };
    const page = Math.max(1, filter.page);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize));
    const [items, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        include: patientInclude,
        orderBy: [{ currentStatus: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.patient.count({ where }),
    ]);
    return { items: items.map(mapPatientWithRelations), total, page, pageSize };
  }

  async listForSelect(teamId?: string): Promise<Array<{ id: string; name: string }>> {
    return prisma.patient.findMany({
      where: { isActive: true, ...(teamId ? { teamId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.patient.update({ where: { id }, data: { isActive: false } });
  }

  async updateStatusAfterMeasurement(
    id: string,
    status: ClinicalStatus,
    measuredAt: Date,
  ): Promise<void> {
    await prisma.patient.update({
      where: { id },
      data: { currentStatus: status, lastMeasurementAt: measuredAt },
    });
  }

  async setAttendance(id: string, attendanceId: string | null, attendedAt: Date | null): Promise<void> {
    await prisma.patient.update({
      where: { id },
      data: { attendedById: attendanceId, attendedAt },
    });
  }
}

// ----------------------------------------------------------------------------
// Monitoring links
// ----------------------------------------------------------------------------

export class PrismaMonitoringLinkRepository implements MonitoringLinkRepository {
  async create(input: { patientId: string; tokenHash: string; expiresAt: Date }): Promise<MonitoringLink> {
    const l = await prisma.patientMonitoringLink.create({ data: input });
    return { id: l.id, patientId: l.patientId, tokenHash: l.tokenHash, expiresAt: l.expiresAt, isActive: l.isActive };
  }
  async findActiveByTokenHash(tokenHash: string): Promise<MonitoringLink | null> {
    const l = await prisma.patientMonitoringLink.findUnique({ where: { tokenHash } });
    if (!l || !l.isActive) return null;
    return { id: l.id, patientId: l.patientId, tokenHash: l.tokenHash, expiresAt: l.expiresAt, isActive: l.isActive };
  }
  async deactivateForPatient(patientId: string): Promise<void> {
    await prisma.patientMonitoringLink.updateMany({ where: { patientId }, data: { isActive: false } });
  }
  async touch(id: string): Promise<void> {
    await prisma.patientMonitoringLink.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }
}

// ----------------------------------------------------------------------------
// Vital signs
// ----------------------------------------------------------------------------

function mapRecord(r: Prisma.VitalSignRecordGetPayload<object>): VitalSignRecord {
  return {
    id: r.id,
    patientId: r.patientId,
    recordDate: r.recordDate,
    period: r.period as Period,
    monitoringDay: r.monitoringDay,
    temperature: r.temperature,
    spo2: r.spo2,
    systolic: r.systolic,
    diastolic: r.diastolic,
    heartRate: r.heartRate,
    pain: r.pain,
    dyspnea: r.dyspnea,
    urinatedNormally: r.urinatedNormally,
    urinationCount: r.urinationCount,
    hadVomit: r.hadVomit,
    vomitCount: r.vomitCount,
    hadBleeding: r.hadBleeding,
    stepsCount: r.stepsCount,
    overallStatus: r.overallStatus as ClinicalStatus,
    statusByVital: (r.statusByVital ?? {}) as Record<string, ClinicalStatus>,
    woundPhotoUrl: r.woundPhotoUrl,
    woundPhotoStoragePath: r.woundPhotoStoragePath,
    woundPhotoFileName: r.woundPhotoFileName,
    woundPhotoMimeType: r.woundPhotoMimeType,
    woundPhotoSize: r.woundPhotoSize,
    woundPhotoUploadedAt: r.woundPhotoUploadedAt,
    submittedAt: r.submittedAt,
  };
}

export class PrismaVitalSignRepository implements VitalSignRepository {
  async create(input: Omit<VitalSignRecord, 'id' | 'submittedAt'>): Promise<VitalSignRecord> {
    const r = await prisma.vitalSignRecord.create({
      data: {
        patientId: input.patientId,
        recordDate: input.recordDate,
        period: input.period,
        monitoringDay: input.monitoringDay,
        temperature: input.temperature,
        spo2: input.spo2,
        systolic: input.systolic,
        diastolic: input.diastolic,
        heartRate: input.heartRate,
        pain: input.pain,
        dyspnea: input.dyspnea,
        urinatedNormally: input.urinatedNormally,
        urinationCount: input.urinationCount,
        hadVomit: input.hadVomit,
        vomitCount: input.vomitCount,
        hadBleeding: input.hadBleeding,
        stepsCount: input.stepsCount,
        overallStatus: input.overallStatus,
        statusByVital: input.statusByVital as Prisma.InputJsonValue,
      },
    });
    return mapRecord(r);
  }

  async findById(id: string): Promise<VitalSignRecord | null> {
    const r = await prisma.vitalSignRecord.findUnique({ where: { id } });
    return r ? mapRecord(r) : null;
  }

  async attachWoundPhoto(recordId: string, photo: WoundPhotoData): Promise<void> {
    await prisma.vitalSignRecord.update({
      where: { id: recordId },
      data: {
        woundPhotoUrl: photo.url,
        woundPhotoStoragePath: photo.storagePath,
        woundPhotoFileName: photo.fileName,
        woundPhotoMimeType: photo.mimeType,
        woundPhotoSize: photo.size,
        woundPhotoUploadedAt: photo.uploadedAt,
      },
    });
  }

  async findByPatientDayPeriod(
    patientId: string,
    recordDate: Date,
    period: Period,
  ): Promise<VitalSignRecord | null> {
    const r = await prisma.vitalSignRecord.findUnique({
      where: { patientId_recordDate_period: { patientId, recordDate, period } },
    });
    return r ? mapRecord(r) : null;
  }

  async listByPatient(patientId: string): Promise<VitalSignRecord[]> {
    const rows = await prisma.vitalSignRecord.findMany({
      where: { patientId },
      orderBy: [{ monitoringDay: 'asc' }, { period: 'asc' }],
    });
    return rows.map(mapRecord);
  }

  async previousNightSteps(patientId: string, beforeMonitoringDay: number): Promise<number | null> {
    const r = await prisma.vitalSignRecord.findFirst({
      where: { patientId, period: 'NIGHT', monitoringDay: beforeMonitoringDay - 1, stepsCount: { not: null } },
      orderBy: { monitoringDay: 'desc' },
    });
    return r?.stepsCount ?? null;
  }
}

// ----------------------------------------------------------------------------
// Attendance + Alerts
// ----------------------------------------------------------------------------

export class PrismaAttendanceRepository implements AttendanceRepository {
  async create(input: { patientId: string; attendedByUserId: string }): Promise<{ id: string; attendedAt: Date }> {
    const c = await prisma.attendanceConfirmation.create({ data: input });
    return { id: c.id, attendedAt: c.attendedAt };
  }
}

export class PrismaAlertRepository implements AlertRepository {
  async create(input: {
    patientId: string;
    vitalSignRecordId: string;
    status: ClinicalStatus;
    message: string;
    recipients: Array<{ userId: string; channel: string; deliveryStatus: string; detail?: string }>;
  }): Promise<{ id: string }> {
    const alert = await prisma.clinicalAlert.create({
      data: {
        patientId: input.patientId,
        vitalSignRecordId: input.vitalSignRecordId,
        status: input.status,
        message: input.message,
        recipients: {
          create: input.recipients.map((r) => ({
            userId: r.userId,
            channel: r.channel,
            deliveryStatus: r.deliveryStatus,
            detail: r.detail,
          })),
        },
      },
    });
    return { id: alert.id };
  }
}

// ----------------------------------------------------------------------------
// Catalog (dropdowns) + Export
// ----------------------------------------------------------------------------

export class PrismaCatalogRepository implements CatalogRepository {
  listSurgeryTypes(): Promise<Array<{ id: string; name: string }>> {
    return prisma.surgeryType.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
  listHospitals(): Promise<Array<{ id: string; name: string }>> {
    return prisma.hospital.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
  async listSurgeons(): Promise<Array<{ id: string; name: string; teamId: string | null; teamNumber: number | null }>> {
    const surgeons = await prisma.user.findMany({
      where: { role: 'SURGEON', isActive: true },
      include: { team: true },
      orderBy: { name: 'asc' },
    });
    return surgeons.map((s) => ({ id: s.id, name: s.name, teamId: s.teamId, teamNumber: s.team?.number ?? null }));
  }
}

export class PrismaExportRepository implements ExportRepository {
  async exportRows(filter: PatientListFilter): Promise<ExportRow[]> {
    const where: Prisma.PatientWhereInput = {
      isActive: true,
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.status ? { currentStatus: filter.status } : {}),
      ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      ...(filter.fromDate || filter.toDate ? { surgeryDate: { gte: filter.fromDate, lte: filter.toDate } } : {}),
    };
    const patients = await prisma.patient.findMany({
      where,
      include: { ...patientInclude, vitalSignRecords: { orderBy: [{ monitoringDay: 'asc' }, { period: 'asc' }] } },
      orderBy: { name: 'asc' },
    });

    const rows: ExportRow[] = [];
    for (const p of patients) {
      const base = {
        patientName: p.name,
        birthDate: p.birthDate,
        phone: p.phone,
        teamNumber: p.team.number,
        surgeonName: p.team.surgeon?.name ?? null,
        surgeryType: p.surgeryType.name,
        hospital: p.hospital.name,
        surgeryDate: p.surgeryDate,
        dischargeDate: p.dischargeDate,
      };
      if (p.vitalSignRecords.length === 0) {
        rows.push({ ...base, record: null });
      } else {
        for (const r of p.vitalSignRecords) rows.push({ ...base, record: mapRecord(r) });
      }
    }
    return rows;
  }
}
