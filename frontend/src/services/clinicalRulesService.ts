/**
 * Regras clínicas de FAIXA SIMPLES (verde/amarelo/vermelho por intervalo),
 * editáveis pelo ADMIN em runtime — migration 0075.
 *
 * FONTE VIVA = banco (`clinical_threshold_settings`, lida por
 * `get_clinical_thresholds`). É o mesmo dado que `eval_clinical_status` usa
 * para calcular o status, então a tela mostra o que de fato vale.
 *
 * `ALERT_THRESHOLDS` (@vitalsync/shared) continua sendo:
 *   • o DEFAULT que semeou o banco e o FALLBACK desta tela se a RPC falhar;
 *   • a fonte da validação de entrada e dos gráficos no frontend.
 *
 * Escrita SÓ via RPC `admin_set_clinical_threshold` (is_admin + validação de
 * cobertura + audit_logs). Nunca `update` direto na tabela.
 */
import { ALERT_THRESHOLDS, type RangeRule, type VitalThreshold } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';

export interface ClinicalThresholdRow {
  metricKey: string;
  label: string;
  rules: RangeRule[];
  pendingValidation: boolean;
  pendingNote: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

interface RawThresholdRow {
  metric_key: string;
  label: string;
  rules: RangeRule[];
  pending_validation: boolean;
  pending_note: string | null;
  sort_order: number;
  updated_at: string | null;
  updated_by_name: string | null;
}

/**
 * Fallback local: as mesmas faixas de `thresholds.ts`, na mesma ordem em que a
 * migration 0075 semeou o banco. Usado quando a RPC não responde — a tela
 * mostra os valores padrão em modo somente-leitura em vez de ficar em branco.
 */
export const DEFAULT_CLINICAL_ROWS: ClinicalThresholdRow[] = Object.entries(ALERT_THRESHOLDS).map(
  ([metricKey, raw]) => {
    const t = raw as VitalThreshold;
    return {
      metricKey,
      label: t.label,
      rules: t.rules.map((r) => ({ ...r })),
      pendingValidation: t.PENDING_MEDICAL_VALIDATION,
      pendingNote: t.pendingNote ?? null,
      updatedAt: null,
      updatedByName: null,
    };
  },
);

export const clinicalRulesService = {
  /** Faixas vivas do banco (já ordenadas pela RPC). */
  async list(): Promise<ClinicalThresholdRow[]> {
    const { data, error } = await supabase.rpc('get_clinical_thresholds');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RawThresholdRow[];
    // Banco sem seed (migration 0075 não aplicada): cai no default em código.
    if (rows.length === 0) return DEFAULT_CLINICAL_ROWS;
    return rows.map((r) => ({
      metricKey: r.metric_key,
      label: r.label,
      rules: r.rules,
      pendingValidation: r.pending_validation,
      pendingNote: r.pending_note,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    }));
  },

  /**
   * Grava as faixas de uma métrica. A RPC valida cobertura/ordem e só aceita
   * ADMIN — a mensagem de erro já vem em PT-BR pronta para a tela.
   */
  async save(metricKey: string, rules: RangeRule[]): Promise<void> {
    const { error } = await supabase.rpc('admin_set_clinical_threshold', {
      p_metric: metricKey,
      // `undefined` some no JSON.stringify — a RPC recebe só status/min/max
      // realmente preenchidos, que é o formato aceito pela validação.
      p_rules: rules.map((r) => ({
        status: r.status,
        ...(r.min === undefined ? {} : { min: r.min }),
        ...(r.max === undefined ? {} : { max: r.max }),
      })),
    });
    if (error) throw new Error(error.message);
  },
};
