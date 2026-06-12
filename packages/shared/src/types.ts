/**
 * Tipos e enums compartilhados entre backend e frontend.
 * Fonte única de verdade para os contratos do domínio — evita divergência
 * entre as duas pontas (desenvolvimento orientado a reuso).
 */

/** Perfis de acesso do sistema. Novos perfis podem ser adicionados aqui. */
export const Role = {
  ADM: 'ADM',
  SURGEON: 'SURGEON', // Cirurgião responsável
  ASSOCIATE: 'ASSOCIATE', // Médico associado
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Período da medição diária. */
export const Period = {
  MORNING: 'MORNING', // Manhã (ao acordar)
  NIGHT: 'NIGHT', // Noite (antes de dormir)
} as const;
export type Period = (typeof Period)[keyof typeof Period];

/** Status clínico calculado (semáforo). A ordem reflete a severidade. */
export const ClinicalStatus = {
  GREEN: 'GREEN', // Normal / estável
  YELLOW: 'YELLOW', // Atenção
  RED: 'RED', // Alerta
} as const;
export type ClinicalStatus = (typeof ClinicalStatus)[keyof typeof ClinicalStatus];

/** Severidade numérica — usada para reduzir vários sinais a um status geral. */
export const STATUS_SEVERITY: Record<ClinicalStatus, number> = {
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
};

/** Dimensões clínicas avaliadas em cada medição. */
export const VitalKind = {
  TEMPERATURE: 'TEMPERATURE',
  SPO2: 'SPO2',
  BLOOD_PRESSURE: 'BLOOD_PRESSURE',
  HEART_RATE: 'HEART_RATE',
  STEPS: 'STEPS',
  DIURESIS: 'DIURESIS',
  VOMIT: 'VOMIT',
  BLEEDING: 'BLEEDING',
  PAIN: 'PAIN',
  DYSPNEA: 'DYSPNEA',
} as const;
export type VitalKind = (typeof VitalKind)[keyof typeof VitalKind];

/** Duração padrão do monitoramento, em dias, a partir da alta hospitalar. */
export const MONITORING_DAYS = 10;

/**
 * Payload bruto de uma medição enviada pelo paciente.
 * `stepsCount` só é esperado no período da NOITE.
 */
export interface VitalSignInput {
  temperature: number; // °C
  spo2: number; // %
  systolic: number; // mmHg
  diastolic: number; // mmHg
  heartRate: number; // bpm
  pain: number; // 0–10
  dyspnea: number; // 0–10
  urinatedNormally: boolean; // Diurese: urinou normalmente?
  urinationCount?: number | null; // micções no dia (se informado)
  hadVomit: boolean;
  vomitCount?: number | null;
  hadBleeding: boolean;
  stepsCount?: number | null; // só à noite
}

/** Resultado da avaliação de status por dimensão + status geral. */
export interface StatusEvaluation {
  overall: ClinicalStatus;
  byVital: Partial<Record<VitalKind, ClinicalStatus>>;
  /** Dimensões que dispararam amarelo/vermelho — usado na mensagem de alerta. */
  triggers: Array<{ kind: VitalKind; status: ClinicalStatus }>;
}
