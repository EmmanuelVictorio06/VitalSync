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

export interface TeamPatientView {
  id: string;
  name: string;
  surgeryType: string;
  dischargeDate: string | null;
  status: ClinicalStatus;
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
      supabase.from('patients').select('team_id, current_status').eq('status', 'ACTIVE'),
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
        .select('id, name, current_status, hospital_discharge_date, surgery_type:surgery_types(name)')
        .eq('team_id', teamId)
        .eq('status', 'ACTIVE'),
      supabase.from('clinical_alerts').select('team_id').eq('attended', false).eq('team_id', teamId),
    ]);

    const patientsRaw = (patientsRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      current_status: ClinicalStatus;
      hospital_discharge_date: string | null;
      surgery_type: { name: string } | null;
    }>;

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
      dischargeDate: p.hospital_discharge_date,
      status: p.current_status,
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
};
