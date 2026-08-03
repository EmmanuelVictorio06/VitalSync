/**
 * Sinais vitais.
 *  - Leitura por equipe: autenticada, via RLS.
 *  - Fluxo do PACIENTE (anônimo, por secure_token): via funções RPC
 *    SECURITY DEFINER (get_patient_by_token / submit_vital_record), que validam
 *    o token e operam com privilégio sem expor as tabelas ao papel anon.
 */
import { supabase } from '../lib/supabase';
import type { ClinicalStatus, VitalSignRecord } from './types';

export interface PatientLinkInfo {
  id: string;
  name: string;
  birth_date: string | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
  current_status: ClinicalStatus;
  monitoring_day: number | null;
  within_window: boolean;
}

export interface VitalSubmission {
  secure_token: string;
  /** CPF do paciente (reprova a identidade no envio — gate real, C-04). */
  cpf: string;
  period: 'MORNING' | 'NIGHT';
  temperature?: number;
  oxygen_saturation?: number;
  systolic_pressure?: number;
  diastolic_pressure?: number;
  heart_rate?: number;
  pain_level?: number;
  /** 0 = sem dispneia, 1 = leve, 2 = moderada/intensa. */
  dyspnea_level?: number;
  /** Ingestão hídrica: consegue tomar líquidos normalmente? (manhã e noite) */
  water_intake_ok?: boolean;
  /** Diurese — só perguntada à noite. */
  urination_count?: number;
  /** Resposta Sim/Não de "urinou normalmente" (resolve a ambiguidade — M-01). */
  urinated_normally?: boolean;
  vomiting_count?: number;
  /** Resposta Sim/Não de vômito (resolve a ambiguidade — M-01). */
  had_vomit?: boolean;
  has_bleeding?: boolean;
  steps?: number;
  /** Foto da cicatriz operatória (obrigatória à noite, opcional na manhã). */
  wound_photo_path?: string;
  /** Paciente possui dreno? (só à noite) */
  has_drain?: boolean;
  /** Foto do dreno (só quando has_drain = true). */
  drain_photo_path?: string;
  /** Débito do dreno em ml (só quando has_drain = true). */
  drain_output_ml?: number;
  /** Manhã: paciente notou algo diferente na cicatriz ao acordar? */
  noticed_wound_change?: boolean;
}

export const vitalSignsService = {
  async listByPatient(patientId: string): Promise<VitalSignRecord[]> {
    const { data, error } = await supabase
      .from('vital_sign_records')
      .select('*')
      .eq('patient_id', patientId)
      .order('record_date', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as VitalSignRecord[]) ?? [];
  },

  /** Resolve o paciente pelo token (anônimo). */
  async getByToken(token: string): Promise<PatientLinkInfo> {
    const { data, error } = await supabase.rpc('get_patient_by_token', { p_token: token });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as PatientLinkInfo | undefined;
    if (!row) throw new Error('Link inválido ou expirado.');
    return row;
  },

  /**
   * Envio do paciente (anônimo) — passa pela Edge Function `submit-vital-record`,
   * que REVALIDA o CPF (gate real + rate-limit) e chama a RPC via service_role.
   * As RPCs não são mais chamáveis direto pelo papel anon (migration 0022).
   */
  async submitByToken(input: VitalSubmission): Promise<{ clinical_status: string }> {
    const { data, error } = await supabase.functions.invoke('submit-vital-record', {
      body: {
        token: input.secure_token,
        cpf: input.cpf,
        measurement: {
          period: input.period,
          temperature: input.temperature ?? null,
          oxygen_saturation: input.oxygen_saturation ?? null,
          systolic_pressure: input.systolic_pressure ?? null,
          diastolic_pressure: input.diastolic_pressure ?? null,
          heart_rate: input.heart_rate ?? null,
          pain_level: input.pain_level ?? null,
          dyspnea_level: input.dyspnea_level ?? null,
          water_intake_ok: input.water_intake_ok ?? null,
          urination_count: input.urination_count ?? null,
          urinated_normally: input.urinated_normally ?? null,
          vomiting_count: input.vomiting_count ?? null,
          had_vomit: input.had_vomit ?? null,
          has_bleeding: input.has_bleeding ?? false,
          steps: input.steps ?? null,
          wound_photo_path: input.wound_photo_path ?? null,
          has_drain: input.has_drain ?? false,
          drain_photo_path: input.drain_photo_path ?? null,
          drain_output_ml: input.drain_output_ml ?? null,
          noticed_wound_change: input.noticed_wound_change ?? null,
        },
      },
    });
    if (error) throw new Error(await extractEdgeError(error));
    const status = (data as { clinical_status?: string })?.clinical_status;
    if (!status) throw new Error('Não foi possível enviar sua medição. Tente novamente.');
    return { clinical_status: status };
  },
};

/** Extrai a mensagem (genérica) retornada pela Edge Function de envio. */
async function extractEdgeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON
    }
  }
  return 'Não foi possível enviar sua medição. Tente novamente.';
}
