/** Perfil do usuário (role, nome) — usado para menus e RBAC no frontend. */
import { supabase } from '../lib/supabase';
import type { Profile, RoleInTeam, UserRole } from './types';

export const profileService = {
  /** Perfil do usuário logado (define o papel e os menus). */
  async getMyProfile(): Promise<Profile | null> {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (error) throw new Error(error.message);
    return data as Profile;
  },

  async getProfile(id: string): Promise<Profile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Profile) ?? null;
  },

  /** Lista profissionais por papel (ex.: cirurgiões para o dropdown de equipe). */
  async listByRole(role: UserRole): Promise<Profile[]> {
    const { data, error } = await supabase.from('profiles').select('*').eq('role', role).order('name');
    if (error) throw new Error(error.message);
    return (data as Profile[]) ?? [];
  },

  /** Todos os médicos (cirurgiões principais + associados). */
  async getDoctors(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['MAIN_SURGEON', 'ASSOCIATED_DOCTOR'])
      .order('name');
    if (error) throw new Error(error.message);
    return (data as Profile[]) ?? [];
  },

  /** Cirurgiões principais (para escolher o responsável pela equipe). */
  getMainSurgeons(): Promise<Profile[]> {
    return this.listByRole('MAIN_SURGEON');
  },

  /** Médicos associados (para vincular à equipe). */
  getAssociatedDoctors(): Promise<Profile[]> {
    return this.listByRole('ASSOCIATED_DOCTOR');
  },

  /**
   * Cria a CONTA de login + perfil de um médico (cirurgião ou associado). Só
   * ADMIN — usa a RPC `admin_create_doctor` (SECURITY DEFINER); nunca expõe a
   * service_role no frontend. Retorna o id do profile criado.
   */
  async createDoctorProfile(input: {
    name: string;
    email: string;
    password: string;
    whatsapp: string;
    role: RoleInTeam;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('admin_create_doctor', {
      p_name: input.name,
      p_email: input.email,
      p_password: input.password,
      p_whatsapp: input.whatsapp ?? '',
      p_role: input.role,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },
};
