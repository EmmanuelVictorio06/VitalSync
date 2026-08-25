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
import { effectiveSeverity, isWithNursing } from '../lib/alertSeverity';
import { homologationService } from './homologationService';
import type { Role } from '@vitalsync/shared';
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
    /** Resumo de prontuário (texto livre, opcional) — histórico, comorbidades, alergias, medicação de uso contínuo. */
    medical_record_summary: string | null;
    /** Variáveis clínicas/cirúrgicas do estudo (protocolo 5.9) — contexto de decisão na triagem. */
    sex: 'M' | 'F' | null;
    weight_kg: number | null;
    height_cm: number | null;
    comorbidities: string[];
    length_of_stay_days: number | null;
    alternative_phone: string | null;
    tcle_accepted_at: string | null;
  } | null;
  team: { team_number: number; main_surgeon_id: string | null } | null;
  vital_record: VitalSignRecord | null;
  /** Nomes resolvidos (não vêm do join por FK para evitar fragilidade). */
  surgeon_name: string | null;
  attended_by_name: string | null;
  /** Quem travou o alerta para atendimento ("EM ANÁLISE POR …"). */
  in_analysis_by_name: string | null;
  /** Enfermeiro a quem o alerta está oferecido ("aguardando …" — 0068). */
  assigned_nurse_name: string | null;
  /** Quem escalou o caso para o médico (0064). Null em escalonamento automático. */
  escalated_by_name: string | null;
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

/** Linha da lista acionável de falhas de notificação (painel do Admin — 0071). */
export interface FailedNotificationRow {
  id: string;
  alertId: string | null;
  patientName: string;
  alertStatus: string | null;
  recipientName: string | null;
  retryCount: number;
  /** true = esgotou as tentativas automáticas; só reenvio manual resolve. */
  exhausted: boolean;
  errorMessage: string | null;
  createdAt: string;
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
    medical_record_summary, sex, weight_kg, height_cm, comorbidities, length_of_stay_days,
    alternative_phone, tcle_accepted_at,
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
      if (r.assigned_nurse_id) ids.add(r.assigned_nurse_id);
      if (r.escalated_by) ids.add(r.escalated_by);
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
      r.assigned_nurse_name = r.assigned_nurse_id ? names.get(r.assigned_nurse_id) ?? null : null;
      r.escalated_by_name = r.escalated_by ? names.get(r.escalated_by) ?? null : null;
    }
    return rows;
  },

  /**
   * Resumo agregado para os cards do topo (a partir do conjunto já carregado).
   *
   * As contagens de severidade usam a severidade EFETIVA (0077): um amarelo
   * escalado conta como vermelho, igual ao que o roteamento de notificação faz.
   * Sem isso o card "Vermelhos" divergiria de quem realmente foi avisado.
   */
  summarize(alerts: AlertRow[]): AlertSummary {
    const activePatients = new Set<string>();
    let pending = 0, inAnalysis = 0, red = 0, yellow = 0, attended = 0, attendedToday = 0;
    for (const a of alerts) {
      const sev = effectiveSeverity(a);
      if (sev === 'RED') red++;
      if (sev === 'YELLOW') yellow++;
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
  async getUnattendedCount(viewer?: { role: Role | null | undefined; id: string | null }): Promise<number> {
    const { data, error } = await supabase
      .from('clinical_alerts')
      .select('id, status, escalated_at, attendance_status, attended, in_analysis_by, patient:patients(status)')
      .in('attendance_status', ['PENDING', 'IN_ANALYSIS']);
    if (error) return 0;
    return ((data ?? []) as unknown as Array<{
      status: string;
      escalated_at: string | null;
      attendance_status: string;
      attended: boolean;
      in_analysis_by: string | null;
      patient: { status: string } | Array<{ status: string }> | null;
    }>)
      .filter((a) => {
        const p = a.patient;
        if (!p) return false;
        const ativo = Array.isArray(p) ? p[0]?.status === 'ACTIVE' : p.status === 'ACTIVE';
        if (!ativo) return false;
        // O badge conta a fila DELE: para o médico, o amarelo não escalado é da
        // enfermagem (0077) e não pode inflar a contagem de pendências.
        return !isWithNursing(a, viewer?.role, viewer?.id);
      })
      .length;
  },

  /**
   * Badge da enfermagem: alertas amarelos ofertados a mim + os da fila aberta
   * (sem dono ou com oferta vencida). Exclui escalados e pacientes inativos.
   */
  async getNurseQueueCount(): Promise<number> {
    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id ?? null;
    const { data, error } = await supabase
      .from('clinical_alerts')
      .select('id, assigned_nurse_id, offer_expires_at, patient:patients(status)')
      .eq('status', 'YELLOW')
      .eq('attendance_status', 'PENDING')
      .is('escalated_at', null)
      .is('in_analysis_by', null);
    if (error) return 0;

    const now = Date.now();
    return ((data ?? []) as unknown as Array<{
      assigned_nurse_id: string | null;
      offer_expires_at: string | null;
      patient: { status: string } | Array<{ status: string }> | null;
    }>).filter((a) => {
      const p = Array.isArray(a.patient) ? a.patient[0] : a.patient;
      if (p?.status !== 'ACTIVE') return false;
      const expirada = !a.offer_expires_at || new Date(a.offer_expires_at).getTime() <= now;
      // Fila aberta (sem dono ou oferta vencida) ou oferta válida para mim.
      return !a.assigned_nurse_id || expirada || a.assigned_nurse_id === me;
    }).length;
  },

  /**
   * Notificações que falharam, para a lista acionável do Admin. Traz paciente,
   * severidade do alerta e tentativas já feitas — o contador sozinho não diz
   * o que fazer. `escalated_failure_at` marca as que esgotaram o retry (0071).
   */
  async getFailedNotifications(): Promise<FailedNotificationRow[]> {
    const { data, error } = await supabase
      .from('notification_logs')
      .select(
        'id, alert_id, recipient_name, recipient_phone, retry_count, escalated_failure_at, created_at, ' +
          'error_message, patient:patients(name), alert:clinical_alerts(status)',
      )
      .in('status', ['FAILED', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
      const patient = r.patient as { name: string } | Array<{ name: string }> | null;
      const alert = r.alert as { status: string } | Array<{ status: string }> | null;
      return {
        id: String(r.id),
        alertId: (r.alert_id as string | null) ?? null,
        patientName: (Array.isArray(patient) ? patient[0]?.name : patient?.name) ?? '—',
        alertStatus: (Array.isArray(alert) ? alert[0]?.status : alert?.status) ?? null,
        recipientName: (r.recipient_name as string | null) ?? null,
        retryCount: Number(r.retry_count ?? 0),
        exhausted: Boolean(r.escalated_failure_at),
        errorMessage: (r.error_message as string | null) ?? null,
        createdAt: String(r.created_at),
      };
    });
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

  /* --------------------- Triagem de enfermagem (0064–0068) ----------------- */

  /**
   * Assume o alerta (da oferta ou da fila aberta) e já o coloca em análise.
   * A corrida entre dois enfermeiros é decidida pelo claim atômico no banco:
   * quem perder recebe "já está em análise por outro profissional".
   */
  async claimOffer(alertId: string): Promise<void> {
    const { error } = await supabase.rpc('nurse_claim_alert', { p_alert: alertId });
    if (error) throw new Error(error.message);
  },

  /** Devolve o alerta à fila aberta (recusa explícita da oferta). */
  async declineOffer(alertId: string): Promise<void> {
    const { error } = await supabase.rpc('nurse_decline_alert', { p_alert: alertId });
    if (error) throw new Error(error.message);
  },

  /**
   * Escala o caso para o médico. NÃO altera o `status` do alerta — a severidade
   * clínica continua sendo a que `eval_clinical_status` calculou (0064).
   */
  async escalate(alertId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('alert_escalate_to_red', { p_alert: alertId, p_reason: reason });
    if (error) throw new Error(error.message);
  },

  /**
   * Registra o contato ativo na timeline SEM finalizar o alerta — é o caminho
   * do enfermeiro num alerta vermelho, que ele não pode fechar.
   */
  async registerContact(alertId: string, note: string): Promise<void> {
    const { error } = await supabase.rpc('alert_register_contact', { p_alert: alertId, p_note: note });
    if (error) throw new Error(error.message);
  },
};
