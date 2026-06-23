/** Perfil do usuário (role, nome) — usado para menus e RBAC no frontend. */
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from './types';

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
};
