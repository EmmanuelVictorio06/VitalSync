import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_OPTIONS, clinicalRuleFor, normalizeVitalRecord, triggerValueFor } from './alertTrigger';
import type { VitalSignRecord } from '../services/types';

/** Registro com tudo nulo; cada teste preenche só o que interessa. */
function record(overrides: Partial<VitalSignRecord> = {}): VitalSignRecord {
  return {
    id: 'r1',
    patient_id: 'p1',
    record_date: '2026-09-13',
    period: 'MORNING',
    monitoring_day: 1,
    temperature: null,
    oxygen_saturation: null,
    systolic_pressure: null,
    diastolic_pressure: null,
    heart_rate: null,
    pain_level: null,
    dyspnea_level: null,
    urination_count: null,
    urinated_normally: null,
    vomiting_count: null,
    had_vomit: null,
    has_bleeding: null,
    steps: null,
    water_intake_ok: null,
    noticed_wound_change: null,
    wound_photo_path: null,
    has_drain: null,
    drain_output_ml: null,
    drain_photo_path: null,
    clinical_status: 'RED',
    created_at: '2026-09-13T09:22:11Z',
    source: 'PATIENT',
    entered_by_profile_id: null,
    ...overrides,
  };
}

describe('triggerValueFor', () => {
  it('sem registro ou sem tipo devolve travessão', () => {
    expect(triggerValueFor('Temperatura', null)).toBe('—');
    expect(triggerValueFor(null, record({ temperature: 38.9 }))).toBe('—');
  });

  it('cobre as métricas que antes caíam no default e sumiam da tela', () => {
    expect(triggerValueFor('Pressão arterial', record({ systolic_pressure: 168, diastolic_pressure: 104 })))
      .toBe('168/104 mmHg');
    expect(triggerValueFor('Frequência cardíaca', record({ heart_rate: 118 }))).toBe('118 bpm');
    expect(triggerValueFor('Dispneia', record({ dyspnea_level: 2 }))).toBe('Moderada/Intensa');
    expect(triggerValueFor('Vômito', record({ had_vomit: true, vomiting_count: 3 }))).toBe('Sim (3 episódios)');
    expect(triggerValueFor('Diurese', record({ urination_count: 2 }))).toBe('2×');
    expect(triggerValueFor('Passos', record({ steps: 320 }))).toBe('320 passos');
    expect(triggerValueFor('Ingestão hídrica', record({ water_intake_ok: false }))).toBe('Abaixo do recomendado');
  });

  it('mantém o formato das métricas que já funcionavam', () => {
    expect(triggerValueFor('Temperatura', record({ temperature: 38.9 }))).toBe('38.9 °C');
    expect(triggerValueFor('Saturação', record({ oxygen_saturation: 90 }))).toBe('90%');
    expect(triggerValueFor('Dor', record({ pain_level: 8 }))).toBe('8/10');
    expect(triggerValueFor('Sangramento', record({ has_bleeding: true }))).toBe('Presente');
  });

  it('pressão arterial com só um dos valores ainda aparece', () => {
    expect(triggerValueFor('Pressão arterial', record({ systolic_pressure: 168 }))).toBe('168/— mmHg');
  });

  it('diurese sem contagem cai no Sim/Não de "urinou normalmente"', () => {
    expect(triggerValueFor('Diurese', record({ urinated_normally: false }))).toBe('Não urinou normalmente');
  });

  it('critério combinado lista as métricas informadas', () => {
    const v = triggerValueFor('Critério combinado', record({ steps: 300, heart_rate: 115 }));
    expect(v).toBe('Passos: 300 passos · Frequência cardíaca: 115 bpm');
  });

  it('métrica não informada devolve travessão em vez de texto vazio', () => {
    expect(triggerValueFor('Frequência cardíaca', record())).toBe('—');
    expect(triggerValueFor('Critério combinado', record())).toBe('—');
  });
});

describe('normalizeVitalRecord', () => {
  it('aceita objeto, array e vazio', () => {
    const r = record({ temperature: 38 });
    expect(normalizeVitalRecord(r)).toBe(r);
    expect(normalizeVitalRecord([r])).toBe(r);
    expect(normalizeVitalRecord([])).toBeNull();
    expect(normalizeVitalRecord(null)).toBeNull();
  });
});

describe('clinicalRuleFor', () => {
  it('diferencia vermelho de amarelo nas faixas com número', () => {
    expect(clinicalRuleFor('Temperatura', true)).toBe('Temperatura ≥ 38,5 °C');
    expect(clinicalRuleFor('Temperatura', false)).toBe('Temperatura ≥ 37,8 °C');
  });

  it('descreve as regras que antes caíam no genérico', () => {
    expect(clinicalRuleFor('Pressão arterial', true)).toBe('Pressão arterial fora da faixa de referência');
    expect(clinicalRuleFor('Vômito', true)).toBe('Vômito relatado');
    expect(clinicalRuleFor('Critério combinado', true)).toBe('Critérios combinados (protocolo 5.7.2/5.7.3)');
  });

  it('tipo desconhecido mantém o texto genérico', () => {
    expect(clinicalRuleFor('Sinais vitais', true)).toBe('Conjunto de sinais limítrofes');
    expect(clinicalRuleFor(null, false)).toBe('Conjunto de sinais limítrofes');
  });
});

/**
 * Rede de segurança contra a classe de bug que originou este módulo: uma opção
 * de filtro que o banco nunca produz, ou um tipo que o banco produz e a tela não
 * sabe traduzir. Ao acrescentar uma métrica ao `vtype` da RPC (0075), este teste
 * é o que cobra a atualização das duas funções e da lista de opções.
 */
describe('ALERT_TYPE_OPTIONS', () => {
  /** Medição com todas as métricas preenchidas — nenhum tipo pode dar "—". */
  const completo = record({
    temperature: 38.9,
    oxygen_saturation: 90,
    systolic_pressure: 168,
    diastolic_pressure: 104,
    heart_rate: 118,
    pain_level: 8,
    dyspnea_level: 2,
    urination_count: 2,
    had_vomit: true,
    vomiting_count: 3,
    has_bleeding: true,
    steps: 300,
    water_intake_ok: false,
  });

  it('todo tipo do filtro tem valor traduzido', () => {
    for (const tipo of ALERT_TYPE_OPTIONS) {
      expect(triggerValueFor(tipo, completo), `tipo sem valor: ${tipo}`).not.toBe('—');
    }
  });

  it('todo tipo do filtro tem regra própria, não a genérica', () => {
    for (const tipo of ALERT_TYPE_OPTIONS) {
      expect(clinicalRuleFor(tipo, true), `tipo sem regra: ${tipo}`).not.toBe('Conjunto de sinais limítrofes');
    }
  });

  it('não repete opções nem inclui o fallback GREEN', () => {
    expect(new Set(ALERT_TYPE_OPTIONS).size).toBe(ALERT_TYPE_OPTIONS.length);
    expect(ALERT_TYPE_OPTIONS).not.toContain('Sinais vitais');
  });
});
