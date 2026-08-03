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
  WATER_INTAKE_RULE,
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

/**
 * Passos: regra relativa a uma referência de ~48h atrás (protocolo do estudo).
 * Não há mais vermelho isolado — queda ≥50% é amarelo; o vermelho só existe
 * combinado com outro critério (ver `evaluateVitalSigns`).
 */
export function evaluateSteps(steps: number, reference48h?: number | null): ClinicalStatus {
  if (reference48h == null || reference48h <= 0) {
    // Sem referência não há como medir redução — status verde.
    return ClinicalStatus.GREEN;
  }
  const reduction = (reference48h - steps) / reference48h;
  if (reduction >= STEPS_RULES.yellowReductionPct) return ClinicalStatus.YELLOW;
  return ClinicalStatus.GREEN;
}

/** true quando a queda de passos vs. a referência de 48h já atinge o corte (≥50%). */
function stepsSevereDrop(steps: number | null | undefined, reference48h: number | null | undefined): boolean {
  if (steps == null || reference48h == null || reference48h <= 0) return false;
  return (reference48h - steps) / reference48h >= STEPS_RULES.yellowReductionPct;
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
 * @param context dados contextuais necessários para regras relativas/combinadas:
 *   `previousDaySteps` é a referência de passos de ~48h atrás (não o dia
 *   anterior — nome mantido por compatibilidade com o backend legado) e
 *   `previousPain` é a dor da medição anterior (critério combinado de +3 pontos).
 */
export function evaluateVitalSigns(
  input: VitalSignInput,
  context: { previousDaySteps?: number | null; previousPain?: number | null } = {},
): StatusEvaluation {
  const byVital: Partial<Record<VitalKind, ClinicalStatus>> = {};

  byVital[VitalKind.TEMPERATURE] = evaluateRange(input.temperature, ALERT_THRESHOLDS.temperature);
  byVital[VitalKind.SPO2] = evaluateRange(input.spo2, ALERT_THRESHOLDS.spo2);
  // PA: sistólica e diastólica avaliadas separadamente; vale o pior status entre as duas.
  byVital[VitalKind.BLOOD_PRESSURE] = worstStatus([
    evaluateRange(input.systolic, ALERT_THRESHOLDS.bloodPressureSystolic),
    evaluateRange(input.diastolic, ALERT_THRESHOLDS.bloodPressureDiastolic),
  ]);
  byVital[VitalKind.HEART_RATE] = evaluateRange(input.heartRate, ALERT_THRESHOLDS.heartRate);
  byVital[VitalKind.PAIN] = evaluateRange(input.pain, ALERT_THRESHOLDS.pain);
  byVital[VitalKind.DYSPNEA] = evaluateRange(input.dyspnea, ALERT_THRESHOLDS.dyspnea);
  byVital[VitalKind.DIURESIS] = evaluateDiuresis(input.urinatedNormally, input.urinationCount);
  byVital[VitalKind.VOMIT] = input.hadVomit ? BINARY_RULES.vomit.yesStatus : BINARY_RULES.vomit.noStatus;
  byVital[VitalKind.BLEEDING] = input.hadBleeding
    ? BINARY_RULES.bleeding.yesStatus
    : BINARY_RULES.bleeding.noStatus;
  if (input.waterIntakeOk != null) {
    byVital[VitalKind.WATER_INTAKE] = input.waterIntakeOk
      ? WATER_INTAKE_RULE.okStatus
      : WATER_INTAKE_RULE.notOkStatus;
  }

  if (input.stepsCount != null) {
    byVital[VitalKind.STEPS] = evaluateSteps(input.stepsCount, context.previousDaySteps);
  }

  // Critérios COMBINADOS do protocolo (5.7.2/5.7.3) — elevam a VERMELHO mesmo
  // quando nenhum sinal isolado chegaria lá sozinho.
  const severeStepsDrop = stepsSevereDrop(input.stepsCount, context.previousDaySteps);
  const heartRateOver110 = input.heartRate > 110;
  const heartRateAtLeast110 = input.heartRate >= 110;
  const painIncreased3Plus =
    context.previousPain != null && input.pain - context.previousPain >= 3;
  const diuresis2to3 =
    input.urinationCount != null && input.urinationCount >= 2 && input.urinationCount <= 3;
  const spo2At92OrBelow = input.spo2 <= 92;
  const temperatureAt38OrAbove = input.temperature >= 38;

  const combinedStepsRed = severeStepsDrop && (heartRateOver110 || painIncreased3Plus);
  const combinedDiuresisRed =
    diuresis2to3 && (heartRateAtLeast110 || spo2At92OrBelow || temperatureAt38OrAbove || severeStepsDrop);

  if (combinedStepsRed || combinedDiuresisRed) {
    byVital[VitalKind.COMBINED_CRITERIA] = ClinicalStatus.RED;
  }

  // Pressão arterial agora entra normalmente no disparo/`overall` — confirmado
  // pela equipe médica (ago/2026), substitui a exclusão anterior (M-06).
  const driving = Object.entries(byVital) as Array<[VitalKind, ClinicalStatus]>;

  const triggers = driving
    .filter(([, status]) => status !== ClinicalStatus.GREEN)
    .map(([kind, status]) => ({ kind, status }));

  const overall = worstStatus(driving.map(([, status]) => status));

  const yellowTriggers = triggers.filter((t) => t.status === ClinicalStatus.YELLOW);
  const yellowCriteriaCount = yellowTriggers.length;
  const onlyYellowTrigger = yellowCriteriaCount === 1 ? yellowTriggers[0] : undefined;
  const isolatedByStepsOrDiuresis =
    onlyYellowTrigger?.kind === VitalKind.STEPS || onlyYellowTrigger?.kind === VitalKind.DIURESIS;

  return { overall, byVital, triggers, yellowCriteriaCount, isolatedByStepsOrDiuresis };
}

/** true se o status exige envio de alerta para a equipe (amarelo ou vermelho). */
export function shouldAlert(status: ClinicalStatus): boolean {
  return status === ClinicalStatus.YELLOW || status === ClinicalStatus.RED;
}
