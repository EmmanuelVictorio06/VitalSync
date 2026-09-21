/**
 * "Valor que disparou" e "Regra clínica" de um alerta clínico — FONTE ÚNICA.
 *
 * Os dois campos aparecem no "Detalhes do Alerta" (`components/alerts.tsx`) e no
 * "Detalhes do Atendimento" (`components/attendances/utils.ts`). Cada arquivo
 * tinha sua própria cópia e ambas conheciam apenas 4 tipos (Temperatura,
 * Saturação, Dor, Sangramento). Como `eval_clinical_status` (viva na 0075) grava
 * 13 valores possíveis em `clinical_alerts.type`, todo alerta de Pressão
 * arterial, Frequência cardíaca, Dispneia, Vômito, Diurese, Passos, Ingestão
 * hídrica ou Critério combinado caía no `default` e exibia "—" mesmo com a
 * medição presente. Este módulo cobre o vocabulário inteiro.
 *
 * Vocabulário de `type` (= `vtype` da RPC, migration 0075 — manter em sincronia
 * ao acrescentar uma métrica lá):
 *   Sangramento · Critério combinado · Pressão arterial · Temperatura ·
 *   Saturação · Frequência cardíaca · Dispneia · Vômito · Dor · Diurese ·
 *   Ingestão hídrica · Passos · Sinais vitais
 *
 * Os textos de `clinicalRuleFor` só trazem número quando a regra vive em código
 * (BINARY_RULES, WATER_INTAKE_RULE, passos, critérios combinados). As 8 métricas
 * de faixa simples são editáveis pelo Admin em `clinical_threshold_settings`
 * (0075): um literal no TS envelheceria em silêncio, então elas usam texto
 * descritivo.
 */
import type { VitalSignRecord } from '../services/types';

/**
 * Vocabulário completo de `clinical_alerts.type`, na ordem em que a RPC decide
 * (0075). Alimenta o filtro "Alteração" (aba Alertas) e "Sinal vital
 * relacionado" (Meus Atendimentos), que comparam com o `type` gravado no banco
 * — qualquer texto aproximado aqui vira uma opção que nunca acha nada. Foi o
 * que acontecia com "Pressão" (banco: "Pressão arterial") e "Vômitos" (banco:
 * "Vômito").
 *
 * `Sinais vitais` fica de fora de propósito: é o fallback GREEN do `vtype`, e
 * alerta com status GREEN não é criado (0053) — seria uma opção morta.
 */
export const ALERT_TYPE_OPTIONS = [
  'Sangramento',
  'Critério combinado',
  'Pressão arterial',
  'Temperatura',
  'Saturação',
  'Frequência cardíaca',
  'Dispneia',
  'Vômito',
  'Dor',
  'Diurese',
  'Ingestão hídrica',
  'Passos',
] as const;

/**
 * Rótulos CLÍNICOS de dispneia (0-2) — fonte única para as telas da equipe
 * (Detalhes do Alerta, Detalhes do Atendimento, Acompanhamento Individual).
 *
 * Dispneia NÃO é escala 0–10 como a dor: são três alternativas categóricas, e
 * o número guardado é só o código delas. Quem exibe usa `dyspneaLabel()`.
 *
 * As telas DO PACIENTE (SymptomsStep/ReviewStep) têm um vocabulário próprio,
 * mais coloquial ("Sem dispneia", "Dispneia leve") — é deliberado, público
 * diferente; não unifique sem decidir qual texto o paciente deve ler.
 */
export const DYSPNEA_LABEL: Record<number, string> = {
  0: 'Ausente',
  1: 'Leve',
  2: 'Moderada/Intensa',
};

/**
 * Rótulo do nível de dispneia, com os fallbacks que todas as telas repetiam:
 * `null`/ausente → placeholder; código desconhecido → o próprio número (não
 * some da tela se um nível novo entrar antes do de-para ser atualizado).
 */
export function dyspneaLabel(level: number | null | undefined, empty = '—'): string {
  if (level == null) return empty;
  return DYSPNEA_LABEL[level] ?? String(level);
}

/**
 * O embed `vital_record:vital_sign_records(*)` é many-to-one e o PostgREST
 * devolve objeto; a normalização existe porque uma mudança de FK no futuro faria
 * a mesma query voltar como array e o campo sumiria de novo em silêncio.
 */
export type VitalRecordLike = VitalSignRecord | VitalSignRecord[] | null | undefined;

export function normalizeVitalRecord(record: VitalRecordLike): VitalSignRecord | null {
  if (!record) return null;
  return Array.isArray(record) ? record[0] ?? null : record;
}

/** Valor medido de uma métrica, formatado. `null` = não informada na medição. */
function metricValue(type: string, r: VitalSignRecord): string | null {
  switch (type) {
    case 'Temperatura':
      return r.temperature != null ? `${r.temperature} °C` : null;
    case 'Saturação':
      return r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : null;
    case 'Pressão arterial':
      // Sistólica e diastólica são classificadas em separado e o alerta usa o
      // pior status (0048); mostrar o par é o que o médico lê no prontuário.
      if (r.systolic_pressure == null && r.diastolic_pressure == null) return null;
      return `${r.systolic_pressure ?? '—'}/${r.diastolic_pressure ?? '—'} mmHg`;
    case 'Frequência cardíaca':
      return r.heart_rate != null ? `${r.heart_rate} bpm` : null;
    case 'Dor':
      return r.pain_level != null ? `${r.pain_level}/10` : null;
    case 'Dispneia':
      return r.dyspnea_level != null ? dyspneaLabel(r.dyspnea_level) : null;
    case 'Vômito':
      if (r.had_vomit == null && (r.vomiting_count ?? 0) === 0) return null;
      if (!(r.had_vomit ?? (r.vomiting_count ?? 0) > 0)) return 'Não';
      return r.vomiting_count != null && r.vomiting_count > 0
        ? `Sim (${r.vomiting_count} episódios)`
        : 'Sim';
    case 'Sangramento':
      return r.has_bleeding ? 'Presente' : null;
    case 'Diurese':
      // A contagem é opcional; sem ela a regra cai no Sim/Não de "urinou
      // normalmente" (fallback estrutural da RPC).
      if (r.urination_count != null) return `${r.urination_count}×`;
      if (r.urinated_normally != null) return r.urinated_normally ? 'Urinou normalmente' : 'Não urinou normalmente';
      return null;
    case 'Passos':
      return r.steps != null ? `${r.steps} passos` : null;
    case 'Ingestão hídrica':
      if (r.water_intake_ok == null) return null;
      return r.water_intake_ok ? 'Adequada' : 'Abaixo do recomendado';
    default:
      return null;
  }
}

/** Métricas que participam dos critérios combinados (protocolo 5.7.2/5.7.3). */
const COMBINED_METRICS = ['Passos', 'Frequência cardíaca', 'Dor', 'Diurese', 'Saturação', 'Temperatura'] as const;

/**
 * Valor que disparou o alerta, a partir do registro de sinais.
 * `type` é `clinical_alerts.type` (ou `related_vital_sign`, que é o mesmo campo).
 */
export function triggerValueFor(type: string | null | undefined, record: VitalRecordLike): string {
  const r = normalizeVitalRecord(record);
  if (!r || !type) return '—';

  // Critério combinado não tem uma métrica única: mostra as que o compõem.
  if (type === 'Critério combinado') {
    const parts = COMBINED_METRICS.map((m) => {
      const v = metricValue(m, r);
      return v ? `${m}: ${v}` : null;
    }).filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  return metricValue(type, r) ?? '—';
}

/** Regra clínica aplicada (texto curto e didático). */
export function clinicalRuleFor(type: string | null | undefined, isRed: boolean): string {
  switch (type) {
    // Faixas historicamente exibidas com número — mantidas como estavam.
    case 'Temperatura':
      return isRed ? 'Temperatura ≥ 38,5 °C' : 'Temperatura ≥ 37,8 °C';
    case 'Saturação':
      return isRed ? 'Saturação < 92%' : 'Saturação < 94%';
    case 'Dor':
      return isRed ? 'Dor ≥ 8/10' : 'Dor ≥ 5/10';
    // Faixas editáveis pelo Admin (0075): sem número para não envelhecer.
    case 'Pressão arterial':
      return 'Pressão arterial fora da faixa de referência';
    case 'Frequência cardíaca':
      return 'Frequência cardíaca fora da faixa de referência';
    case 'Dispneia':
      return 'Dispneia acima do esperado';
    case 'Diurese':
      return 'Diurese fora da faixa de referência';
    // Regras estruturais, que vivem em código (thresholds.ts + RPC).
    case 'Sangramento':
      return 'Sangramento relatado';
    case 'Vômito':
      return 'Vômito relatado';
    case 'Passos':
      return 'Queda ≥ 50% nos passos vs. referência de ~48h';
    case 'Ingestão hídrica':
      return 'Ingestão hídrica insuficiente (protocolo 5.7.3)';
    case 'Critério combinado':
      return 'Critérios combinados (protocolo 5.7.2/5.7.3)';
    default:
      return 'Conjunto de sinais limítrofes';
  }
}
