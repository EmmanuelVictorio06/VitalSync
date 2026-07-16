/**
 * Alertas clínicos — central da aba "Alertas".
 *
 * Escopo por perfil é garantido pelo SUPABASE (RLS): `alerts_select` =
 * is_admin() OR is_team_member(team_id). Admin vê todos; cirurgião/associado
 * veem só os das suas equipes. O frontend NÃO escreve direto no alerta: as
 * mudanças de status passam por RPCs SECURITY DEFINER (0008_alerts.sql), que
 * exigem campos obrigatórios, gravam a timeline e auditam.
 */
import { supabase } from '../lib/supabase';
import { homologationService } from './homologationService';
import type {
  AttendanceConfirmation,
  ClinicalAlert,
  EntityStatus,
  NotificationLog,
  VitalSignRecord,
} from './types';

/** Linha enriquecida exibida na lista/detalhe (joins resolvidos no serviço). */
export interface AlertRow extends ClinicalAlert {
  patient: {
    id: string;
    name: string;
    birth_date: string | null;
    phone: string | null;
    surgery_date: string | null;
    hospital_discharge_date: string | null;
    team_id: string;
    status: EntityStatus;
    surgery_type: { name: string } | null;
    hospital: { name: string } | null;
  } | null;
  team: { team_number: number; main_surgeon_id: string | null } | null;
  vital_record: VitalSignRecord | null;
  /** Nomes resolvidos (não vêm do join por FK para evitar fragilidade). */
  surgeon_name: string | null;
  attended_by_name: string | null;
  /** Quem travou o alerta para atendimento ("EM ANÁLISE POR …"). */
  in_analysis_by_name: string | null;
}

export interface AlertSummary {
  total: number;
  pending: number;
  inAnalysis: number;
  red: number;
  yellow: number;
  attended: number;
  attendedToday: number;
  failedNotifications: number;
  patientsWithActiveAlert: number;
}

export interface TeamProfessional {
  id: string;
  name: string;
  role: 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';
}

const ALERT_SELECT = `
  *,
  patient:patients(
    id, name, birth_date, phone, surgery_date, hospital_discharge_date, team_id, status,
    surgery_type:surgery_types(name),
    hospital:hospitals(name)
  ),
  team:medical_teams(team_number, main_surgeon_id),
  vital_record:vital_sign_records(*)
` as const;

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export const alertService = {
  /** Lista os alertas visíveis ao usuário (RLS) já enriquecidos. */
  async getAlerts(): Promise<AlertRow[]> {
    // Fora do modo homologação, oculta alertas de teste (is_test) — M-14.
    const showTest = await homologationService.isActive();
    let query = supabase.from('clinical_alerts').select(ALERT_SELECT).order('created_at', { ascending: false });
    if (!showTest) query = query.eq('is_test', false);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    let rows = (data as unknown as AlertRow[]) ?? [];

    // Exclui alertas de pacientes inativos (soft-deleted).
    rows = rows.filter((r) => !r.patient || r.patient.status === 'ACTIVE');

    // Resolve nomes de profissionais (cirurgião + quem atendeu + quem travou) em 1 query.
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.team?.main_surgeon_id) ids.add(r.team.main_surgeon_id);
      if (r.attended_by) ids.add(r.attended_by);
      if (r.in_analysis_by) ids.add(r.in_analysis_by);
    }
    const names = new Map<string, string>();
    if (ids.size > 0) {
      // Resolução de nome (campo não sensível) via view pública — M-09.
      const { data: profs } = await supabase.from('profiles_public').select('id, name').in('id', [...ids]);
      for (const p of profs ?? []) names.set(p.id, p.name);
    }
    for (const r of rows) {
      r.surgeon_name = r.team?.main_surgeon_id ? names.get(r.team.main_surgeon_id) ?? null : null;
      r.attended_by_name = r.attended_by ? names.get(r.attended_by) ?? null : null;
      r.in_analysis_by_name = r.in_analysis_by ? names.get(r.in_analysis_by) ?? null : null;
    }
    return rows;
  },

  /** Resumo agregado para os cards do topo (a partir do conjunto já carregado). */
  summarize(alerts: AlertRow[]): AlertSummary {
    const activePatients = new Set<string>();
    let pending = 0, inAnalysis = 0, red = 0, yellow = 0, attended = 0, attendedToday = 0;
    for (const a of alerts) {
      if (a.status === 'RED') red++;
      if (a.status === 'YELLOW') yellow++;
      if (a.attendance_status === 'PENDING') pending++;
      if (a.attendance_status === 'IN_ANALYSIS') inAnalysis++;
      if (a.attendance_status === 'ATTENDED') {
        attended++;
        if (isToday(a.attended_at)) attendedToday++;
      }
      if ((a.attendance_status === 'PENDING' || a.attendance_status === 'IN_ANALYSIS') && a.patient) {
        activePatients.add(a.patient.id);
      }
    }
    return {
      total: alerts.length,
      pending,
      inAnalysis,
      red,
      yellow,
      attended,
      attendedToday,
      failedNotifications: 0, // preenchido sob demanda (ver getFailedNotificationCount)
      patientsWithActiveAlert: activePatients.size,
    };
  },

  /**
   * Conta os alertas NÃO atendidos (Pendente + Em análise) visíveis ao usuário
   * (RLS). Alimenta o badge da sidebar — diminui à medida que são atendidos.
   * Exclui alertas de pacientes inativos (soft-deleted).
   */
  async getUnattendedCount(): Promise<number> {
    const { data, error } = await supabase
      .from('clinical_alerts')
      .select('id, patient:patients(status)')
      .in('attendance_status', ['PENDING', 'IN_ANALYSIS']);
    if (error) return 0;
    return ((data ?? []) as unknown as Array<{ patient: { status: string } | Array<{ status: string }> | null }>)
      .filter((a) => {
        const p = a.patient;
        if (!p) return false;
        if (Array.isArray(p)) return p[0]?.status === 'ACTIVE';
        return p.status === 'ACTIVE';
      })
      .length;
  },

  /** Conta notificações com falha entre os alertas visíveis (card do Admin). */
  async getFailedNotificationCount(): Promise<number> {
    const { count, error } = await supabase
      .from('notification_logs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['FAILED', 'failed']);
    if (error) return 0;
    return count ?? 0;
  },

  /** Logs de notificação (WhatsApp) de um alerta. */
  async getNotificationLogs(alertId: string): Promise<NotificationLog[]> {
    const { data, error } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('alert_id', alertId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as NotificationLog[]) ?? [];
  },

  /** Linha do tempo (eventos de atendimento) de um alerta. */
  async getTimeline(alertId: string): Promise<AttendanceConfirmation[]> {
    const { data, error } = await supabase
      .from('attendance_confirmations')
      .select('*')
      .eq('alert_id', alertId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as AttendanceConfirmation[]) ?? [];
  },

  /** Profissionais da equipe (para escolher o responsável pelo atendimento). */
  async getTeamProfessionals(teamId: string): Promise<TeamProfessional[]> {
    const [{ data: team }, { data: members }] = await Promise.all([
      supabase.from('medical_teams').select('main_surgeon_id').eq('id', teamId).maybeSingle(),
      supabase.from('team_members').select('doctor_id, role_in_team').eq('team_id', teamId).eq('status', 'ACTIVE'),
    ]);
    const list: Array<{ id: string; role: TeamProfessional['role'] }> = [];
    if (team?.main_surgeon_id) list.push({ id: team.main_surgeon_id, role: 'MAIN_SURGEON' });
    for (const m of members ?? []) list.push({ id: m.doctor_id, role: m.role_in_team as TeamProfessional['role'] });

    const ids = [...new Set(list.map((x) => x.id))];
    if (ids.length === 0) return [];
    const { data: profs } = await supabase.from('profiles_public').select('id, name').in('id', ids);
    const names = new Map((profs ?? []).map((p) => [p.id, p.name]));
    // dedup mantendo a primeira ocorrência (cirurgião primeiro)
    const seen = new Set<string>();
    return list
      .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
      .map((x) => ({ id: x.id, name: names.get(x.id) ?? '—', role: x.role }));
  },

  /* ----------------------- Ações (via RPC SECURITY DEFINER) ---------------- */

  async markInAnalysis(alertId: string): Promise<void> {
    const { error } = await supabase.rpc('alert_set_in_analysis', { p_alert: alertId });
    if (error) throw new Error(error.message);
  },

  async markAttended(alertId: string, professionalId: string | null, observation: string): Promise<void> {
    const { error } = await supabase.rpc('alert_mark_attended', {
      p_alert: alertId,
      p_professional: professionalId,
      p_observation: observation,
    });
    if (error) throw new Error(error.message);
  },

  async ignore(alertId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('alert_ignore', { p_alert: alertId, p_reason: reason });
    if (error) throw new Error(error.message);
  },

  /** Libera o alerta de volta à fila (desfaz o "em análise"). */
  async releaseAnalysis(alertId: string): Promise<void> {
    const { error } = await supabase.rpc('alert_release_analysis', { p_alert: alertId });
    if (error) throw new Error(error.message);
  },

  async resendNotification(alertId: string): Promise<void> {
    const { error } = await supabase.rpc('alert_resend_notification', { p_alert: alertId });
    if (error) throw new Error(error.message);
  },
};
