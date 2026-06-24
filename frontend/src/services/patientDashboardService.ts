/**
 * Acompanhamento individual do paciente — adapta os dados do Supabase para o
 * formato que a tela (gráficos, indicadores, foto) já consome (lib/dto).
 *
 * - Calcula o statusByVital com as regras do @vitalsync/shared.
 * - Gera URL assinada (temporária) para a foto da ferida (bucket privado).
 */
import { evaluateVitalSigns } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import { patientService } from './patientService';
import { storageService } from './storageService';
import { teamViewService } from './teamViewService';
import type { VitalSignRecord } from './types';
import type { PatientDashboard, VitalRecord } from '../lib/dto';

function daysSince(date?: string | null): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

async function toVitalRecord(v: VitalSignRecord): Promise<VitalRecord> {
  const urinatedNormally = v.urination_count != null;
  const evalResult = evaluateVitalSigns({
    temperature: Number(v.temperature ?? 0),
    spo2: Number(v.oxygen_saturation ?? 0),
    systolic: Number(v.systolic_pressure ?? 0),
    diastolic: Number(v.diastolic_pressure ?? 0),
    heartRate: Number(v.heart_rate ?? 0),
    pain: Number(v.pain_level ?? 0),
    dyspnea: Number(v.dyspnea_level ?? 0),
    urinatedNormally,
    urinationCount: v.urination_count ?? null,
    hadVomit: (v.vomiting_count ?? 0) > 0,
    hadBleeding: v.has_bleeding ?? false,
    stepsCount: v.steps ?? null,
  });

  let woundPhotoUrl: string | null = null;
  if (v.wound_photo_path) {
    try {
      woundPhotoUrl = await storageService.getPatientPhotoUrl(v.wound_photo_path);
    } catch {
      woundPhotoUrl = null;
    }
  }

  let drainPhotoUrl: string | null = null;
  if (v.drain_photo_path) {
    try {
      drainPhotoUrl = await storageService.getPatientPhotoUrl(v.drain_photo_path);
    } catch {
      drainPhotoUrl = null;
    }
  }

  return {
    id: v.id,
    recordDate: v.record_date,
    period: v.period,
    monitoringDay: v.monitoring_day ?? 0,
    temperature: Number(v.temperature ?? 0),
    spo2: Number(v.oxygen_saturation ?? 0),
    systolic: Number(v.systolic_pressure ?? 0),
    diastolic: Number(v.diastolic_pressure ?? 0),
    heartRate: Number(v.heart_rate ?? 0),
    pain: Number(v.pain_level ?? 0),
    dyspnea: Number(v.dyspnea_level ?? 0),
    urinatedNormally,
    urinationCount: v.urination_count,
    hadVomit: (v.vomiting_count ?? 0) > 0,
    vomitCount: v.vomiting_count,
    hadBleeding: v.has_bleeding ?? false,
    stepsCount: v.steps,
    overallStatus: v.clinical_status,
    statusByVital: evalResult.byVital as Record<string, VitalRecord['overallStatus']>,
    patientId: v.patient_id,
    woundPhotoUrl,
    woundPhotoFileName: v.wound_photo_path ? v.wound_photo_path.split('/').pop() ?? null : null,
    woundPhotoMimeType: null,
    woundPhotoSize: null,
    woundPhotoUploadedAt: woundPhotoUrl ? v.created_at : null,
    hasDrain: v.has_drain ?? false,
    drainPhotoUrl,
    drainPhotoFileName: v.drain_photo_path ? v.drain_photo_path.split('/').pop() ?? null : null,
    drainPhotoUploadedAt: drainPhotoUrl ? v.created_at : null,
  };
}

export const patientDashboardService = {
  async getDashboard(patientId: string): Promise<PatientDashboard> {
    const patient = await patientService.getById(patientId);
    if (!patient) throw new Error('Paciente não encontrado.');

    const { data: vitals, error } = await supabase
      .from('vital_sign_records')
      .select('*')
      .eq('patient_id', patientId)
      .order('record_date', { ascending: true });
    if (error) throw new Error(error.message);

    const records = await Promise.all(((vitals ?? []) as VitalSignRecord[]).map(toVitalRecord));

    // Membros da equipe (para o seletor "Atendido por…").
    let teamMembers: Array<{ id: string; name: string }> = [];
    try {
      const detail = await teamViewService.getTeamDetail(patient.team_id);
      teamMembers = detail.members.map((m) => ({ id: m.id, name: m.name }));
    } catch {
      teamMembers = [];
    }

    const days = daysSince(patient.hospital_discharge_date);
    return {
      patient: {
        id: patient.id,
        name: patient.name,
        surgeonName: null,
        surgeryTypeName: patient.surgery_type?.name ?? '—',
        hospitalName: patient.hospital?.name ?? '—',
        surgeryDate: patient.surgery_date ?? '',
        dischargeDate: patient.hospital_discharge_date ?? '',
        phone: patient.phone ?? '',
        currentStatus: patient.current_status,
        attendedById: null,
        attendedByName: null,
        daysSinceDischarge: days,
        monitoringDay: patient.hospital_discharge_date && days <= 10 ? Math.max(1, days + 1) : null,
      },
      records,
      teamMembers,
    };
  },

  /** Marca os alertas pendentes do paciente como atendidos. */
  async markAttended(patientId: string, attendedBy: string): Promise<void> {
    const { error } = await supabase
      .from('clinical_alerts')
      .update({ attended: true, attended_by: attendedBy, attended_at: new Date().toISOString() })
      .eq('patient_id', patientId)
      .eq('attended', false);
    if (error) throw new Error(error.message);
  },
};
