/**
 * Motor de cálculo de status clínico (semáforo).
 * Função PURA, sem dependência de framework/banco — pode rodar no backend
 * (ao registrar a medição) e no frontend (para pré-visualizar), garantindo
 * resultado idêntico nas duas pontas.
 */

import {
  ClinicalStatus,
  STATUS_SEVERITY,
  VitalKind,
  type StatusEvaluation,
  type VitalSignInput,
} from '../types.js';
import {
  ALERT_THRESHOLDS,
  BINARY_RULES,
  STEPS_RULES,
  type RangeRule,
  type VitalThreshold,
} from './thresholds.js';

/** Avalia um valor numérico contra um conjunto de regras de faixa. */
export function evaluateRange(value: number, threshold: VitalThreshold): ClinicalStatus {
  const matched = threshold.rules.find((rule: RangeRule) => {
    const okMin = rule.min === undefined || value >= rule.min;
    const okMax = rule.max === undefined || value <= rule.max;
    return okMin && okMax;
  });
  // Sem regra correspondente: tratamos como verde (valor fora das faixas de alerta).
  return matched?.status ?? ClinicalStatus.GREEN;
}

/** Diurese: usa a contagem de micções quando informada; senão, infere por "urinou normalmente". */
export function evaluateDiuresis(urinatedNormally: boolean, urinationCount?: number | null): ClinicalStatus {
  if (urinationCount != null) {
    return evaluateRange(urinationCount, ALERT_THRESHOLDS.diuresis);
  }
  // Sem contagem: "não urinou normalmente" é tratado como atenção (amarelo).
  return urinatedNormally ? ClinicalStatus.GREEN : ClinicalStatus.YELLOW;
}

/** Passos: regra relativa ao dia anterior. */
export function evaluateSteps(steps: number, previousDaySteps?: number | null): ClinicalStatus {
  if (previousDaySteps == null || previousDaySteps <= 0) {
    // Sem referência anterior não há como medir redução — status verde.
    return ClinicalStatus.GREEN;
  }
  const reduction = (previousDaySteps - steps) / previousDaySteps;
  if (reduction >= STEPS_RULES.redReductionPct) return ClinicalStatus.RED;
  if (reduction >= STEPS_RULES.yellowReductionPct) return ClinicalStatus.YELLOW;
  return ClinicalStatus.GREEN;
}

/** Pega o pior status entre vários (reduz a um status geral). */
export function worstStatus(statuses: ClinicalStatus[]): ClinicalStatus {
  return statuses.reduce<ClinicalStatus>((acc, s) => {
    return STATUS_SEVERITY[s] > STATUS_SEVERITY[acc] ? s : acc;
  }, ClinicalStatus.GREEN);
}

/**
 * Avalia uma medição completa e devolve o status por dimensão + status geral.
 *
 * @param input  medição enviada pelo paciente
 * @param context dados contextuais necessários para regras relativas (ex.: passos do dia anterior)
 */
export function evaluateVitalSigns(
  input: VitalSignInput,
  context: { previousDaySteps?: number | null } = {},
): StatusEvaluation {
  const byVital: Partial<Record<VitalKind, ClinicalStatus>> = {};

  byVital[VitalKind.TEMPERATURE] = evaluateRange(input.temperature, ALERT_THRESHOLDS.temperature);
  byVital[VitalKind.SPO2] = evaluateRange(input.spo2, ALERT_THRESHOLDS.spo2);
  byVital[VitalKind.BLOOD_PRESSURE] = evaluateRange(input.systolic, ALERT_THRESHOLDS.bloodPressure);
  byVital[VitalKind.HEART_RATE] = evaluateRange(input.heartRate, ALERT_THRESHOLDS.heartRate);
  byVital[VitalKind.PAIN] = evaluateRange(input.pain, ALERT_THRESHOLDS.pain);
  byVital[VitalKind.DYSPNEA] = evaluateRange(input.dyspnea, ALERT_THRESHOLDS.dyspnea);
  byVital[VitalKind.DIURESIS] = evaluateDiuresis(input.urinatedNormally, input.urinationCount);
  byVital[VitalKind.VOMIT] = input.hadVomit ? BINARY_RULES.vomit.yesStatus : BINARY_RULES.vomit.noStatus;
  byVital[VitalKind.BLEEDING] = input.hadBleeding
    ? BINARY_RULES.bleeding.yesStatus
    : BINARY_RULES.bleeding.noStatus;

  if (input.stepsCount != null) {
    byVital[VitalKind.STEPS] = evaluateSteps(input.stepsCount, context.previousDaySteps);
  }

  const triggers = (Object.entries(byVital) as Array<[VitalKind, ClinicalStatus]>)
    .filter(([, status]) => status !== ClinicalStatus.GREEN)
    .map(([kind, status]) => ({ kind, status }));

  const overall = worstStatus(Object.values(byVital));

  return { overall, byVital, triggers };
}

/** true se o status exige envio de alerta para a equipe (amarelo ou vermelho). */
export function shouldAlert(status: ClinicalStatus): boolean {
  return status === ClinicalStatus.YELLOW || status === ClinicalStatus.RED;
}
