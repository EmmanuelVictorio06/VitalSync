/**
 * Alerta operacional de esquecimento (0060/0061): quando o paciente não
 * registra um período depois que a janela fecha, a equipe (priorizando o
 * Profissional de Enfermagem) é notificada. RLS já escopa a leitura por
 * equipe/admin (is_team_member/is_admin) — aqui só formata para a UI.
 */
import { supabase } from '../lib/supabase';
import type { MeasurementPeriod, MissedMeasurementLog } from './types';

export interface MissedPeriodInfo {
  status: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

function dedupeUnresolved(rows: MissedMeasurementLog[]): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.resolved_at) continue;
    seen.add(`${r.patient_id}|${r.period}|${r.missed_date}`);
  }
  return seen.size;
}

export const missedMeasurementService = {
  /** Nº de pacientes com período em aberto (sem depender de quantos destinatários foram alertados). */
  async getPendingCount(): Promise<number> {
    const { data, error } = await supabase
      .from('missed_measurement_logs')
      .select('patient_id, period, missed_date, resolved_at')
      .is('resolved_at', null);
    if (error) return 0;
    return dedupeUnresolved((data ?? []) as MissedMeasurementLog[]);
  },

  /** Estado de hoje (manhã/noite) para o banner do painel individual do paciente. */
  async getForPatientToday(patientId: string): Promise<{ morning: MissedPeriodInfo | null; night: MissedPeriodInfo | null }> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('missed_measurement_logs')
      .select('period, status, resolved_at, resolved_by, profiles:resolved_by(name)')
      .eq('patient_id', patientId)
      .eq('missed_date', today);
    if (error) return { morning: null, night: null };

    const rows = (data ?? []) as unknown as Array<{
      period: MeasurementPeriod;
      status: string;
      resolved_at: string | null;
      profiles: { name: string } | { name: string }[] | null;
    }>;

    function pick(period: MeasurementPeriod): MissedPeriodInfo | null {
      const forPeriod = rows.filter((r) => r.period === period);
      if (forPeriod.length === 0) return null;
      // Prioriza uma linha ainda aberta (mostra "esquecido"); senão, mostra a resolvida.
      const row = forPeriod.find((r) => !r.resolved_at) ?? forPeriod[0]!;
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        status: row.status,
        resolvedAt: row.resolved_at,
        resolvedByName: profile?.name ?? null,
      };
    }

    return { morning: pick('MORNING'), night: pick('NIGHT') };
  },
};
