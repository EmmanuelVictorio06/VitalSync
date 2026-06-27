/** Equipes médicas e seus membros (RLS aplica o escopo por perfil). */
import { supabase } from '../lib/supabase';
import { profileService } from './profileService';
import type { EntityStatus, MedicalTeam, Profile, RoleInTeam, TeamMember } from './types';

export interface TeamMemberWithProfile extends TeamMember {
  profile: Pick<Profile, 'id' | 'name' | 'email' | 'whatsapp' | 'role'> | null;
}

/** Resumo geral exibido nos cards do topo de "Gerenciar Equipes". */
export interface AdminTeamSummary {
  totalTeams: number;
  activeTeams: number;
  mainSurgeons: number;
  associatedDoctors: number;
  linkedPatients: number;
  teamsWithAlerts: number;
}

/** Resultado de uma tentativa de exclusão (pode virar inativação por segurança). */
export type DeleteTeamResult = { kind: 'deleted' } | { kind: 'inactivated'; reason: string };

export const teamService = {
  /** Equipes visíveis ao usuário (ADMIN = todas; demais = as suas — via RLS). */
  async list(): Promise<MedicalTeam[]> {
    const { data, error } = await supabase.from('medical_teams').select('*').order('team_number');
    if (error) throw new Error(error.message);
    return (data as MedicalTeam[]) ?? [];
  },

  /** Alias semântico para a feature de Gerenciar Equipes. */
  getTeams(): Promise<MedicalTeam[]> {
    return this.list();
  },

  async getTeamById(teamId: string): Promise<MedicalTeam | null> {
    const { data, error } = await supabase.from('medical_teams').select('*').eq('id', teamId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MedicalTeam) ?? null;
  },

  async getMembers(teamId: string): Promise<TeamMemberWithProfile[]> {
    const { data, error } = await supabase
      .from('team_members')
      .select('*, profile:profiles!team_members_doctor_id_fkey(id,name,email,whatsapp,role)')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return (data as unknown as TeamMemberWithProfile[]) ?? [];
  },

  /** Cria equipe (ADMIN). O cirurgião responsável é um profile existente. */
  async create(input: { team_number: number; main_surgeon_id: string }): Promise<MedicalTeam> {
    const { data, error } = await supabase.from('medical_teams').insert(input).select().single();
    if (error) throw new Error(translateError(error.message));
    return data as MedicalTeam;
  },

  /** Atualiza número, cirurgião responsável e/ou status da equipe (ADMIN). */
  async updateTeam(
    teamId: string,
    input: Partial<Pick<MedicalTeam, 'team_number' | 'main_surgeon_id' | 'status'>>,
  ): Promise<MedicalTeam> {
    const { data, error } = await supabase.from('medical_teams').update(input).eq('id', teamId).select().single();
    if (error) throw new Error(translateError(error.message));
    return data as MedicalTeam;
  },

  activateTeam(teamId: string): Promise<MedicalTeam> {
    return this.updateTeam(teamId, { status: 'ACTIVE' });
  },

  inactivateTeam(teamId: string): Promise<MedicalTeam> {
    return this.updateTeam(teamId, { status: 'INACTIVE' });
  },

  /**
   * Exclui a equipe se não houver vínculos (pacientes/registros/alertas).
   * Havendo vínculo, por segurança apenas INATIVA e informa o motivo.
   */
  async deleteTeam(teamId: string): Promise<DeleteTeamResult> {
    const [patients, alerts] = await Promise.all([
      supabase.from('patients').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
      supabase.from('clinical_alerts').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
    ]);
    if ((patients.count ?? 0) > 0 || (alerts.count ?? 0) > 0) {
      await this.inactivateTeam(teamId);
      return {
        kind: 'inactivated',
        reason: 'Esta equipe possui pacientes ou registros vinculados. Por segurança, ela foi apenas inativada.',
      };
    }
    const { error } = await supabase.from('medical_teams').delete().eq('id', teamId);
    if (error) {
      // Algum vínculo não previsto (FK) → cai para inativação.
      await this.inactivateTeam(teamId);
      return { kind: 'inactivated', reason: 'Esta equipe possui registros vinculados. Por segurança, ela foi apenas inativada.' };
    }
    return { kind: 'deleted' };
  },

  async addMember(input: { team_id: string; doctor_id: string; role_in_team?: RoleInTeam }): Promise<void> {
    const { error } = await supabase
      .from('team_members')
      .insert({ role_in_team: 'ASSOCIATED_DOCTOR', ...input });
    if (error) throw new Error(translateError(error.message));
  },

  async removeMember(memberId: string): Promise<void> {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId);
    if (error) throw new Error(error.message);
  },

  /** Estatísticas de uma equipe (pacientes por status e alertas pendentes). */
  async getTeamStats(teamId: string): Promise<{ monitoring: number; stable: number; attention: number; alert: number; unattendedAlerts: number }> {
    const [patientsRes, alertsRes] = await Promise.all([
      supabase.from('patients').select('current_status').eq('team_id', teamId).is('deleted_at', null),
      supabase.from('clinical_alerts').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('attended', false),
    ]);
    const tp = (patientsRes.data ?? []) as Array<{ current_status: string }>;
    const cnt = (s: string) => tp.filter((p) => p.current_status === s).length;
    return {
      monitoring: tp.length,
      stable: cnt('GREEN'),
      attention: cnt('YELLOW'),
      alert: cnt('RED'),
      unattendedAlerts: alertsRes.count ?? 0,
    };
  },

  /** Cards de resumo do topo (calculados sobre todas as equipes visíveis). */
  async getAdminTeamSummary(): Promise<AdminTeamSummary> {
    const [teamsRes, membersRes, patientsRes, alertsRes] = await Promise.all([
      supabase.from('medical_teams').select('id, status, main_surgeon_id'),
      supabase.from('team_members').select('doctor_id, role_in_team').eq('status', 'ACTIVE'),
      supabase.from('patients').select('team_id').is('deleted_at', null),
      supabase.from('clinical_alerts').select('team_id').eq('attended', false),
    ]);
    if (teamsRes.error) throw new Error(teamsRes.error.message);

    const teams = (teamsRes.data ?? []) as Array<{ id: string; status: EntityStatus; main_surgeon_id: string | null }>;
    const members = (membersRes.data ?? []) as Array<{ doctor_id: string; role_in_team: RoleInTeam }>;
    const patients = (patientsRes.data ?? []) as Array<{ team_id: string }>;
    const alerts = (alertsRes.data ?? []) as Array<{ team_id: string }>;

    const surgeons = new Set(teams.map((t) => t.main_surgeon_id).filter(Boolean) as string[]);
    const associates = new Set(members.filter((m) => m.role_in_team === 'ASSOCIATED_DOCTOR').map((m) => m.doctor_id));
    const teamsWithAlerts = new Set(alerts.map((a) => a.team_id));

    return {
      totalTeams: teams.length,
      activeTeams: teams.filter((t) => t.status === 'ACTIVE').length,
      mainSurgeons: surgeons.size,
      associatedDoctors: associates.size,
      linkedPatients: patients.length,
      teamsWithAlerts: teamsWithAlerts.size,
    };
  },

  /**
   * Cadastra um médico (cria a CONTA de login + perfil). Só ADMIN. O e-mail/senha
   * servem para login; o telefone fica no perfil para os alertas de WhatsApp.
   */
  createDoctor(input: { name: string; email: string; password: string; whatsapp: string; role: RoleInTeam }): Promise<string> {
    return profileService.createDoctorProfile(input);
  },

  /** Cirurgiões principais disponíveis (para a tela de Equipes). */
  getAvailableMainSurgeons(): Promise<Profile[]> {
    return profileService.getMainSurgeons();
  },

  /** Médicos associados disponíveis (para a tela de Equipes). */
  getAvailableAssociatedDoctors(): Promise<Profile[]> {
    return profileService.getAssociatedDoctors();
  },

  /**
   * Equipes vinculadas a um usuário (resumo). Usado por "Gerenciar Usuários" só
   * para exibir o vínculo + link; o gerenciamento fica em "Gerenciar Equipes".
   */
  async getTeamsByUser(userId: string): Promise<import('./types').UserTeamLink[]> {
    const { userService } = await import('./userService');
    return userService.getUserTeamLinks(userId);
  },
};

/** Traduz mensagens cruas do Postgres/PostgREST para o usuário final. */
function translateError(message: string): string {
  if (/team_number/i.test(message) && /duplicate|unique/i.test(message)) return 'Número de equipe já utilizado.';
  if (/team_members.*team_id.*doctor_id|unique/i.test(message) && /team_members/i.test(message))
    return 'Este médico já está vinculado à equipe.';
  return message;
}
