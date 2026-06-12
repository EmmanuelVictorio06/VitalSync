/**
 * ============================================================================
 *  REGRAS CLÍNICAS CENTRALIZADAS — VitalSync
 * ============================================================================
 *
 * Fonte: documento "Projeto do App" (especificação clínica).
 *
 * >>> PONTO DE MANUTENÇÃO ÚNICO <<<
 * Todo valor clínico do sistema (faixas de validação de entrada e limiares de
 * alerta verde/amarelo/vermelho) está concentrado neste arquivo. Para ajustar
 * uma regra clínica, altere APENAS aqui — backend, frontend e gráficos leem
 * destas constantes. Isso atende ao requisito de "regras clínicas facilmente
 * alteráveis" e ao princípio de baixo acoplamento.
 *
 * ⚠️ PENDENTE DE VALIDAÇÃO MÉDICA
 * Os campos marcados com `PENDING_MEDICAL_VALIDATION = true` usam valores
 * PROVISÓRIOS porque o documento indica "*Letícia irá confirmar os valores".
 * NÃO foram inventados limiares finais: onde o documento não definiu faixa de
 * entrada, deixamos uma faixa segura ampla e sinalizada. Reveja antes de uso
 * clínico real.
 */

import { ClinicalStatus } from '../types.js';

/** Marca um conjunto de regras como provisório, aguardando confirmação médica. */
export interface PendingFlag {
  /** true = valores ainda não confirmados clinicamente. */
  PENDING_MEDICAL_VALIDATION: boolean;
  /** Observação curta exibível em logs/UI para sinalizar a pendência. */
  pendingNote?: string;
}

/** Faixa fechada [min, max] permitida na ENTRADA de dados (validação do form). */
export interface InputRange extends PendingFlag {
  min: number;
  max: number;
  /** Texto de exemplo (placeholder) exibido no campo. */
  example: string;
  /** Unidade exibida ao lado do campo. */
  unit: string;
}

// ---------------------------------------------------------------------------
// 1. FAIXAS DE VALIDAÇÃO DE ENTRADA (tela de Registro de Sinais Vitais)
// ---------------------------------------------------------------------------

export const INPUT_RANGES = {
  /** Temperatura: documento define 34 a 43 °C. */
  temperature: {
    min: 34,
    max: 43,
    example: 'Ex. 36,5',
    unit: '°C',
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies InputRange,

  /** Saturação: documento define 93 a 100 %. */
  spo2: {
    min: 93,
    max: 100,
    example: 'Ex. 98',
    unit: '%SpO2',
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies InputRange,

  /** Sistólica: documento marca "*******" — PENDENTE. Faixa provisória ampla. */
  systolic: {
    min: 50,
    max: 260,
    example: 'Ex. 120',
    unit: 'mmHg',
    PENDING_MEDICAL_VALIDATION: true,
    pendingNote: 'Faixa de entrada da pressão sistólica aguardando confirmação médica.',
  } satisfies InputRange,

  /** Diastólica: documento marca "*******" — PENDENTE. Faixa provisória ampla. */
  diastolic: {
    min: 30,
    max: 160,
    example: 'Ex. 80',
    unit: 'mmHg',
    PENDING_MEDICAL_VALIDATION: true,
    pendingNote: 'Faixa de entrada da pressão diastólica aguardando confirmação médica.',
  } satisfies InputRange,

  /** Frequência cardíaca: documento marca "*******" — PENDENTE. Faixa provisória. */
  heartRate: {
    min: 30,
    max: 220,
    example: 'Ex. 71',
    unit: 'bpm',
    PENDING_MEDICAL_VALIDATION: true,
    pendingNote: 'Faixa de entrada da frequência cardíaca aguardando confirmação médica.',
  } satisfies InputRange,

  /** Passos: somente números, sem teto clínico definido. */
  steps: {
    min: 0,
    max: 100000,
    example: 'Ex. 1000',
    unit: 'passos',
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies InputRange,
} as const;

// ---------------------------------------------------------------------------
// 2. LIMIARES DE ALERTA (semáforo) — usados no cálculo de status e nos gráficos
// ---------------------------------------------------------------------------

/**
 * Limiares por faixa numérica simples. Cada item define o status para uma
 * comparação. A função de status percorre as regras na ordem dada.
 */
export interface RangeRule {
  status: ClinicalStatus;
  /** valor >= min (se definido) E valor <= max (se definido). Limites inclusivos. */
  min?: number;
  max?: number;
}

export interface VitalThreshold extends PendingFlag {
  /** Rótulo amigável da dimensão. */
  label: string;
  /** Domínio do eixo Y sugerido para o gráfico [min, max]. */
  axis: { min: number; max: number; step?: number };
  rules: RangeRule[];
}

export const ALERT_THRESHOLDS = {
  /**
   * TEMPERATURA (°C):
   *  Verde   < 37,8
   *  Amarelo 37,8 – 38,4
   *  Vermelho ≥ 38,5
   */
  temperature: {
    label: 'Temperatura',
    axis: { min: 35, max: 42, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, max: 37.79 },
      { status: ClinicalStatus.YELLOW, min: 37.8, max: 38.4 },
      { status: ClinicalStatus.RED, min: 38.5 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * SATURAÇÃO SpO2 (%):
   *  Verde   > 94
   *  Amarelo 92,1 – 94
   *  Vermelho ≤ 92
   */
  spo2: {
    label: 'Saturação (SpO2)',
    axis: { min: 91, max: 100, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, min: 94.01 },
      { status: ClinicalStatus.YELLOW, min: 92.1, max: 94 },
      { status: ClinicalStatus.RED, max: 92 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * PRESSÃO ARTERIAL — avaliada pela SISTÓLICA (mmHg):
   *  Verde   < 110,9
   *  Amarelo > 110,9 e < 119,9
   *  Vermelho > 119,9
   *  ⚠️ "*Letícia irá confirmar os valores." — PENDENTE.
   */
  bloodPressure: {
    label: 'Pressão arterial (sistólica)',
    axis: { min: 40, max: 200, step: 20 },
    rules: [
      { status: ClinicalStatus.GREEN, max: 110.9 },
      { status: ClinicalStatus.YELLOW, min: 110.91, max: 119.9 },
      { status: ClinicalStatus.RED, min: 119.91 },
    ],
    PENDING_MEDICAL_VALIDATION: true,
    pendingNote: 'Limiares de alerta da pressão arterial aguardando confirmação médica (Letícia).',
  } satisfies VitalThreshold,

  /**
   * FREQUÊNCIA CARDÍACA (bpm):
   *  Verde   ≤ 110
   *  Amarelo 111 – 119
   *  Vermelho ≥ 120
   */
  heartRate: {
    label: 'Frequência cardíaca',
    axis: { min: 60, max: 130, step: 10 },
    rules: [
      { status: ClinicalStatus.GREEN, max: 110 },
      { status: ClinicalStatus.YELLOW, min: 111, max: 119 },
      { status: ClinicalStatus.RED, min: 120 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * DIURESE (micções/dia):
   *  Verde   ≥ 4
   *  Amarelo 2 – 3
   *  Vermelho < 2
   */
  diuresis: {
    label: 'Diurese (micções/dia)',
    axis: { min: 0, max: 10, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, min: 4 },
      { status: ClinicalStatus.YELLOW, min: 2, max: 3 },
      { status: ClinicalStatus.RED, max: 1 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * ESCALA DE DOR (0–10):
   *  Verde   0 – 6
   *  Amarelo 7 – 8
   *  Vermelho > 8 (9–10)
   */
  pain: {
    label: 'Dor',
    axis: { min: 0, max: 10, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, min: 0, max: 6 },
      { status: ClinicalStatus.YELLOW, min: 7, max: 8 },
      { status: ClinicalStatus.RED, min: 9 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * DISPNEIA (0–10):
   *  Verde   0
   *  Amarelo 1 – 5
   *  Vermelho > 5 (6–10)
   */
  dyspnea: {
    label: 'Dispneia',
    axis: { min: 0, max: 10, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, min: 0, max: 0 },
      { status: ClinicalStatus.YELLOW, min: 1, max: 5 },
      { status: ClinicalStatus.RED, min: 6 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,
} as const;

/**
 * PASSOS — regra relativa (depende do dia anterior), não cabe em RangeRule:
 *  Amarelo: redução de 25% vs. dia anterior
 *  Vermelho: redução de 50% vs. dia anterior
 *  Verde: caso contrário
 */
export const STEPS_RULES = {
  label: 'Número de passos',
  axis: { min: 0, max: 5000 }, // sugestão; o gráfico ajusta ao máximo real
  yellowReductionPct: 0.25,
  redReductionPct: 0.5,
  PENDING_MEDICAL_VALIDATION: false,
} as const;

/**
 * VÔMITO e SANGRAMENTO — binários:
 *  Não = Verde / Sim = Vermelho
 */
export const BINARY_RULES = {
  vomit: { yesStatus: ClinicalStatus.RED, noStatus: ClinicalStatus.GREEN },
  bleeding: { yesStatus: ClinicalStatus.RED, noStatus: ClinicalStatus.GREEN },
} as const;

/**
 * Lista consolidada de pendências clínicas — consumida pela documentação e por
 * um endpoint/healthcheck para tornar visível o que falta confirmar.
 */
export function listPendingMedicalValidations(): string[] {
  const pending: string[] = [];
  for (const [key, range] of Object.entries(INPUT_RANGES)) {
    if (range.PENDING_MEDICAL_VALIDATION) {
      pending.push(`Entrada [${key}]: ${range.pendingNote ?? 'pendente'}`);
    }
  }
  for (const [key, t] of Object.entries(ALERT_THRESHOLDS)) {
    if (t.PENDING_MEDICAL_VALIDATION) {
      pending.push(`Alerta [${key}]: ${t.pendingNote ?? 'pendente'}`);
    }
  }
  return pending;
}
