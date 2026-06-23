/** Alertas clínicos (RLS aplica o escopo por equipe). */
import { supabase } from '../lib/supabase';
import type { ClinicalAlert } from './types';

export interface AlertWithPatient extends ClinicalAlert {
  patient: { name: string } | null;
}

export const alertService = {
  async list(opts: { onlyPending?: boolean } = {}): Promise<AlertWithPatient[]> {
    let q = supabase
      .from('clinical_alerts')
      .select('*, patient:patients(name)')
      .order('created_at', { ascending: false });
    if (opts.onlyPending) q = q.eq('attended', false);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as unknown as AlertWithPatient[]) ?? [];
  },

  /** Marca o alerta como atendido pelo profissional logado. */
  async markAttended(alertId: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('clinical_alerts')
      .update({ attended: true, attended_by: userData.user?.id ?? null, attended_at: new Date().toISOString() })
      .eq('id', alertId);
    if (error) throw new Error(error.message);
  },
};
