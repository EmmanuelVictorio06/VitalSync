/**
 * Visões de equipe (somente leitura) agregadas do Supabase. O RLS aplica o
 * escopo: ADMIN vê todas; cirurgião/associado, apenas as suas.
 */
import { supabase } from '../lib/supabase';
import type { ClinicalStatus, EntityStatus, RoleInTeam } from './types';

export interface TeamStats {
  doctors: number;
  monitoring: number;
  stable: number;
  attention: number;
  alert: number;
  unattendedAlerts: number;
}

export interface TeamSummary {
  id: string;
  number: number;
  surgeonName: string;
  status: EntityStatus;
  myRole: RoleInTeam;
  stats: TeamStats;
}

export interface TeamMemberView {
  membershipId: string | null; // null = é o cirurgião responsável
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  isSurgeon: boolean;
}

export interface TeamPatientAlert {
  /** Sinal que disparou (Temperatura, Saturação, Dor…) — "principal alteração". */
  type: string | null;
  status: ClinicalStatus;
  createdAt: string;
}

export interface TeamPatientView {
  id: string;
  name: string;
  surgeryType: string;
  surgeryDate: string | null;
  dischargeDate: string | null;
  status: ClinicalStatus;
  /** Há alerta clínico ainda não atendido (Pendente/Em análise). */
  hasUnattendedAlert: boolean;
  /** Alerta não atendido mais recente — alimenta a "principal alteração". */
  lastAlert: TeamPatientAlert | null;
}

const STATUS_PRIORITY: Record<ClinicalStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

/**
 * Ordena pacientes por prioridade clínica: vermelho → amarelo → verde; depois,
 * quem tem alerta não atendido; depois, alerta mais recente primeiro.
 */
export function byClinicalPriority(a: TeamPatientView, b: TeamPatientView): number {
  const w = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (w !== 0) return w;
  if (a.hasUnattendedAlert !== b.hasUnattendedAlert) return a.hasUnattendedAlert ? -1 : 1;
  return (b.lastAlert?.createdAt ?? '').localeCompare(a.lastAlert?.createdAt ?? '');
}

/** Pacientes que exigem atenção: em alerta, em atenção ou com alerta não atendido. */
export function getPriorityPatients(patients: TeamPatientView[]): TeamPatientView[] {
  return patients
    .filter((p) => p.status === 'RED' || p.status === 'YELLOW' || p.hasUnattendedAlert)
    .sort(byClinicalPriority);
}

/** Dia pós-operatório (D+N) a partir da data da cirurgia. Null se inválido/futuro. */
export function postOpDay(surgeryDate: string | null): number | null {
  if (!surgeryDate) return null;
  const surgery = new Date(`${surgeryDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(surgery.getTime())) return null;
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((t.getTime() - surgery.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

export interface TeamDetail {
  summary: TeamSummary;
  members: TeamMemberView[];
  patients: TeamPatientView[];
}

function statsFrom(
  teamId: string,
  patients: Array<{ team_id: string; current_status: string }>,
  alerts: Array<{ team_id: string }>,
  doctors: number,
): TeamStats {
  const tp = patients.filter((p) => p.team_id === teamId);
  const cnt = (s: string) => tp.filter((p) => p.current_status === s).length;
  return {
    doctors,
    monitoring: tp.length,
    stable: cnt('GREEN'),
    attention: cnt('YELLOW'),
    alert: cnt('RED'),
    unattendedAlerts: alerts.filter((a) => a.team_id === teamId).length,
  };
}

export const teamViewService = {
  /** Equipes visíveis ao usuário, com cirurgião, contagem de médicos e stats. */
  async listMyTeams(): Promise<TeamSummary[]> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? '';

    const [teamsRes, patientsRes, alertsRes] = await Promise.all([
      supabase
        .from('medical_teams')
        .select('id, team_number, status, main_surgeon_id, surgeon:profiles!medical_teams_main_surgeon_id_fkey(name), members:team_members(status)')
        .order('team_number'),
      supabase.from('patients').select('team_id, current_status').is('deleted_at', null),
      supabase.from('clinical_alerts').select('team_id').eq('attended', false),
    ]);
    if (teamsRes.error) throw new Error(teamsRes.error.message);

    const patients = (patientsRes.data ?? []) as Array<{ team_id: string; current_status: string }>;
    const alerts = (alertsRes.data ?? []) as Array<{ team_id: string }>;
    const teams = (teamsRes.data ?? []) as unknown as Array<{
      id: string;
      team_number: number;
      status: EntityStatus;
      main_surgeon_id: string | null;
      surgeon: { name: string } | null;
      members: Array<{ status: string }>;
    }>;

    return teams.map((t) => {
      const activeMembers = t.members.filter((m) => m.status === 'ACTIVE').length;
      return {
        id: t.id,
        number: t.team_number,
        surgeonName: t.surgeon?.name ?? '—',
        status: t.status,
        myRole: t.main_surgeon_id === uid ? 'MAIN_SURGEON' : 'ASSOCIATED_DOCTOR',
        stats: statsFrom(t.id, patients, alerts, activeMembers + (t.main_surgeon_id ? 1 : 0)),
      };
    });
  },

  /** Detalhe de uma equipe (membros + pacientes). */
  async getTeamDetail(teamId: string): Promise<TeamDetail> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? '';

    const { data: team, error } = await supabase
      .from('medical_teams')
      .select(
        'id, team_number, status, main_surgeon_id, surgeon:profiles!medical_teams_main_surgeon_id_fkey(id,name,email,whatsapp), members:team_members(id, status, doctor:profiles(id,name,email,whatsapp))',
      )
      .eq('id', teamId)
      .single();
    if (error) throw new Error(error.message);
    const t = team as unknown as {
      id: string;
      team_number: number;
      status: EntityStatus;
      main_surgeon_id: string | null;
      surgeon: { id: string; name: string; email: string; whatsapp: string | null } | null;
      members: Array<{ id: string; status: string; doctor: { id: string; name: string; email: string; whatsapp: string | null } | null }>;
    };

    const [patientsRes, alertsRes] = await Promise.all([
      supabase
        .from('patients')
        .select('id, name, current_status, surgery_date, hospital_discharge_date, surgery_type:surgery_types(name)')
        .eq('team_id', teamId)
        .is('deleted_at', null),
      supabase
        .from('clinical_alerts')
        .select('team_id, patient_id, type, status, created_at')
        .eq('attended', false)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false }),
    ]);

    const patientsRaw = (patientsRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      current_status: ClinicalStatus;
      surgery_date: string | null;
      hospital_discharge_date: string | null;
      surgery_type: { name: string } | null;
    }>;

    // Alerta não atendido mais recente por paciente (lista já vem ordenada desc).
    const alertsByPatient = new Map<string, TeamPatientAlert>();
    for (const a of (alertsRes.data ?? []) as Array<{ patient_id: string; type: string | null; status: ClinicalStatus; created_at: string }>) {
      if (!alertsByPatient.has(a.patient_id)) {
        alertsByPatient.set(a.patient_id, { type: a.type, status: a.status, createdAt: a.created_at });
      }
    }

    const members: TeamMemberView[] = [];
    if (t.surgeon) {
      members.push({ membershipId: null, id: t.surgeon.id, name: t.surgeon.name, email: t.surgeon.email, whatsapp: t.surgeon.whatsapp, isSurgeon: true });
    }
    for (const m of t.members.filter((x) => x.status === 'ACTIVE' && x.doctor)) {
      members.push({ membershipId: m.id, id: m.doctor!.id, name: m.doctor!.name, email: m.doctor!.email, whatsapp: m.doctor!.whatsapp, isSurgeon: false });
    }

    const patients: TeamPatientView[] = patientsRaw.map((p) => ({
      id: p.id,
      name: p.name,
      surgeryType: p.surgery_type?.name ?? '—',
      surgeryDate: p.surgery_date,
      dischargeDate: p.hospital_discharge_date,
      status: p.current_status,
      hasUnattendedAlert: alertsByPatient.has(p.id),
      lastAlert: alertsByPatient.get(p.id) ?? null,
    }));

    const activeMembers = t.members.filter((m) => m.status === 'ACTIVE').length;
    const summary: TeamSummary = {
      id: t.id,
      number: t.team_number,
      surgeonName: t.surgeon?.name ?? '—',
      status: t.status,
      myRole: t.main_surgeon_id === uid ? 'MAIN_SURGEON' : 'ASSOCIATED_DOCTOR',
      stats: statsFrom(
        t.id,
        patientsRaw.map((p) => ({ team_id: t.id, current_status: p.current_status })),
        (alertsRes.data ?? []) as Array<{ team_id: string }>,
        activeMembers + (t.main_surgeon_id ? 1 : 0),
      ),
    };

    return { summary, members, patients };
  },

  /** Equipe do cirurgião logado (onde ele é o responsável). */
  async getMyMainTeam(): Promise<TeamDetail | null> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return null;
    const { data: team } = await supabase.from('medical_teams').select('id').eq('main_surgeon_id', uid).limit(1).maybeSingle();
    if (!team) return null;
    return this.getTeamDetail((team as { id: string }).id);
  },

  /** Todas as equipes em que o cirurgião logado é o responsável. */
  async getMyMainTeams(): Promise<TeamDetail[]> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return [];
    const { data: teams, error } = await supabase
      .from('medical_teams')
      .select('id')
      .eq('main_surgeon_id', uid)
      .order('team_number');
    if (error) throw new Error(error.message);
    const ids = ((teams ?? []) as Array<{ id: string }>).map((t) => t.id);
    return Promise.all(ids.map((id) => this.getTeamDetail(id)));
  },

  /** Todas as equipes em que o médico logado participa como associado. */
  async getMyAssociatedTeams(): Promise<TeamDetail[]> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return [];
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('doctor_id', uid)
      .eq('status', 'ACTIVE');
    if (error) throw new Error(error.message);
    const ids = [...new Set(((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id))];
    const details = await Promise.all(ids.map((id) => this.getTeamDetail(id)));
    return details.sort((a, b) => a.summary.number - b.summary.number);
  },
};
