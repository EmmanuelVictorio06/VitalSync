import { daysSinceDischarge } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import { homologationService } from './homologationService';
import type { CriticalPatient, DashboardAdminKpis, DashboardData, RecentAlert, WeeklyPoint } from '../lib/dashboard-data';
import type { ClinicalStatus } from './types';

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Dias desde a alta (data civil, fuso da clínica) — M-15/M-16. */
function daysSince(date?: string | null): number {
  return date ? daysSinceDischarge(new Date(date)) : 0;
}

function pickVital(v: Record<string, unknown>): { value: string; label: string } {
  const temp = v.temperature != null ? Number(v.temperature) : null;
  const spo2 = v.oxygen_saturation != null ? Number(v.oxygen_saturation) : null;
  const pain = v.pain_level != null ? Number(v.pain_level) : null;
  if (temp != null && temp >= 37.8) return { value: `${temp.toFixed(1).replace('.', ',')}°C`, label: 'Temp.' };
  if (spo2 != null && spo2 < 94) return { value: `${spo2}%`, label: 'SpO₂' };
  if (pain != null && pain >= 5) return { value: `${pain}/10`, label: 'Dor' };
  if (v.has_bleeding === true) return { value: 'Sim', label: 'Sangramento' };
  if (v.systolic_pressure != null) return { value: `${v.systolic_pressure}/${v.diastolic_pressure}`, label: 'PA' };
  return { value: '—', label: 'Medição' };
}

/** Status de atendimento que exigem ação (não atendidos). */
const UNATTENDED_STATUSES = ['PENDING', 'IN_ANALYSIS'] as const;

export const dashboardService = {
  async getDashboard(): Promise<DashboardData> {
    const todayIso = new Date().toISOString().slice(0, 10);
    const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    // Fora do modo homologação, oculta linhas de teste (is_test) — M-14.
    const showTest = await homologationService.isActive();

    let patientsQ = supabase
      .from('patients')
      .select('id, name, current_status, hospital_discharge_date, surgery_type:surgery_types(name)')
      .is('deleted_at', null);
    let pendingQ = supabase.from('clinical_alerts').select('id, patient:patients(status)').eq('attended', false);
    let todayQ = supabase.from('vital_sign_records').select('id', { count: 'exact', head: true }).eq('record_date', todayIso);
    let recentQ = supabase
      .from('clinical_alerts')
      .select('id, status, description, created_at, patient:patients(name, status)')
      .in('attendance_status', UNATTENDED_STATUSES)
      .order('created_at', { ascending: false })
      .limit(8);
    let weeklyQ = supabase.from('vital_sign_records').select('record_date').gte('record_date', since14);
    if (!showTest) {
      patientsQ = patientsQ.eq('is_test', false);
      pendingQ = pendingQ.eq('is_test', false);
      todayQ = todayQ.eq('is_test', false);
      recentQ = recentQ.eq('is_test', false);
      weeklyQ = weeklyQ.eq('is_test', false);
    }

    const [patientsRes, pendingRes, todayRes, alertsRes, weeklyRes, teamsRes, doctorsRes, hospitalsRes, surgeryTypesRes] = await Promise.all([
      patientsQ,
      pendingQ,
      todayQ,
      recentQ,
      weeklyQ,
      supabase.from('medical_teams').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      // Contagem global de médicos via view pública — não depende da RLS de contato (M-09).
      supabase.from('profiles_public').select('id', { count: 'exact', head: true }).in('role', ['MAIN_SURGEON', 'ASSOCIATED_DOCTOR']).eq('status', 'ACTIVE'),
      supabase.from('hospitals').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      supabase.from('surgery_types').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    ]);

    if (patientsRes.error) throw new Error(patientsRes.error.message);

    const patients = (patientsRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      current_status: ClinicalStatus;
      hospital_discharge_date: string | null;
      surgery_type: { name: string } | null;
    }>;

    const by = (s: ClinicalStatus) => patients.filter((p) => p.current_status === s).length;

    // Conta alertas não atendidos apenas de pacientes ativos.
    const pendingAlerts = ((pendingRes.data ?? []) as unknown as Array<{
      patient: { status: string } | null;
    }>).filter((a) => a.patient?.status === 'ACTIVE');

    const kpis = {
      monitoring: patients.length,
      stable: by('GREEN'),
      attention: by('YELLOW'),
      alert: by('RED'),
      unattendedAlerts: pendingAlerts.length,
      recordsToday: todayRes.count ?? 0,
    };

    // Weekly chart with growth vs. previous week.
    const counts = new Map<string, number>();
    for (const r of (weeklyRes.data ?? []) as Array<{ record_date: string }>) {
      counts.set(r.record_date, (counts.get(r.record_date) ?? 0) + 1);
    }
    const weekly: WeeklyPoint[] = [];
    let thisWeek = 0;
    let lastWeek = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const c = counts.get(key) ?? 0;
      weekly.push({ day: WEEKDAY[d.getDay()]!, count: c });
      thisWeek += c;
    }
    for (let i = 13; i >= 7; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      lastWeek += counts.get(d.toISOString().slice(0, 10)) ?? 0;
    }
    const pct = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

    // Critical list (non-GREEN) + most recent vital sign.
    const criticalRows = patients
      .filter((p) => p.current_status !== 'GREEN')
      .sort((a, b) => {
        if (a.current_status === 'RED' && b.current_status !== 'RED') return -1;
        if (a.current_status !== 'RED' && b.current_status === 'RED') return 1;
        return 0;
      })
      .slice(0, 6);
    const critIds = criticalRows.map((p) => p.id);
    let latestByPatient = new Map<string, Record<string, unknown>>();
    if (critIds.length) {
      const { data: vitals } = await supabase
        .from('vital_sign_records')
        .select('patient_id, temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, pain_level, has_bleeding, created_at')
        .in('patient_id', critIds)
        .order('created_at', { ascending: false });
      for (const v of (vitals ?? []) as Array<Record<string, unknown>>) {
        const pid = v.patient_id as string;
        if (!latestByPatient.has(pid)) latestByPatient.set(pid, v);
      }
    }
    const critical: CriticalPatient[] = criticalRows.map((p) => {
      const v = latestByPatient.get(p.id);
      const vital = v ? pickVital(v) : { value: '—', label: 'Medição' };
      return {
        id: p.id,
        name: p.name,
        surgeryType: p.surgery_type?.name ?? '—',
        postOpDay: daysSince(p.hospital_discharge_date),
        vitalValue: vital.value,
        vitalLabel: vital.label,
        status: p.current_status as unknown as CriticalPatient['status'],
      };
    });

    // Recent alerts (only unattended AND from active patients).
    const alerts: RecentAlert[] = ((alertsRes.data ?? []) as unknown as Array<{
      id: string;
      status: string;
      description: string;
      created_at: string;
      patient: { name: string; status: string } | null;
    }>)
      .filter((a) => a.patient?.status === 'ACTIVE')
      .map((a) => ({
        id: a.id,
        patientName: a.patient?.name ?? '—',
        description: a.description,
        datetime: new Date(a.created_at).toLocaleString('pt-BR'),
        severity: a.status === 'RED' ? 'RED' : 'YELLOW',
      }));

    const admin: DashboardAdminKpis | undefined = {
      totalTeams: teamsRes.count ?? 0,
      totalDoctors: doctorsRes.count ?? 0,
      totalHospitals: hospitalsRes.count ?? 0,
      totalSurgeryTypes: surgeryTypesRes.count ?? 0,
    };

    return { kpis, weeklyGrowth: `${pct >= 0 ? '+' : ''}${pct}%`, weekly, critical, alerts, admin };
  },
};
