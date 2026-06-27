import {
  ALERT_THRESHOLDS,
  ClinicalStatus,
  MONITORING_DAYS,
  Role,
  daysSinceDischarge,
  monitoringDay,
  onlyDigits,
  whatsappLink,
} from '@vitalsync/shared';
import type { AuthenticatedUser, Patient } from '../domain/entities.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import type {
  AttendanceRepository,
  MonitoringLinkRepository,
  Paginated,
  PatientListFilter,
  PatientRepository,
  PatientWithRelations,
  UserRepository,
  VitalSignRepository,
} from '../domain/repositories.js';
import { AccessControl } from './auth.js';
import type { AuditLogger, LinkTokenService, PhotoStorageService } from './ports.js';

/** Somente ADM e médicos cadastrados acessam os menus de pacientes. */
function assertCanAccessPatients(user: AuthenticatedUser): void {
  if (([Role.ADM, Role.SURGEON, Role.ASSOCIATE] as Role[]).includes(user.role)) return;
  throw new ForbiddenError('Acesso restrito a profissionais cadastrados.');
}

export interface RegisterPatientInput {
  name: string;
  birthDate: string; // ISO
  phone: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  surgeonId: string;
}

export class RegisterPatientUseCase {
  constructor(
    private readonly patients: PatientRepository,
    private readonly users: UserRepository,
    private readonly links: MonitoringLinkRepository,
    private readonly linkTokens: LinkTokenService,
    private readonly audit: AuditLogger,
    private readonly config: { publicWebUrl: string; linkGraceHours: number },
  ) {}

  async execute(
    actor: AuthenticatedUser,
    input: RegisterPatientInput,
  ): Promise<{ patient: Patient; link: string }> {
    assertCanAccessPatients(actor);

    const surgeon = await this.users.findById(input.surgeonId);
    if (!surgeon || surgeon.role !== Role.SURGEON || !surgeon.teamId) {
      throw new ValidationError('Selecione um cirurgião principal válido.');
    }
    // Médico não-ADM só cadastra pacientes na sua própria equipe.
    AccessControl.assertCanAccessTeam(actor, surgeon.teamId);

    const birthDate = parseDate(input.birthDate, 'data de nascimento');
    const surgeryDate = parseDate(input.surgeryDate, 'data da cirurgia');
    const dischargeDate = parseDate(input.dischargeDate, 'data da alta hospitalar');
    if (dischargeDate < surgeryDate) {
      throw new ValidationError('A data da alta não pode ser anterior à data da cirurgia.');
    }
    if (!input.name?.trim()) throw new ValidationError('Informe o nome do paciente.');

    const patient = await this.patients.create({
      name: input.name.trim(),
      birthDate,
      phone: onlyDigits(input.phone),
      surgeryTypeId: input.surgeryTypeId,
      surgeryDate,
      dischargeDate,
      hospitalId: input.hospitalId,
      teamId: surgeon.teamId,
    });

    const link = await this.issueLink(patient);

    await this.audit.log({
      userId: actor.id,
      action: 'PATIENT_CREATE',
      entityType: 'Patient',
      entityId: patient.id,
      metadata: { teamId: surgeon.teamId },
    });

    return { patient, link };
  }

  /** Gera (ou regenera) o link seguro do paciente. */
  async issueLink(patient: Patient): Promise<string> {
    const { raw, hash } = this.linkTokens.generate();
    // Validade: fim do monitoramento + carência configurável.
    const expiresAt = new Date(patient.dischargeDate);
    expiresAt.setDate(expiresAt.getDate() + MONITORING_DAYS);
    expiresAt.setHours(expiresAt.getHours() + this.config.linkGraceHours);

    await this.links.deactivateForPatient(patient.id);
    await this.links.create({ patientId: patient.id, tokenHash: hash, expiresAt });

    // Token vai SOMENTE na URL — nunca exposto em outro lugar.
    return `${this.config.publicWebUrl.replace(/\/$/, '')}/r/${raw}`;
  }
}

export class RegeneratePatientLinkUseCase {
  constructor(
    private readonly register: RegisterPatientUseCase,
    private readonly patients: PatientRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(actor: AuthenticatedUser, patientId: string): Promise<{ link: string; whatsappUrl: string }> {
    assertCanAccessPatients(actor);
    const patient = await this.patients.findById(patientId);
    if (!patient || !patient.isActive) throw new NotFoundError('Paciente não encontrado.');
    AccessControl.assertCanAccessTeam(actor, patient.teamId);

    const link = await this.register.issueLink(patient);
    await this.audit.log({
      userId: actor.id,
      action: 'PATIENT_LINK_REGENERATE',
      entityType: 'Patient',
      entityId: patientId,
    });
    const message = `Olá, ${patient.name}! Registre seus sinais vitais de hoje neste link seguro: ${link}`;
    return { link, whatsappUrl: whatsappLink(patient.phone, message) };
  }
}

export class ListPatientsUseCase {
  constructor(private readonly patients: PatientRepository) {}

  async execute(
    actor: AuthenticatedUser,
    filter: Omit<PatientListFilter, 'teamId'>,
  ): Promise<Paginated<PatientWithRelations>> {
    assertCanAccessPatients(actor);
    return this.patients.list({ ...filter, teamId: AccessControl.teamScope(actor) });
  }
}

export class DeletePatientUseCase {
  constructor(
    private readonly patients: PatientRepository,
    private readonly links: MonitoringLinkRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(actor: AuthenticatedUser, patientId: string): Promise<void> {
    assertCanAccessPatients(actor);
    const patient = await this.patients.findById(patientId);
    if (!patient) throw new NotFoundError('Paciente não encontrado.');
    AccessControl.assertCanAccessTeam(actor, patient.teamId);

    await this.links.deactivateForPatient(patientId); // invalida o link
    await this.patients.softDelete(patientId);
    await this.audit.log({
      userId: actor.id,
      action: 'PATIENT_DELETE',
      entityType: 'Patient',
      entityId: patientId,
    });
  }
}

export class MarkPatientAttendedUseCase {
  constructor(
    private readonly patients: PatientRepository,
    private readonly attendance: AttendanceRepository,
    private readonly audit: AuditLogger,
  ) {}

  /** Marca atendimento; reflete no card de "Pacientes em Monitoramento". */
  async execute(
    actor: AuthenticatedUser,
    patientId: string,
    attendedByUserId: string,
  ): Promise<{ attendedAt: Date; attendedById: string }> {
    assertCanAccessPatients(actor);
    const patient = await this.patients.findById(patientId);
    if (!patient || !patient.isActive) throw new NotFoundError('Paciente não encontrado.');
    AccessControl.assertCanAccessTeam(actor, patient.teamId);

    const conf = await this.attendance.create({ patientId, attendedByUserId });
    await this.patients.setAttendance(patientId, conf.id, conf.attendedAt);

    await this.audit.log({
      userId: actor.id,
      action: 'ATTENDANCE_MARK',
      entityType: 'Patient',
      entityId: patientId,
      metadata: { attendedByUserId },
    });
    return { attendedAt: conf.attendedAt, attendedById: conf.id };
  }
}

/** Monta o painel de acompanhamento individual (resumo + séries dos gráficos). */
export class GetPatientDashboardUseCase {
  constructor(
    private readonly patients: PatientRepository,
    private readonly vitals: VitalSignRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(actor: AuthenticatedUser, patientId: string) {
    assertCanAccessPatients(actor);
    const patient = await this.patients.findWithRelations(patientId);
    if (!patient || !patient.isActive) throw new NotFoundError('Paciente não encontrado.');
    AccessControl.assertCanAccessTeam(actor, patient.teamId);

    const records = await this.vitals.listByPatient(patientId);
    const teamMembers = await this.users.findTeamMembers(patient.teamId);

    await this.audit.log({
      userId: actor.id,
      action: 'PATIENT_VIEW',
      entityType: 'Patient',
      entityId: patientId,
    });

    return {
      patient: {
        id: patient.id,
        name: patient.name,
        surgeonName: patient.surgeonName,
        surgeryTypeName: patient.surgeryTypeName,
        hospitalName: patient.hospitalName,
        surgeryDate: patient.surgeryDate,
        dischargeDate: patient.dischargeDate,
        phone: patient.phone,
        currentStatus: patient.currentStatus,
        attendedById: patient.attendedById,
        attendedByName: patient.attendedByName,
        daysSinceDischarge: daysSinceDischarge(patient.dischargeDate),
        monitoringDay: monitoringDay(patient.dischargeDate),
      },
      records,
      teamMembers: teamMembers.map((m) => ({ id: m.id, name: m.name })),
      thresholds: ALERT_THRESHOLDS, // limiares para desenhar as faixas nos gráficos
    };
  }
}

/**
 * Visualização da foto da ferida pelo profissional. Valida no backend que o
 * usuário pertence à equipe do paciente (não basta a checagem do frontend) e
 * registra a visualização em auditoria (dado sensível de saúde).
 */
export class ViewWoundPhotoUseCase {
  constructor(
    private readonly patients: PatientRepository,
    private readonly vitals: VitalSignRepository,
    private readonly photos: PhotoStorageService,
    private readonly audit: AuditLogger,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    recordId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string | null }> {
    assertCanAccessPatients(actor);

    const record = await this.vitals.findById(recordId);
    if (!record || !record.woundPhotoStoragePath) {
      throw new NotFoundError('Foto não encontrada para este registro.');
    }

    const patient = await this.patients.findById(record.patientId);
    if (!patient) throw new NotFoundError('Paciente não encontrado.');
    AccessControl.assertCanAccessTeam(actor, patient.teamId);

    const file = await this.photos.read(record.woundPhotoStoragePath);
    if (!file) throw new NotFoundError('Foto não encontrada.');

    await this.audit.log({
      userId: actor.id,
      action: 'WOUND_PHOTO_VIEW',
      entityType: 'VitalSignRecord',
      entityId: recordId,
      metadata: { patientId: patient.id },
    });

    return {
      buffer: file.buffer,
      mimeType: record.woundPhotoMimeType ?? file.mimeType,
      fileName: record.woundPhotoFileName,
    };
  }
}

function parseDate(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`Informe uma ${field} válida.`);
  return d;
}

export { ClinicalStatus };
