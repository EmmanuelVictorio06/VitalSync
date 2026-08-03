/**
 * Validações por etapa (UX / prevenção de erro). Mensagens humanas e curtas,
 * exibidas próximo ao campo. A validação clínica autoritativa continua no
 * servidor (Edge Function); aqui só evitamos enviar dados obviamente inválidos.
 */
import { toNumber, type MeasurementErrors, type MeasurementFormState } from './types';

export interface InputRange {
  min: number;
  max: number;
  example: string;
  unit: string;
}
export type InputRanges = Record<
  'temperature' | 'spo2' | 'systolic' | 'diastolic' | 'heartRate' | 'steps',
  InputRange
>;

/** Faixas de entrada (UX). TODO: confirmar com a equipe médica. */
export const INPUT_RANGES: InputRanges = {
  temperature: { min: 34, max: 42, example: '36,5', unit: '°C' },
  spo2: { min: 70, max: 100, example: '98', unit: '%' },
  systolic: { min: 70, max: 220, example: '120', unit: 'mmHg' },
  diastolic: { min: 40, max: 140, example: '80', unit: 'mmHg' },
  heartRate: { min: 30, max: 200, example: '72', unit: 'bpm' },
  steps: { min: 0, max: 100000, example: '2000', unit: 'passos' },
};

/** Valida um campo numérico obrigatório: vazio, número inválido ou fora da faixa. */
function checkVital(value: string, range: InputRange, emptyMsg: string): string | undefined {
  if (!value.trim()) return emptyMsg;
  const n = toNumber(value);
  if (Number.isNaN(n)) return 'Informe um número válido.';
  if (n < range.min || n > range.max)
    return `Esse valor parece fora do comum. Confira: deve ficar entre ${range.min} e ${range.max} ${range.unit}.`;
  return undefined;
}

/** Etapa 1 — Sinais vitais: todos obrigatórios e dentro de faixas plausíveis. */
export function validateVitals(f: MeasurementFormState, ranges: InputRanges): MeasurementErrors {
  const e: MeasurementErrors = {};
  const temperature = checkVital(f.temperature, ranges.temperature, 'Informe sua temperatura.');
  if (temperature) e.temperature = temperature;
  const spo2 = checkVital(f.spo2, ranges.spo2, 'Informe sua saturação de oxigênio.');
  if (spo2) e.spo2 = spo2;
  const systolic = checkVital(f.systolic, ranges.systolic, 'Informe a pressão sistólica.');
  if (systolic) e.systolic = systolic;
  const diastolic = checkVital(f.diastolic, ranges.diastolic, 'Informe a pressão diastólica.');
  if (diastolic) e.diastolic = diastolic;
  const heartRate = checkVital(f.heartRate, ranges.heartRate, 'Informe sua frequência cardíaca.');
  if (heartRate) e.heartRate = heartRate;
  return e;
}

/** Etapa 2 — Sintomas: dor, dispneia, hídrica e as perguntas Sim/Não. Diurese só à noite. */
export function validateSymptoms(f: MeasurementFormState, isNight: boolean): MeasurementErrors {
  const e: MeasurementErrors = {};
  if (f.pain === null) e.pain = 'Selecione seu nível de dor.';
  if (f.dyspnea === null) e.dyspnea = 'Selecione seu nível de falta de ar.';
  if (f.waterIntakeOk === null) e.waterIntakeOk = 'Informe se está conseguindo tomar líquidos normalmente.';
  if (isNight && f.urinatedNormally === null) e.urinatedNormally = 'Selecione se você urinou normalmente.';
  if (f.hadVomit === null) e.hadVomit = 'Informe se teve episódios de vômito.';
  if (f.hadBleeding === null) e.hadBleeding = 'Informe se observou sangramento.';
  return e;
}

/**
 * Etapa 3 — Fotos.
 *  Noite: pergunta do dreno + foto da cicatriz obrigatória (+ dreno/débito se houver).
 *  Manhã: só pergunta se notou algo diferente na cicatriz; a foto é SEMPRE opcional.
 */
export function validatePhotos(f: MeasurementFormState, isNight: boolean): MeasurementErrors {
  const e: MeasurementErrors = {};
  if (!isNight) {
    if (f.noticedWoundChange === null) {
      e.noticedWoundChange = 'Informe se notou algo diferente na cicatriz ao acordar.';
    }
    return e;
  }
  if (f.hasDrain === null) e.hasDrain = 'Informe se você possui dreno.';
  if (!f.woundPhoto) e.woundPhoto = 'Envie a foto da cicatriz operatória.';
  if (f.hasDrain) {
    if (!f.drainPhoto) e.drainPhoto = 'Envie a foto do dreno.';
    const ml = f.drainOutputMl.trim() ? Number(f.drainOutputMl.replace(',', '.')) : NaN;
    if (f.drainOutputMl.trim() === '' || Number.isNaN(ml) || ml < 0) {
      e.drainOutputMl = 'Informe o débito do dreno em ml.';
    }
  }
  return e;
}
