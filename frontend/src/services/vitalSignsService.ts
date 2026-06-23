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
  period: 'MORNING' | 'NIGHT';
  temperature?: number;
  oxygen_saturation?: number;
  systolic_pressure?: number;
  diastolic_pressure?: number;
  heart_rate?: number;
  pain_level?: number;
  dyspnea_level?: number;
  urination_count?: number;
  vomiting_count?: number;
  has_bleeding?: boolean;
  steps?: number;
  wound_photo_path?: string;
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

  /** Envio do paciente (anônimo) — função RPC valida o token e cria o alerta. */
  async submitByToken(input: VitalSubmission): Promise<{ clinical_status: string }> {
    const { data, error } = await supabase.rpc('submit_vital_record', {
      p_token: input.secure_token,
      p_period: input.period,
      p_temperature: input.temperature ?? null,
      p_oxygen_saturation: input.oxygen_saturation ?? null,
      p_systolic: input.systolic_pressure ?? null,
      p_diastolic: input.diastolic_pressure ?? null,
      p_heart_rate: input.heart_rate ?? null,
      p_pain: input.pain_level ?? null,
      p_dyspnea: input.dyspnea_level ?? null,
      p_urination_count: input.urination_count ?? null,
      p_vomiting_count: input.vomiting_count ?? null,
      p_has_bleeding: input.has_bleeding ?? false,
      p_steps: input.steps ?? null,
      p_wound_photo_path: input.wound_photo_path ?? null,
    });
    if (error) throw new Error(error.message);
    return { clinical_status: data as string };
  },
};
