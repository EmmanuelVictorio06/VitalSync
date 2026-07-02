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

describe('evaluateRange — dispneia (0-10)', () => {
  it('0 é GREEN', () => expect(evaluateRange(0, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.GREEN));
  it('1-5 é YELLOW', () => {
    expect(evaluateRange(1, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(3, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.YELLOW);
    expect(evaluateRange(5, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.YELLOW);
  });
  it('6-10 é RED', () => {
    expect(evaluateRange(6, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.RED);
    expect(evaluateRange(7, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.RED);
  });
});

describe('evaluateRange — pressão arterial sistólica (limiares PENDENTES — M-06)', () => {
  it('< 110,9 é GREEN', () => expect(evaluateRange(110, ALERT_THRESHOLDS.bloodPressure)).toBe(ClinicalStatus.GREEN));
  it('110,91-119,9 é YELLOW', () =>
    expect(evaluateRange(115, ALERT_THRESHOLDS.bloodPressure)).toBe(ClinicalStatus.YELLOW));
  it('> 119,9 é RED', () => expect(evaluateRange(130, ALERT_THRESHOLDS.bloodPressure)).toBe(ClinicalStatus.RED));
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

describe('evaluateVitalSigns — pressão arterial NUNCA decide o overall (M-06 pendente)', () => {
  it('PA em faixa RED do threshold provisório não eleva o overall se o resto for GREEN', () => {
    const result = evaluateVitalSigns({ ...baseInput, systolic: 130 });
    expect(result.overall).toBe(ClinicalStatus.GREEN);
    // BLOOD_PRESSURE aparece em byVital (para gráfico) mas não em `triggers`.
    expect(result.byVital[VitalKind.BLOOD_PRESSURE]).toBe(ClinicalStatus.RED);
    expect(result.triggers.some((t) => t.kind === VitalKind.BLOOD_PRESSURE)).toBe(false);
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
