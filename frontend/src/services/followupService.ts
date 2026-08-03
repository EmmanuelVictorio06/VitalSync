/**
 * Atendimento periódico (a cada 48h): registro manual do resultado do contato
 * com o paciente. RLS (`patient_followups_select`/`_insert`) garante que só
 * Admin ou membro da equipe do paciente lê/grava — o frontend só reflete o
 * que o banco já permite.
 */
import { supabase } from '../lib/supabase';

export interface PatientFollowup {
  id: string;
  patient_id: string;
  performed_by: string | null;
  performed_by_name: string | null;
  result: string;
  performed_at: string;
  created_at: string;
}

export const followupService = {
  /** Lista os atendimentos de 48h do paciente, do mais recente para o mais antigo. */
  async listByPatient(patientId: string): Promise<PatientFollowup[]> {
    const { data, error } = await supabase
      .from('patient_followups')
      .select('id, patient_id, performed_by, result, performed_at, created_at')
      .eq('patient_id', patientId)
      .order('performed_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data as Omit<PatientFollowup, 'performed_by_name'>[]) ?? [];

    const ids = [...new Set(rows.map((r) => r.performed_by).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('profiles_public').select('id, name').in('id', ids);
      for (const p of profs ?? []) names.set(p.id, p.name);
    }

    return rows.map((r) => ({ ...r, performed_by_name: r.performed_by ? names.get(r.performed_by) ?? null : null }));
  },

  /** Registra um novo atendimento de 48h para o paciente. */
  async create(patientId: string, result: string): Promise<void> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error(userError.message);
    const performedBy = userData.user?.id;
    if (!performedBy) throw new Error('Sessão expirada. Faça login novamente.');

    const { error } = await supabase
      .from('patient_followups')
      .insert({ patient_id: patientId, performed_by: performedBy, result: result.trim() });
    if (error) throw new Error(error.message);
  },
};
