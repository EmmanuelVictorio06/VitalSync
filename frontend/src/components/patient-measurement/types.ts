/**
 * Tipos e constantes compartilhadas do wizard de medição do paciente.
 *
 * O estado do formulário é único e vive no Wizard; cada etapa enxerga só os
 * campos que lhe cabem. `MeasurementErrors` carrega erros por campo (validação
 * local ao avançar de etapa), exibidos próximo do campo problemático.
 */
import { Period } from '@vitalsync/shared';

/** As 4 etapas do fluxo. */
export type MeasurementStep = 1 | 2 | 3 | 4;

export const STEP_COUNT = 4;

export const STEP_LABELS: Record<MeasurementStep, string> = {
  1: 'Sinais vitais',
  2: 'Sintomas',
  3: 'Fotos',
  4: 'Revisão',
};

/** Fundo suave (cinza muito claro → azul muito claro), igual ao cadastro de profissional. */
export const GRADIENT_BG: React.CSSProperties = {
  background: 'linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%)',
};

/** Dados do paciente exibidos no cabeçalho e no resumo (sem dados sensíveis). */
export interface MeasurementPatient {
  id: string;
  name: string;
  age: number | null;
  surgeryDate: string | null;
  dischargeDate: string | null;
  monitoringDay: number | null;
}

/** Estado único do formulário de medição (mantido no Wizard). */
export interface MeasurementFormState {
  temperature: string;
  spo2: string;
  systolic: string;
  diastolic: string;
  heartRate: string;
  pain: number | null;
  /** 0 = sem dispneia, 1 = leve, 2 = moderada/intensa. */
  dyspnea: number | null;
  /** Ingestão hídrica: consegue tomar líquidos normalmente? (manhã e noite) */
  waterIntakeOk: boolean | null;
  /** Diurese — só perguntada à noite. */
  urinatedNormally: boolean | null;
  urinationCount: string;
  hadVomit: boolean | null;
  vomitCount: string;
  hadBleeding: boolean | null;
  steps: string;
  /** Dreno — só perguntado à noite. */
  hasDrain: boolean | null;
  /** Débito do dreno (ml) — só quando hasDrain = true, à noite. */
  drainOutputMl: string;
  woundPhoto: File | null;
  drainPhoto: File | null;
  /** Manhã: paciente notou algo diferente na cicatriz ao acordar? */
  noticedWoundChange: boolean | null;
}

export type MeasurementErrors = Partial<Record<keyof MeasurementFormState, string>>;

export const EMPTY_FORM: MeasurementFormState = {
  temperature: '',
  spo2: '',
  systolic: '',
  diastolic: '',
  heartRate: '',
  pain: null,
  dyspnea: null,
  waterIntakeOk: null,
  urinatedNormally: null,
  urinationCount: '',
  hadVomit: null,
  vomitCount: '',
  hadBleeding: null,
  steps: '',
  hasDrain: null,
  drainOutputMl: '',
  woundPhoto: null,
  drainPhoto: null,
  noticedWoundChange: null,
};

/** Converte texto com vírgula/decimal em número. */
export function toNumber(v: string): number {
  return Number(v.replace(',', '.'));
}

/** Rótulo curto do período (badge). */
export function periodLabel(period: Period): string {
  return period === Period.MORNING ? 'Manhã' : 'Noite';
}
