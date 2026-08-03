/**
 * Tipos e enums compartilhados entre backend e frontend.
 * Fonte única de verdade para os contratos do domínio — evita divergência
 * entre as duas pontas (desenvolvimento orientado a reuso).
 */

/** Perfis de acesso do sistema. Novos perfis podem ser adicionados aqui. */
export const Role = {
  ADM: 'ADM',
  SURGEON: 'SURGEON', // Médico Cirurgião (responsável ou associado em outra equipe)
  ASSOCIATE: 'ASSOCIATE', // Médico associado
  SUPPORT: 'SUPPORT', // Suporte operacional (não clínico)
  MANAGER: 'MANAGER', // Gerente de Equipe (gestão administrativa, sem acesso clínico)
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
  WATER_INTAKE: 'WATER_INTAKE',
  /** Critério combinado do protocolo (ex.: queda de passos + FC/dor; diurese + outro sinal). */
  COMBINED_CRITERIA: 'COMBINED_CRITERIA',
} as const;
export type VitalKind = (typeof VitalKind)[keyof typeof VitalKind];

/** Duração padrão do monitoramento, em dias, a partir da alta hospitalar. */
export const MONITORING_DAYS = 10;

/**
 * Regras da foto da ferida operatória / dreno (dado sensível de saúde).
 * Fonte única para validação no frontend (UX) e no backend (autoritativo).
 */
export const WOUND_PHOTO = {
  /** Tamanho máximo aceito (10 MB). */
  maxBytes: 10 * 1024 * 1024,
  /** Tipos MIME aceitos. */
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  /** Extensões aceitas (usadas no `accept` do input e ao salvar). */
  acceptedExtensions: ['jpg', 'jpeg', 'png', 'webp'] as const,
  /** Mensagens claras e sem termos técnicos (reuso front/back). */
  messages: {
    tooLarge: 'A imagem é muito grande. Envie uma foto menor ou tente novamente.',
    invalidFormat: 'Formato inválido. Envie uma imagem JPG, PNG ou WEBP.',
    uploadFailed: 'Não foi possível enviar a foto. Verifique sua conexão e tente novamente.',
  },
} as const;

export type WoundPhotoMimeType = (typeof WOUND_PHOTO.acceptedMimeTypes)[number];

/** Valida o tipo MIME de uma foto da ferida (true se aceito). */
export function isAcceptedWoundPhotoType(mimeType: string): mimeType is WoundPhotoMimeType {
  return (WOUND_PHOTO.acceptedMimeTypes as readonly string[]).includes(mimeType);
}

/** Extensão de arquivo correspondente ao tipo MIME aceito. */
export function woundPhotoExtension(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
}

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
  dyspnea: number; // 0 = sem dispneia, 1 = leve, 2 = moderada/intensa
  urinatedNormally: boolean; // Diurese: urinou normalmente? (só à noite)
  urinationCount?: number | null; // micções no dia (se informado, só à noite)
  hadVomit: boolean;
  vomitCount?: number | null;
  hadBleeding: boolean;
  stepsCount?: number | null; // só à noite
  waterIntakeOk?: boolean | null; // Ingestão hídrica: consegue tomar líquidos normalmente?
}

/** Resultado da avaliação de status por dimensão + status geral. */
export interface StatusEvaluation {
  overall: ClinicalStatus;
  byVital: Partial<Record<VitalKind, ClinicalStatus>>;
  /** Dimensões que dispararam amarelo/vermelho — usado na mensagem de alerta. */
  triggers: Array<{ kind: VitalKind; status: ClinicalStatus }>;
  /** Nº de critérios em amarelo — protocolo distingue amarelo isolado de ≥2 critérios (conduta diferente). */
  yellowCriteriaCount: number;
  /** true quando o ÚNICO critério amarelo foi passos ou diurese (reavaliação em 2h, não telemedicina direta). */
  isolatedByStepsOrDiuresis: boolean;
}
