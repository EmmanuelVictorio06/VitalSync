import { describe, it, expect } from 'vitest';
import {
  evaluateRange,
  evaluateDiuresis,
  evaluateSteps,
  worstStatus,
  evaluateVitalSigns,
  shouldAlert,
} from './status.js';
import { ALERT_THRESHOLDS } from './thresholds.js';
import { ClinicalStatus, VitalKind, type VitalSignInput } from '../types.js';

/** Medição "saudável" de base — cada teste sobrescreve só o campo que interessa. */
const baseInput: VitalSignInput = {
  temperature: 36.5,
  spo2: 98,
  systolic: 110,
  diastolic: 70,
  heartRate: 80,
  pain: 0,
  dyspnea: 0,
  urinatedNormally: true,
  urinationCount: 4,
  hadVomit: false,
  hadBleeding: false,
};

describe('evaluateRange — temperatura', () => {
  it('< 37,8 é GREEN', () => {
    expect(evaluateRange(37.5, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.GREEN);
    expect(evaluateRange(37.79, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.GREEN);
  });
  it('37,8–38,4 é YELLOW', () => {
    expect(evaluateRange(37.8, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(38.0, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(38.4, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.YELLOW);
  });
  it('>= 38,5 é RED', () => {
    expect(evaluateRange(38.5, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.RED);
    expect(evaluateRange(40, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.RED);
  });
});

describe('evaluateRange — SpO2', () => {
  it('> 94 é GREEN', () => {
    expect(evaluateRange(96, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.GREEN);
    expect(evaluateRange(94.01, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.GREEN);
  });
  it('92,1–94 é YELLOW', () => {
    expect(evaluateRange(93, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(94, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(92.1, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.YELLOW);
  });
  it('<= 92 é RED', () => {
    expect(evaluateRange(90, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.RED);
    expect(evaluateRange(92, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.RED);
  });
});

describe('evaluateRange — frequência cardíaca', () => {
  it('<= 110 é GREEN', () => {
    expect(evaluateRange(100, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.GREEN);
    expect(evaluateRange(110, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.GREEN);
  });
  it('111–119 é YELLOW', () => {
    expect(evaluateRange(111, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(115, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(119, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.YELLOW);
  });
  it('>= 120 é RED', () => {
    expect(evaluateRange(120, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.RED);
    expect(evaluateRange(125, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.RED);
  });
});

describe('evaluateRange — dor (0-10)', () => {
  it('0-6 é GREEN', () => {
    expect(evaluateRange(0, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.GREEN);
    expect(evaluateRange(6, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.GREEN);
  });
  it('7-8 é YELLOW', () => {
    expect(evaluateRange(7, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(8, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.YELLOW);
  });
  it('9-10 é RED', () => {
    expect(evaluateRange(9, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.RED);
    expect(evaluateRange(10, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.RED);
  });
});

describe('evaluateRange — dispneia (3 níveis)', () => {
  it('0 (sem dispneia) é GREEN', () => expect(evaluateRange(0, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.GREEN));
  it('1 (leve) é YELLOW', () => expect(evaluateRange(1, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.YELLOW));
  it('2 (moderada/intensa) é RED', () => expect(evaluateRange(2, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — pressão arterial sistólica (confirmado ago/2026)', () => {
  it('≤89 é RED', () => expect(evaluateRange(89, ALERT_THRESHOLDS.bloodPressureSystolic)).toBe(ClinicalStatus.RED));
  it('90-99 é YELLOW', () =>
    expect(evaluateRange(95, ALERT_THRESHOLDS.bloodPressureSystolic)).toBe(ClinicalStatus.YELLOW));
  it('100-129 é GREEN', () =>
    expect(evaluateRange(120, ALERT_THRESHOLDS.bloodPressureSystolic)).toBe(ClinicalStatus.GREEN));
  it('130-139 é YELLOW', () =>
    expect(evaluateRange(135, ALERT_THRESHOLDS.bloodPressureSystolic)).toBe(ClinicalStatus.YELLOW));
  it('≥140 é RED', () => expect(evaluateRange(145, ALERT_THRESHOLDS.bloodPressureSystolic)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — pressão arterial diastólica (confirmado ago/2026)', () => {
  it('≤49 é RED', () => expect(evaluateRange(48, ALERT_THRESHOLDS.bloodPressureDiastolic)).toBe(ClinicalStatus.RED));
  it('50-59 é YELLOW', () =>
    expect(evaluateRange(55, ALERT_THRESHOLDS.bloodPressureDiastolic)).toBe(ClinicalStatus.YELLOW));
  it('60-89 é GREEN', () =>
    expect(evaluateRange(80, ALERT_THRESHOLDS.bloodPressureDiastolic)).toBe(ClinicalStatus.GREEN));
  it('90-99 é YELLOW', () =>
    expect(evaluateRange(92, ALERT_THRESHOLDS.bloodPressureDiastolic)).toBe(ClinicalStatus.YELLOW));
  it('≥100 é RED', () => expect(evaluateRange(100, ALERT_THRESHOLDS.bloodPressureDiastolic)).toBe(ClinicalStatus.RED));
});

describe('evaluateDiuresis', () => {
  it('contagem >= 4 é GREEN', () => expect(evaluateDiuresis(true, 4)).toBe(ClinicalStatus.GREEN));
  it('contagem 2-3 é YELLOW', () => {
    expect(evaluateDiuresis(true, 2)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateDiuresis(true, 3)).toBe(ClinicalStatus.YELLOW);
  });
  it('contagem < 2 é RED', () => {
    expect(evaluateDiuresis(true, 1)).toBe(ClinicalStatus.RED);
    expect(evaluateDiuresis(true, 0)).toBe(ClinicalStatus.RED);
  });
  it('sem contagem, urinou normalmente = GREEN (M-01: não pode virar YELLOW)', () =>
    expect(evaluateDiuresis(true, null)).toBe(ClinicalStatus.GREEN));
  it('sem contagem, não urinou normalmente = YELLOW', () =>
    expect(evaluateDiuresis(false, null)).toBe(ClinicalStatus.YELLOW));
  it('contagem undefined segue a mesma regra que null', () =>
    expect(evaluateDiuresis(true, undefined)).toBe(ClinicalStatus.GREEN));
});

describe('evaluateSteps', () => {
  it('sem dia anterior (ou dia anterior zerado) é GREEN', () => {
    expect(evaluateSteps(100, null)).toBe(ClinicalStatus.GREEN);
    expect(evaluateSteps(100, undefined)).toBe(ClinicalStatus.GREEN);
    expect(evaluateSteps(100, 0)).toBe(ClinicalStatus.GREEN);
  });
  it('redução < 25% é GREEN', () => expect(evaluateSteps(800, 1000)).toBe(ClinicalStatus.GREEN));
  it('redução >= 25% é YELLOW', () => expect(evaluateSteps(750, 1000)).toBe(ClinicalStatus.YELLOW));
  it('redução >= 50% é RED', () => {
    expect(evaluateSteps(500, 1000)).toBe(ClinicalStatus.RED);
    expect(evaluateSteps(400, 1000)).toBe(ClinicalStatus.RED);
  });
});

describe('worstStatus', () => {
  it('retorna o pior entre vários', () =>
    expect(worstStatus([ClinicalStatus.GREEN, ClinicalStatus.RED, ClinicalStatus.YELLOW])).toBe(
      ClinicalStatus.RED,
    ));
  it('retorna YELLOW quando não há RED', () =>
    expect(worstStatus([ClinicalStatus.GREEN, ClinicalStatus.YELLOW])).toBe(ClinicalStatus.YELLOW));
  it('lista vazia é GREEN', () => expect(worstStatus([])).toBe(ClinicalStatus.GREEN));
});

describe('evaluateVitalSigns — pressão arterial (sistólica+diastólica, pior status) decide o overall', () => {
  it('120×80 é GREEN', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 120, diastolic: 80 });
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.GREEN);
    expect(result.overall).toBe(ClinicalStatus.GREEN);
  });
  it('135×92 é YELLOW', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 135, diastolic: 92 });
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.YELLOW);
    expect(result.overall).toBe(ClinicalStatus.YELLOW);
  });
  it('145×85 é RED (sistólica crítica, mesmo com diastólica em faixa verde)', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 145, diastolic: 85 });
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.RED);
    expect(result.overall).toBe(ClinicalStatus.RED);
  });
  it('95×55 é YELLOW', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 95, diastolic: 55 });
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.YELLOW);
    expect(result.overall).toBe(ClinicalStatus.YELLOW);
  });
  it('88×48 é RED', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 88, diastolic: 48 });
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.RED);
    expect(result.overall).toBe(ClinicalStatus.RED);
  });
  it('PA em RED entra em `triggers`', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 145, diastolic: 85 });
    expect(result.triggers.some((t) => t.kind === VitalKind.BLOOD_PRESSURE)).toBe(true);
  });
});

describe('evaluateVitalSigns — ingestão hídrica', () => {
  it('waterIntakeOk = false gera YELLOW e entra em triggers', () => {
    const result = evaluateVitalSigns({ ...baseInput, waterIntakeOk: false });
    expect(result.byVital[VitalKind.WATER_INTAKE]).toBe(ClinicalStatus.YELLOW);
    expect(result.overall).toBe(ClinicalStatus.YELLOW);
    expect(result.triggers.some((t) => t.kind === VitalKind.WATER_INTAKE)).toBe(true);
  });
  it('waterIntakeOk = true é GREEN', () => {
    const result = evaluateVitalSigns({ ...baseInput, waterIntakeOk: true });
    expect(result.byVital[VitalKind.WATER_INTAKE]).toBe(ClinicalStatus.GREEN);
  });
  it('waterIntakeOk ausente/null não aparece em byVital nem eleva o overall', () => {
    const result = evaluateVitalSigns(baseInput);
    expect(result.byVital[VitalKind.WATER_INTAKE]).toBeUndefined();
    expect(result.overall).toBe(ClinicalStatus.GREEN);
  });
});

describe('evaluateVitalSigns — vômito e sangramento disparam RED', () => {
  it('vômito = true gera overall RED mesmo com resto GREEN', () => {
    const result = evaluateVitalSigns({ ...baseInput, hadVomit: true });
    expect(result.overall).toBe(ClinicalStatus.RED);
    expect(result.triggers.some((t) => t.kind === VitalKind.VOMIT)).toBe(true);
  });
  it('sangramento = true gera overall RED mesmo com resto GREEN', () => {
    const result = evaluateVitalSigns({ ...baseInput, hadBleeding: true });
    expect(result.overall).toBe(ClinicalStatus.RED);
    expect(result.triggers.some((t) => t.kind === VitalKind.BLEEDING)).toBe(true);
  });
});

describe('evaluateVitalSigns — medição totalmente normal', () => {
  it('é GREEN e sem nenhum trigger', () => {
    const result = evaluateVitalSigns(baseInput);
    expect(result.overall).toBe(ClinicalStatus.GREEN);
    expect(result.triggers).toHaveLength(0);
  });
});

describe('evaluateVitalSigns — passos (contexto do dia anterior)', () => {
  it('redução de 50% nos passos eleva o overall a RED e entra em triggers', () => {
    const result = evaluateVitalSigns({ ...baseInput, stepsCount: 400 }, { previousDaySteps: 1000 });
    expect(result.overall).toBe(ClinicalStatus.RED);
    expect(result.triggers.some((t) => t.kind === VitalKind.STEPS)).toBe(true);
  });
  it('sem stepsCount informado, STEPS nem aparece em byVital', () => {
    const result = evaluateVitalSigns(baseInput);
    expect(result.byVital[VitalKind.STEPS]).toBeUndefined();
  });
});

describe('shouldAlert', () => {
  it('GREEN não alerta', () => expect(shouldAlert(ClinicalStatus.GREEN)).toBe(false));
  it('YELLOW e RED alertam', () => {
    expect(shouldAlert(ClinicalStatus.YELLOW)).toBe(true);
    expect(shouldAlert(ClinicalStatus.RED)).toBe(true);
  });
});
