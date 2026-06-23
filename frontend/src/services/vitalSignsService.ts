/**
 * Sinais vitais. Leitura (autenticada) por equipe via RLS.
 *
 * A SUBMISSÃO do paciente é ANÔNIMA (acesso por secure_token), então vai por
 * Edge Function (`process-vital-record`, service_role) que valida o token,
 * grava a medição, calcula o status e cria o alerta — sem expor a tabela ao anon.
 */
import { supabase } from '../lib/supabase';
import type { VitalSignRecord } from './types';

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

  /** Envio do paciente (anônimo) — processado por Edge Function protegida. */
  async submitByToken(input: VitalSubmission): Promise<{ clinical_status: string }> {
    const { data, error } = await supabase.functions.invoke('process-vital-record', { body: input });
    if (error) throw new Error(error.message);
    return data as { clinical_status: string };
  },
};
