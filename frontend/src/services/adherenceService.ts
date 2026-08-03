/**
 * Adesão e completude (protocolo 5.11 — desfecho PRIMÁRIO do estudo).
 *
 * Adesão = coletas enviadas / coletas esperadas (2×/dia × dias decorridos,
 * até o teto de 10 dias). Meta do protocolo: ≥80% (20 coletas em 10 dias).
 * Completude = % dos campos centrais preenchidos nas medições enviadas
 * (proxy operacional — o wizard já exige os campos por período, então baixa
 * completude normalmente indica registro antigo/parcial).
 *
 * ASSUNÇÃO (documentar/confirmar com o time do estudo — sem definição
 * numérica exata no protocolo): "perda de seguimento" = janela de 10 dias
 * encerrada com adesão < 50%. Ver docs/PONTOS_PENDENTES.md.
 */
import { daysSinceDischarge } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';

const ADHERENCE_TARGET_PCT = 80;
const LOST_TO_FOLLOWUP_THRESHOLD_PCT = 50;

export interface PatientAdherence {
  patientId: string;
  name: string;
  monitoringWindowClosed: boolean;
  effectiveDays: number;
  expectedCollections: number;
  actualCollections: number;
  adherencePct: number;
  meetsAdherenceTarget: boolean;
  completenessPct: number;
  lostToFollowUp: boolean;
}

export interface AdherenceSummary {
  totalPatients: number;
  meetingTarget: number;
  avgAdherencePct: number;
  avgCompletenessPct: number;
  lostToFollowUpCount: number;
}

interface RecordCoreFields {
  patient_id: string;
  temperature: number | null;
  oxygen_saturation: number | null;
  systolic_pressure: number | null;
  diastolic_pressure: number | null;
  heart_rate: number | null;
  pain_level: number | null;
  dyspnea_level: number | null;
  water_intake_ok: boolean | null;
}

const CORE_FIELDS: Array<keyof RecordCoreFields> = [
  'temperature',
  'oxygen_saturation',
  'systolic_pressure',
  'diastolic_pressure',
  'heart_rate',
  'pain_level',
  'dyspnea_level',
  'water_intake_ok',
];

function recordCompleteness(r: RecordCoreFields): number {
  const filled = CORE_FIELDS.filter((f) => r[f] != null).length;
  return (filled / CORE_FIELDS.length) * 100;
}

export const adherenceService = {
  /** Adesão/completude por paciente (RLS já limita ao escopo do usuário). */
  async getPatientAdherence(): Promise<PatientAdherence[]> {
    const { data: patients, error } = await supabase
      .from('patients')
      .select('id, name, hospital_discharge_date, status')
      .eq('status', 'ACTIVE')
      .is('deleted_at', null)
      .not('hospital_discharge_date', 'is', null);
    if (error) throw new Error(error.message);
    const list = (patients ?? []) as Array<{ id: string; name: string; hospital_discharge_date: string }>;
    if (list.length === 0) return [];

    const { data: records, error: recErr } = await supabase
      .from('vital_sign_records')
      .select(
        'patient_id, temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level, water_intake_ok',
      )
      .in('patient_id', list.map((p) => p.id));
    if (recErr) throw new Error(recErr.message);
    const byPatient = new Map<string, RecordCoreFields[]>();
    for (const r of (records ?? []) as RecordCoreFields[]) {
      const arr = byPatient.get(r.patient_id) ?? [];
      arr.push(r);
      byPatient.set(r.patient_id, arr);
    }

    return list.map((p): PatientAdherence => {
      const dsd = daysSinceDischarge(new Date(p.hospital_discharge_date));
      const effectiveDays = Math.min(dsd + 1, 10);
      const monitoringWindowClosed = dsd >= 10;
      const expectedCollections = effectiveDays * 2;
      const patientRecords = byPatient.get(p.id) ?? [];
      const actualCollections = patientRecords.length;
      const adherencePct = expectedCollections > 0
        ? Math.min(100, Math.round((actualCollections / expectedCollections) * 100))
        : 0;
      const completenessPct = actualCollections > 0
        ? Math.round(patientRecords.reduce((sum, r) => sum + recordCompleteness(r), 0) / actualCollections)
        : 0;
      return {
        patientId: p.id,
        name: p.name,
        monitoringWindowClosed,
        effectiveDays,
        expectedCollections,
        actualCollections,
        adherencePct,
        meetsAdherenceTarget: adherencePct >= ADHERENCE_TARGET_PCT,
        completenessPct,
        lostToFollowUp: monitoringWindowClosed && adherencePct < LOST_TO_FOLLOWUP_THRESHOLD_PCT,
      };
    });
  },

  summarize(rows: PatientAdherence[]): AdherenceSummary {
    if (rows.length === 0) {
      return { totalPatients: 0, meetingTarget: 0, avgAdherencePct: 0, avgCompletenessPct: 0, lostToFollowUpCount: 0 };
    }
    const meetingTarget = rows.filter((r) => r.meetsAdherenceTarget).length;
    const lostToFollowUpCount = rows.filter((r) => r.lostToFollowUp).length;
    const avgAdherencePct = Math.round(rows.reduce((s, r) => s + r.adherencePct, 0) / rows.length);
    const avgCompletenessPct = Math.round(rows.reduce((s, r) => s + r.completenessPct, 0) / rows.length);
    return { totalPatients: rows.length, meetingTarget, avgAdherencePct, avgCompletenessPct, lostToFollowUpCount };
  },
};
