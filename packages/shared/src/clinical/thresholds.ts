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

  /** Sistólica: faixa de entrada ampla; limiares de alerta confirmados (ver ALERT_THRESHOLDS). */
  systolic: {
    min: 50,
    max: 260,
    example: 'Ex. 120',
    unit: 'mmHg',
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies InputRange,

  /** Diastólica: faixa de entrada ampla; limiares de alerta confirmados (ver ALERT_THRESHOLDS). */
  diastolic: {
    min: 30,
    max: 160,
    example: 'Ex. 80',
    unit: 'mmHg',
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies InputRange,

  /** Frequência cardíaca: faixa de entrada 30–220 bpm confirmada pela equipe médica em 08/08/2026. */
  heartRate: {
    min: 30,
    max: 220,
    example: 'Ex. 71',
    unit: 'bpm',
    PENDING_MEDICAL_VALIDATION: false,
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
   *
   * Protocolo do estudo (5.7.1) descreve verde ≥95 / amarelo 92–94 / vermelho
   * ≤92 — o próprio PDF se sobrepõe no valor 92 (está nas duas faixas). Para
   * valores inteiros (o que o oxímetro sempre informa) o resultado já é
   * idêntico ao protocolo, EXCETO no valor exato 92: aqui fica RED (mais
   * conservador), enquanto o PDF também o lista como amarelo. Mantido como
   * está (não inventamos qual lado da ambiguidade do PDF vale) — ver
   * docs/PONTOS_PENDENTES.md.
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
   * PRESSÃO ARTERIAL — sistólica e diastólica avaliadas SEPARADAMENTE (mmHg);
   * o status da PA é o PIOR entre as duas (ver `worstStatus` em status.ts).
   * Confirmado pela equipe médica (ago/2026) — substitui a antiga faixa
   * sistólica-única provisória.
   *
   * Sistólica: RED ≤89 · YELLOW 90–99 · GREEN 100–129 · YELLOW 130–139 · RED ≥140
   *
   * ⚠️ DIVERGÊNCIA COM O PROTOCOLO DO ESTUDO (FLUXOoperacional.pdf, 5.7.1):
   * o protocolo define vermelho só em PAS > 160 (sem faixa amarela alta
   * explícita), enquanto esta regra (confirmada ago/2026) usa vermelho ≥140.
   * NÃO alterado sem confirmação médica — ver docs/PONTOS_PENDENTES.md.
   */
  bloodPressureSystolic: {
    label: 'Pressão sistólica',
    axis: { min: 40, max: 200, step: 20 },
    rules: [
      { status: ClinicalStatus.RED, max: 89 },
      { status: ClinicalStatus.YELLOW, min: 90, max: 99 },
      { status: ClinicalStatus.GREEN, min: 100, max: 129 },
      { status: ClinicalStatus.YELLOW, min: 130, max: 139 },
      { status: ClinicalStatus.RED, min: 140 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,

  /**
   * Diastólica: RED ≤49 · YELLOW 50–59 · GREEN 60–89 · YELLOW 90–99 · RED ≥100
   */
  bloodPressureDiastolic: {
    label: 'Pressão diastólica',
    axis: { min: 20, max: 140, step: 20 },
    rules: [
      { status: ClinicalStatus.RED, max: 49 },
      { status: ClinicalStatus.YELLOW, min: 50, max: 59 },
      { status: ClinicalStatus.GREEN, min: 60, max: 89 },
      { status: ClinicalStatus.YELLOW, min: 90, max: 99 },
      { status: ClinicalStatus.RED, min: 100 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
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
   * DISPNEIA — 3 níveis (substitui a antiga escala 0–10; confirmado ago/2026):
   *  0 = Sem dispneia    → Verde
   *  1 = Dispneia leve   → Amarelo
   *  2 = Dispneia moderada ou intensa → Vermelho
   */
  dyspnea: {
    label: 'Dispneia',
    axis: { min: 0, max: 2, step: 1 },
    rules: [
      { status: ClinicalStatus.GREEN, min: 0, max: 0 },
      { status: ClinicalStatus.YELLOW, min: 1, max: 1 },
      { status: ClinicalStatus.RED, min: 2 },
    ],
    PENDING_MEDICAL_VALIDATION: false,
  } satisfies VitalThreshold,
} as const;

/**
 * PASSOS — regra relativa a uma referência de ~48h atrás (não mais "dia
 * anterior"), conforme protocolo do estudo (5.7.2/5.7.3):
 *  Amarelo: redução ≥ 50% vs. referência de 48h
 *  Verde: caso contrário
 *
 * NÃO há mais vermelho isolado de passos — a queda ≥50% só vira VERMELHO
 * quando COMBINADA com FC>110 ou aumento ≥3 pontos na dor (ver
 * `evaluateVitalSigns`/critério combinado em status.ts).
 */
export const STEPS_RULES = {
  label: 'Número de passos',
  axis: { min: 0, max: 5000 }, // sugestão; o gráfico ajusta ao máximo real
  yellowReductionPct: 0.5,
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
 * INGESTÃO HÍDRICA — binário:
 *  Consegue tomar líquidos normalmente? Sim = Verde / Não = Vermelho.
 *
 * Alterado para VERMELHO conforme protocolo do estudo (5.7.3): "incapacidade
 * de ingerir líquidos via oral" é critério vermelho. Antes era Amarelo — ver
 * docs/PONTOS_PENDENTES.md (muda a regra vigente, não é mera formalização).
 */
export const WATER_INTAKE_RULE = {
  okStatus: ClinicalStatus.GREEN,
  notOkStatus: ClinicalStatus.RED,
} as const;

/**
 * Lista consolidada de pendências clínicas — consumida pela documentação e por
 * um endpoint/healthcheck para tornar visível o que falta confirmar.
 */
export function listPendingMedicalValidations(): string[] {
  const pending: string[] = [];
  for (const [key, rangeRaw] of Object.entries(INPUT_RANGES)) {
    // Cast para o tipo declarado (como o loop abaixo faz com VitalThreshold):
    // com zero pendências, o `satisfies` estreita o tipo inferido e
    // `pendingNote` deixaria de existir nele — o que quebrou o build na
    // primeira vez que a lista ficou vazia (08/2026).
    const range = rangeRaw as InputRange;
    if (range.PENDING_MEDICAL_VALIDATION) {
      pending.push(`Entrada [${key}]: ${range.pendingNote ?? 'pendente'}`);
    }
  }
  for (const [key, tRaw] of Object.entries(ALERT_THRESHOLDS)) {
    const t = tRaw as VitalThreshold;
    if (t.PENDING_MEDICAL_VALIDATION) {
      pending.push(`Alerta [${key}]: ${t.pendingNote ?? 'pendente'}`);
    }
  }
  return pending;
}
