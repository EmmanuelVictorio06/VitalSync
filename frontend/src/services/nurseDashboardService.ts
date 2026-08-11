/**
 * Central de Enfermagem — compõe o painel do Profissional de Enfermagem a
 * partir dos serviços que já existem, sem duplicar regra de negócio:
 *
 *   • Fila de triagem e reaferições de 2h  → alertService.getAlerts()
 *   • Contato ativo (medição esquecida)    → patientService.getMissingTodayMeasurements()
 *   • Agenda (48h / D+30 / fim de janela)  → patientService.list() + consultas em lote
 *   • "Meu dia"                            → attendance_confirmations + vital_sign_records
 *
 * O escopo por equipe NÃO é filtrado aqui: a RLS do Supabase
 * (`is_team_member()`) já limita tudo às equipes do usuário logado. As regras
 * derivadas (o que está vencido, o que é devido) ficam em `lib/nurseDashboard.ts`.
 */
import { daysSinceDischarge, monitoringDay } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import {
  isMonitoringEndingSoon,
  needsDay30Assessment,
  needsFollowup48h,
  sortTriageQueue,
} from '../lib/nurseDashboard';
import { alertService, type AlertRow } from './alertService';
import { patientService, type MissingMeasurementPatient } from './patientService';

/** Alerta com reaferição de 2h ainda em aberto (protocolo 5.7.2). */
export interface RecheckItem {
  alertId: string;
  patientId: string;
  patientName: string;
  status: string;
  type: string | null;
  recheckDueAt: string;
}

/** Item da agenda de acompanhamento (48h, D+30, fim de monitoramento). */
export interface AgendaItem {
  patientId: string;
  patientName: string;
  /** Dias decorridos desde a alta — contextualiza a pendência. */
  daysSinceDischarge: number;
  monitoringDay: number | null;
}

export interface NurseDashboardData {
  triage: {
    /** Pendentes (ainda sem ninguém em análise), já ordenados: vermelho → amarelo → mais antigo. */
    pending: AlertRow[];
    /** Alertas que EU travei e preciso concluir. */
    mine: AlertRow[];
    counts: { red: number; yellow: number; mine: number };
  };
  rechecks: RecheckItem[];
  missing: MissingMeasurementPatient[];
  agenda: {
    followup48h: AgendaItem[];
    day30: AgendaItem[];
    endingSoon: AgendaItem[];
  };
  myDay: {
    attendedToday: number;
    measurementsEnteredToday: number;
    activePatients: number;
  };
}

/** Data civil de hoje no fuso da clínica (YYYY-MM-DD), igual ao patientService. */
function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Início do dia civil da clínica em ISO — recorte de "hoje" para o resumo pessoal. */
function startOfTodaySPIso(): string {
  return new Date(`${todaySP()}T00:00:00-03:00`).toISOString();
}

/** Usa os helpers de data civil do @vitalsync/shared (fuso da clínica) — não refazer a conta. */
function toAgendaItem(p: { id: string; name: string; hospital_discharge_date: string | null }): AgendaItem {
  const discharge = p.hospital_discharge_date ? new Date(p.hospital_discharge_date) : null;
  return {
    patientId: p.id,
    patientName: p.name,
    daysSinceDischarge: discharge ? daysSinceDischarge(discharge) : 0,
    monitoringDay: discharge ? monitoringDay(discharge) : null,
  };
}

export const nurseDashboardService = {
  async getDashboard(): Promise<NurseDashboardData> {
    const { data: userData } = await supabase.auth.getUser();
    const myId = userData.user?.id ?? null;

    const [alerts, missing, patients] = await Promise.all([
      alertService.getAlerts().catch(() => [] as AlertRow[]),
      patientService.getMissingTodayMeasurements().catch(() => [] as MissingMeasurementPatient[]),
      patientService.list().catch(() => []),
    ]);

    /* ------------------------------ Triagem ------------------------------ */
    const pending = sortTriageQueue(alerts.filter((a) => a.attendance_status === 'PENDING'));
    const mine = sortTriageQueue(
      alerts.filter((a) => a.attendance_status === 'IN_ANALYSIS' && a.in_analysis_by === myId),
    );

    /* ------------------------ Reaferições de 2h -------------------------- */
    const rechecks: RecheckItem[] = alerts
      .filter((a) => a.recheck_due_at && !a.recheck_completed_at)
      .map((a) => ({
        alertId: a.id,
        patientId: a.patient?.id ?? '',
        patientName: a.patient?.name ?? '—',
        status: a.status,
        type: a.type,
        recheckDueAt: a.recheck_due_at as string,
      }))
      .filter((r) => r.patientId)
      .sort((a, b) => new Date(a.recheckDueAt).getTime() - new Date(b.recheckDueAt).getTime());

    /* --------------------------- Agenda ---------------------------------- */
    const activePatients = patients.filter((p) => p.status === 'ACTIVE' && p.hospital_discharge_date);
    const ids = activePatients.map((p) => p.id);

    let followupByPatient = new Set<string>();
    let day30ByPatient = new Set<string>();
    if (ids.length > 0) {
      const [followupsRes, day30Res] = await Promise.all([
        supabase.from('patient_followups').select('patient_id').in('patient_id', ids),
        supabase.from('patient_day30_assessments').select('patient_id').in('patient_id', ids),
      ]);
      followupByPatient = new Set(((followupsRes.data ?? []) as Array<{ patient_id: string }>).map((r) => r.patient_id));
      day30ByPatient = new Set(((day30Res.data ?? []) as Array<{ patient_id: string }>).map((r) => r.patient_id));
    }

    const followup48h: AgendaItem[] = [];
    const day30: AgendaItem[] = [];
    const endingSoon: AgendaItem[] = [];
    for (const p of activePatients) {
      const discharge = p.hospital_discharge_date ? new Date(p.hospital_discharge_date) : null;
      if (needsFollowup48h({ dischargeDate: discharge, hasFollowup: followupByPatient.has(p.id) })) {
        followup48h.push(toAgendaItem(p));
      }
      if (needsDay30Assessment({ dischargeDate: discharge, hasAssessment: day30ByPatient.has(p.id) })) {
        day30.push(toAgendaItem(p));
      }
      if (isMonitoringEndingSoon({ dischargeDate: discharge })) {
        endingSoon.push(toAgendaItem(p));
      }
    }

    /* --------------------------- Meu dia --------------------------------- */
    const since = startOfTodaySPIso();
    const today = todaySP();
    const [attendedRes, enteredRes] = await Promise.all([
      myId
        ? supabase
            .from('attendance_confirmations')
            .select('id', { count: 'exact', head: true })
            .eq('attended_by', myId)
            .gte('created_at', since)
        : Promise.resolve({ count: 0 }),
      myId
        ? supabase
            .from('vital_sign_records')
            .select('id', { count: 'exact', head: true })
            .eq('entered_by_profile_id', myId)
            .eq('source', 'STAFF')
            .eq('record_date', today)
        : Promise.resolve({ count: 0 }),
    ]);

    return {
      triage: {
        pending,
        mine,
        counts: {
          red: pending.filter((a) => a.status === 'RED').length,
          yellow: pending.filter((a) => a.status === 'YELLOW').length,
          mine: mine.length,
        },
      },
      rechecks,
      missing,
      agenda: { followup48h, day30, endingSoon },
      myDay: {
        attendedToday: attendedRes.count ?? 0,
        measurementsEnteredToday: enteredRes.count ?? 0,
        activePatients: activePatients.length,
      },
    };
  },
};
