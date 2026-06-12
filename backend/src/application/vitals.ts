import {
  INPUT_RANGES,
  MONITORING_DAYS,
  Period,
  calculateAge,
  daysSinceDischarge,
  evaluateVitalSigns,
  monitoringDay,
  shouldAlert,
  startOfToday,
  type VitalSignInput,
} from '@vitalsync/shared';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors.js';
import type {
  MonitoringLinkRepository,
  PatientRepository,
  VitalSignRepository,
} from '../domain/repositories.js';
import type { AlertDispatcher } from './alerts.js';
import type { AuditLogger, LinkTokenService } from './ports.js';

/** Resolve o paciente a partir do token do link (acesso público do paciente). */
export class ResolvePatientLinkUseCase {
  constructor(
    private readonly links: MonitoringLinkRepository,
    private readonly patients: PatientRepository,
    private readonly linkTokens: LinkTokenService,
  ) {}

  async execute(rawToken: string) {
    const hash = this.linkTokens.hash(rawToken);
    const link = await this.links.findActiveByTokenHash(hash);
    if (!link || !link.isActive || link.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Link inválido ou expirado. Solicite um novo à sua equipe.');
    }
    const patient = await this.patients.findWithRelations(link.patientId);
    if (!patient || !patient.isActive) throw new NotFoundError('Paciente não encontrado.');

    await this.links.touch(link.id);

    const day = monitoringDay(patient.dischargeDate);
    return {
      linkId: link.id,
      patient: {
        id: patient.id,
        name: patient.name,
        age: calculateAge(patient.birthDate),
        surgeryDate: patient.surgeryDate,
        dischargeDate: patient.dischargeDate,
        monitoringDay: day,
        daysSinceDischarge: daysSinceDischarge(patient.dischargeDate),
        withinWindow: day !== null,
      },
      // Faixas de validação para o formulário (com flag de pendência médica).
      inputRanges: INPUT_RANGES,
    };
  }
}

export interface SubmitVitalSignsInput extends VitalSignInput {
  period: Period;
}

/**
 * Registro de Sinais Vitais — coração do sistema.
 * Valida no servidor, calcula o status, persiste, reseta o atendimento e
 * dispara alerta quando o status for amarelo/vermelho.
 */
export class RegisterVitalSignsUseCase {
  constructor(
    private readonly links: MonitoringLinkRepository,
    private readonly patients: PatientRepository,
    private readonly vitals: VitalSignRepository,
    private readonly linkTokens: LinkTokenService,
    private readonly alerts: AlertDispatcher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(rawToken: string, input: SubmitVitalSignsInput, ip?: string) {
    const hash = this.linkTokens.hash(rawToken);
    const link = await this.links.findActiveByTokenHash(hash);
    if (!link || !link.isActive || link.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Link inválido ou expirado. Solicite um novo à sua equipe.');
    }

    const patient = await this.patients.findWithRelations(link.patientId);
    if (!patient || !patient.isActive) throw new NotFoundError('Paciente não encontrado.');

    const today = startOfToday();
    const day = monitoringDay(patient.dischargeDate, today);
    if (day === null) {
      throw new ValidationError(
        `O período de monitoramento (${MONITORING_DAYS} dias) não está ativo para esta data.`,
      );
    }

    this.validateInput(input);

    // Impede duplicidade para o mesmo paciente/dia/período.
    const existing = await this.vitals.findByPatientDayPeriod(patient.id, today, input.period);
    if (existing) {
      throw new ConflictError(
        `Você já registrou as medições da ${input.period === Period.MORNING ? 'manhã' : 'noite'} de hoje.`,
      );
    }

    // Regra relativa de passos depende do dia anterior.
    const previousDaySteps =
      input.period === Period.NIGHT ? await this.vitals.previousNightSteps(patient.id, day) : null;

    const evaluation = evaluateVitalSigns(input, { previousDaySteps });

    const record = await this.vitals.create({
      patientId: patient.id,
      recordDate: today,
      period: input.period,
      monitoringDay: day,
      temperature: input.temperature,
      spo2: input.spo2,
      systolic: input.systolic,
      diastolic: input.diastolic,
      heartRate: input.heartRate,
      pain: input.pain,
      dyspnea: input.dyspnea,
      urinatedNormally: input.urinatedNormally,
      urinationCount: input.urinationCount ?? null,
      hadVomit: input.hadVomit,
      vomitCount: input.vomitCount ?? null,
      hadBleeding: input.hadBleeding,
      stepsCount: input.period === Period.NIGHT ? input.stepsCount ?? null : null,
      overallStatus: evaluation.overall,
      statusByVital: evaluation.byVital as Record<string, never>,
    });

    // Atualiza status do paciente e RESETA o atendimento (nova medição chegou).
    await this.patients.updateStatusAfterMeasurement(patient.id, evaluation.overall, new Date());
    await this.patients.setAttendance(patient.id, null, null);

    await this.audit.log({
      action: 'VITALS_SUBMIT',
      entityType: 'VitalSignRecord',
      entityId: record.id,
      metadata: { patientId: patient.id, day, period: input.period, status: evaluation.overall },
      ip,
    });

    // Dispara alerta apenas para amarelo/vermelho (verde não notifica).
    if (shouldAlert(evaluation.overall)) {
      await this.alerts.dispatch({
        patientId: patient.id,
        patientName: patient.name,
        teamId: patient.teamId,
        vitalSignRecordId: record.id,
        status: evaluation.overall,
      });
    }

    return { status: evaluation.overall, monitoringDay: day, period: input.period };
  }

  /** Validação autoritativa no servidor (nunca confiar só no frontend). */
  private validateInput(input: SubmitVitalSignsInput): void {
    range('Temperatura', input.temperature, INPUT_RANGES.temperature.min, INPUT_RANGES.temperature.max);
    range('Saturação', input.spo2, INPUT_RANGES.spo2.min, INPUT_RANGES.spo2.max);
    range('Pressão sistólica', input.systolic, INPUT_RANGES.systolic.min, INPUT_RANGES.systolic.max);
    range('Pressão diastólica', input.diastolic, INPUT_RANGES.diastolic.min, INPUT_RANGES.diastolic.max);
    range('Frequência cardíaca', input.heartRate, INPUT_RANGES.heartRate.min, INPUT_RANGES.heartRate.max);
    range('Nível de dor', input.pain, 0, 10);
    range('Dispneia', input.dyspnea, 0, 10);

    if (input.urinatedNormally && input.urinationCount != null && input.urinationCount <= 0) {
      throw new ValidationError('Informe um número de micções maior que zero.');
    }
    if (input.hadVomit && input.vomitCount != null && input.vomitCount <= 0) {
      throw new ValidationError('Informe um número de episódios de vômito maior que zero.');
    }
    if (input.period === Period.NIGHT && input.stepsCount != null && input.stepsCount < 0) {
      throw new ValidationError('O número de passos não pode ser negativo.');
    }
  }
}

function range(label: string, value: number, min: number, max: number): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`Informe um valor numérico para ${label}.`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${label} deve estar entre ${min} e ${max}.`);
  }
}
