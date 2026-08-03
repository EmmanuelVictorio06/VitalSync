/**
 * Aba "Meus Atendimentos" — histórico clínico do profissional logado.
 *
 * FONTE DE DADOS: `attendance_confirmations`. Toda ação clínica já registra uma
 * linha nessa tabela:
 *  - Alertas (RPCs do 0008): IN_ANALYSIS / ATTENDED / IGNORED, com `alert_id`.
 *  - Registros antigos sem `alert_id` continuam como acompanhamento manual.
 *
 * ESCOPO POR PERFIL: garantido pelo SUPABASE (RLS `attendance_rw`):
 *   is_admin() OR is_team_member(patient.team_id). Admin vê tudo; cirurgião e
 *   associado só veem os atendimentos dos pacientes das SUAS equipes. O frontend
 *   nunca amplia esse escopo — apenas filtra/visualiza o que a RLS já liberou.
 *
 * A edição de observação usa a própria policy `attendance_rw` (membro da equipe).
 * Apenas registros finalizados (ATTENDED ou IGNORED) são listados aqui.
 */
import { supabase } from '../lib/supabase';
import type {
  AttendanceConfirmation,
  ClinicalStatus,
  UserRole,
  VitalSignRecord,
} from './types';

/** Status de um atendimento finalizado (exibido em Meus Atendimentos). */
export type AttendanceStatus = 'ATTENDED' | 'IGNORED';

/** Nível clínico do alerta de origem (semáforo). */
export type AttendanceAlertLevel = 'YELLOW' | 'RED';

/** De onde veio o atendimento (derivado: alerta x acompanhamento manual). */
export type AttendanceOrigin = 'ALERT' | 'MANUAL_REVIEW';

/** Decide se um registro da tabela attendance_confirmations aparece em Meus Atendimentos. */
export function isFinalizedAttendance(status: string | null | undefined): status is AttendanceStatus {
  return status === 'ATTENDED' || status === 'IGNORED';
}

/** Linha enriquecida exibida na lista/detalhe (joins resolvidos no serviço). */
export interface AttendanceRow extends AttendanceConfirmation {
  status: AttendanceStatus;
  patient: {
    id: string;
    name: string;
    birth_date: string | null;
    phone: string | null;
    surgery_date: string | null;
    hospital_discharge_date: string | null;
    team_id: string;
    current_status: ClinicalStatus;
    surgery_type: { name: string } | null;
    hospital: { name: string } | null;
  } | null;
  /** Equipe do paciente (resolvida via patients.team_id → medical_teams). */
  team: { team_number: number; main_surgeon_id: string | null } | null;
  /** Alerta de origem (quando o atendimento partiu de um alerta clínico). */
  alert: {
    id: string;
    status: ClinicalStatus;
    type: string | null;
    description: string;
    ignored_reason: string | null;
    created_at: string;
    /** Para o tempo de resposta (protocolo 5.6.6/5.6.7): primeira ação = a mais antiga das duas. */
    in_analysis_at: string | null;
    attended_at: string | null;
  } | null;
  /** Medição relacionada (via alerta). */
  vital_record: VitalSignRecord | null;
  /** Nomes resolvidos (não vêm por FK para não acoplar à RLS de profiles). */
  professional_name: string | null;
  professional_role: UserRole | null;
  surgeon_name: string | null;
  /** Derivados de apresentação. */
  origin: AttendanceOrigin;
  related_vital_sign: string | null;
  /** Status clínico no momento (do alerta, ou o atual do paciente). */
  clinical_status: ClinicalStatus;
  /** Nível do alerta de origem, quando veio de um alerta clínico. */
  alert_level: AttendanceAlertLevel | null;
}

export interface AttendanceSummary {
  total: number;
  /** Atendimentos finalizados registrados hoje. */
  today: number;
  /** Alertas vermelhos já atendidos/finalizados. */
  red: number;
  /** Alertas amarelos já atendidos/finalizados. */
  yellow: number;
  /** Marcados como atendido. */
  attended: number;
  /** Finalizados com justificativa (ignorados). */
  ignored: number;
}

const ATTENDANCE_SELECT = `
  *,
  patient:patients(
    id, name, birth_date, phone, surgery_date, hospital_discharge_date, team_id, current_status,
    surgery_type:surgery_types(name),
    hospital:hospitals(name),
    team:medical_teams(team_number, main_surgeon_id)
  ),
  alert:clinical_alerts(
    id, status, type, description, ignored_reason, created_at, vital_record_id,
    in_analysis_at, attended_at,
    vital_record:vital_sign_records(*)
  )
` as const;

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Linha "crua" do Supabase antes de resolver nomes/derivados. */
interface RawRow extends AttendanceConfirmation {
  status: AttendanceStatus;
  patient: (AttendanceRow['patient'] & { team: AttendanceRow['team'] }) | null;
  alert: (AttendanceRow['alert'] & { vital_record: VitalSignRecord | null }) | null;
}

/**
 * Resolve nomes/papéis dos profissionais (quem atendeu + cirurgião) e monta as
 * `AttendanceRow` finais. Compartilhado entre `getMyAttendances` e
 * `getRecentByPatient` — mesma query base (`ATTENDANCE_SELECT`), filtros diferentes.
 */
async function enrichAttendanceRows(raw: RawRow[]): Promise<AttendanceRow[]> {
  const ids = new Set<string>();
  for (const r of raw) {
    if (r.attended_by) ids.add(r.attended_by);
    if (r.patient?.team?.main_surgeon_id) ids.add(r.patient.team.main_surgeon_id);
  }
  const profiles = new Map<string, { name: string; role: UserRole }>();
  if (ids.size > 0) {
    // Nome/papel (não sensíveis) via view pública — M-09.
    const { data: profs } = await supabase.from('profiles_public').select('id, name, role').in('id', [...ids]);
    for (const p of profs ?? []) profiles.set(p.id, { name: p.name, role: p.role as UserRole });
  }

  return raw.map((r): AttendanceRow => {
    const { patient: rawPatient, alert: rawAlert, ...rest } = r;
    const team = rawPatient?.team ?? null;
    const patient: AttendanceRow['patient'] = rawPatient
      ? {
          id: rawPatient.id,
          name: rawPatient.name,
          birth_date: rawPatient.birth_date,
          phone: rawPatient.phone,
          surgery_date: rawPatient.surgery_date,
          hospital_discharge_date: rawPatient.hospital_discharge_date,
          team_id: rawPatient.team_id,
          current_status: rawPatient.current_status,
          surgery_type: rawPatient.surgery_type,
          hospital: rawPatient.hospital,
        }
      : null;
    const vital_record = rawAlert?.vital_record ?? null;
    const alert = rawAlert
      ? {
          id: rawAlert.id,
          status: rawAlert.status,
          type: rawAlert.type,
          description: rawAlert.description,
          ignored_reason: rawAlert.ignored_reason,
          created_at: rawAlert.created_at,
          in_analysis_at: rawAlert.in_analysis_at,
          attended_at: rawAlert.attended_at,
        }
      : null;
    const prof = r.attended_by ? profiles.get(r.attended_by) : undefined;
    const surgeonId = team?.main_surgeon_id ?? null;
    const clinical_status: ClinicalStatus = alert?.status ?? rawPatient?.current_status ?? 'GREEN';
    const alert_level: AttendanceAlertLevel | null =
      alert?.status === 'RED' || alert?.status === 'YELLOW' ? alert.status : null;
    return {
      ...rest,
      patient,
      team,
      alert,
      vital_record,
      professional_name: prof?.name ?? null,
      professional_role: prof?.role ?? null,
      surgeon_name: surgeonId ? profiles.get(surgeonId)?.name ?? null : null,
      origin: r.alert_id ? 'ALERT' : 'MANUAL_REVIEW',
      related_vital_sign: alert?.type ?? null,
      clinical_status,
      alert_level,
    };
  });
}

export const attendanceService = {
  /**
   * Lista os atendimentos visíveis ao usuário (RLS) já enriquecidos.
   * Ordena do mais recente para o mais antigo.
   */
  async getMyAttendances(): Promise<AttendanceRow[]> {
    const { data, error } = await supabase
      .from('attendance_confirmations')
      .select(ATTENDANCE_SELECT)
      .in('status', ['ATTENDED', 'IGNORED'])
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return enrichAttendanceRows((data as unknown as RawRow[]) ?? []);
  },

  /**
   * Atendimentos FINALIZADOS (Atendido/Ignorado) de UM paciente numa janela de
   * horas (padrão 48h), do mais recente para o mais antigo. Dá contexto de
   * decisão no "Detalhes do Alerta" — mesma query/enriquecimento de
   * `getMyAttendances`, só filtrada por paciente e período. RLS de
   * `attendance_confirmations` já limita ao escopo do usuário.
   */
  async getRecentByPatient(patientId: string, hours = 48): Promise<AttendanceRow[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('attendance_confirmations')
      .select(ATTENDANCE_SELECT)
      .eq('patient_id', patientId)
      .in('status', ['ATTENDED', 'IGNORED'])
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return enrichAttendanceRows((data as unknown as RawRow[]) ?? []);
  },

  /** Resumo agregado para os cards do topo (a partir do conjunto carregado). */
  summarize(rows: AttendanceRow[]): AttendanceSummary {
    let today = 0, red = 0, yellow = 0, attended = 0, ignored = 0;
    for (const r of rows) {
      if (isToday(r.created_at)) today++;
      if (r.alert_level === 'RED') red++;
      if (r.alert_level === 'YELLOW') yellow++;
      if (r.status === 'ATTENDED') attended++;
      if (r.status === 'IGNORED') ignored++;
    }
    return { total: rows.length, today, red, yellow, attended, ignored };
  },

  /**
   * Linha do tempo do atendimento. Quando há alerta de origem, traz todos os
   * eventos daquele alerta (mesma fonte da aba Alertas); sem alerta, devolve a
   * própria confirmação como evento único.
   */
  async getTimeline(row: AttendanceRow): Promise<AttendanceConfirmation[]> {
    if (!row.alert_id) {
      return [
        {
          id: row.id,
          patient_id: row.patient_id,
          alert_id: null,
          attended_by: row.attended_by,
          status: row.status,
          observation: row.observation,
          created_at: row.created_at,
        },
      ];
    }
    const { data, error } = await supabase
      .from('attendance_confirmations')
      .select('*')
      .eq('alert_id', row.alert_id)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as AttendanceConfirmation[]) ?? [];
  },

  /**
   * Atualiza a observação/conduta registrada via RPC `alert_update_observation`
   * (SECURITY DEFINER; revalida o vínculo por equipe). A escrita direta na tabela
   * foi removida (M-08): a trilha de atendimento só muda por RPC.
   */
  async updateObservation(id: string, observation: string): Promise<void> {
    const { error } = await supabase.rpc('alert_update_observation', { p_id: id, p_observation: observation });
    if (error) throw new Error(error.message);
  },

};
