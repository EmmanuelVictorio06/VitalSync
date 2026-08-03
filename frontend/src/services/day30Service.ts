/**
 * Avaliação em 30 dias (protocolo 5.8) — contato telefônico de desfechos +
 * satisfação. RLS (`day30_select`/`day30_insert`) garante que só Admin ou
 * membro da equipe do paciente lê/grava.
 */
import { supabase } from '../lib/supabase';

export interface PatientDay30Assessment {
  id: string;
  patient_id: string;
  performed_by: string | null;
  performed_by_name: string | null;
  performed_at: string;
  sought_er: boolean | null;
  readmitted: boolean | null;
  unplanned_visit: boolean | null;
  persistent_symptoms: boolean | null;
  outcomes_notes: string | null;
  satisfaction_safety: number | null;
  satisfaction_ease: number | null;
  satisfaction_communication: number | null;
  satisfaction_overall: number | null;
  satisfaction_comment: string | null;
  created_at: string;
}

export interface NewDay30Assessment {
  sought_er?: boolean | null;
  readmitted?: boolean | null;
  unplanned_visit?: boolean | null;
  persistent_symptoms?: boolean | null;
  outcomes_notes?: string | null;
  satisfaction_safety?: number | null;
  satisfaction_ease?: number | null;
  satisfaction_communication?: number | null;
  satisfaction_overall?: number | null;
  satisfaction_comment?: string | null;
}

/** true quando ao menos um desfecho negativo do D+30 foi assinalado. */
export function hasDay30Outcome(
  a: Pick<PatientDay30Assessment, 'sought_er' | 'readmitted' | 'unplanned_visit' | 'persistent_symptoms'>,
): boolean {
  return a.sought_er === true || a.readmitted === true || a.unplanned_visit === true || a.persistent_symptoms === true;
}

const DAY30_COLUMNS =
  'id, patient_id, performed_by, performed_at, sought_er, readmitted, unplanned_visit, persistent_symptoms, outcomes_notes, satisfaction_safety, satisfaction_ease, satisfaction_communication, satisfaction_overall, satisfaction_comment, created_at' as const;

export const day30Service = {
  /** Lista as avaliações de 30 dias do paciente, mais recente primeiro. */
  async listByPatient(patientId: string): Promise<PatientDay30Assessment[]> {
    const { data, error } = await supabase
      .from('patient_day30_assessments')
      .select(DAY30_COLUMNS)
      .eq('patient_id', patientId)
      .order('performed_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data as Omit<PatientDay30Assessment, 'performed_by_name'>[]) ?? [];

    const ids = [...new Set(rows.map((r) => r.performed_by).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles_public').select('id, name').in('id', ids);
      for (const p of profs ?? []) names.set(p.id, p.name);
    }

    return rows.map((r) => ({ ...r, performed_by_name: r.performed_by ? names.get(r.performed_by) ?? null : null }));
  },

  /** Registra uma nova avaliação de 30 dias para o paciente. */
  async create(patientId: string, input: NewDay30Assessment): Promise<void> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error(userError.message);
    const performedBy = userData.user?.id;
    if (!performedBy) throw new Error('Sessão expirada. Faça login novamente.');

    const { error } = await supabase
      .from('patient_day30_assessments')
      .insert({ patient_id: patientId, performed_by: performedBy, ...input });
    if (error) throw new Error(error.message);
  },
};
