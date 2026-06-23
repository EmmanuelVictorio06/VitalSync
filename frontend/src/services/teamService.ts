/** Equipes médicas e seus membros (RLS aplica o escopo por perfil). */
import { supabase } from '../lib/supabase';
import type { MedicalTeam, Profile, RoleInTeam, TeamMember } from './types';

export interface TeamMemberWithProfile extends TeamMember {
  profile: Pick<Profile, 'id' | 'name' | 'email' | 'whatsapp' | 'role'> | null;
}

export const teamService = {
  /** Equipes visíveis ao usuário (ADMIN = todas; demais = as suas — via RLS). */
  async list(): Promise<MedicalTeam[]> {
    const { data, error } = await supabase.from('medical_teams').select('*').order('team_number');
    if (error) throw new Error(error.message);
    return (data as MedicalTeam[]) ?? [];
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
    if (error) throw new Error(error.message);
    return data as MedicalTeam;
  },

  async addMember(input: { team_id: string; doctor_id: string; role_in_team?: RoleInTeam }): Promise<void> {
    const { error } = await supabase
      .from('team_members')
      .insert({ role_in_team: 'ASSOCIATED_DOCTOR', ...input });
    if (error) throw new Error(error.message);
  },

  async removeMember(memberId: string): Promise<void> {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId);
    if (error) throw new Error(error.message);
  },
};
