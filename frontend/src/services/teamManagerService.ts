/** Operações específicas do Gerente de Equipe. */
import { supabase } from '../lib/supabase';
import type { Profile } from './types';

export interface ManagerSurgeonLink {
  id: string;
  team_manager_id: string;
  surgeon_id: string;
  is_active: boolean;
  created_at: string;
  surgeon?: Pick<Profile, 'id' | 'name' | 'email' | 'professional_tag'> | null;
}

export const teamManagerService = {
  /** Vínculos ativos do gerente logado (com dados do cirurgião). */
  async getMyLinks(): Promise<ManagerSurgeonLink[]> {
    const { data, error } = await supabase
      .from('team_manager_surgeons')
      .select('*, surgeon:profiles!team_manager_surgeons_surgeon_id_fkey(id,name,email,professional_tag)')
      .eq('is_active', true)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data as unknown as ManagerSurgeonLink[]) ?? [];
  },

  /** (Admin) Todos os vínculos de um gerente específico. */
  async getLinksForManager(managerId: string): Promise<ManagerSurgeonLink[]> {
    const { data, error } = await supabase
      .from('team_manager_surgeons')
      .select('*, surgeon:profiles!team_manager_surgeons_surgeon_id_fkey(id,name,email,professional_tag)')
      .eq('team_manager_id', managerId)
      .eq('is_active', true)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data as unknown as ManagerSurgeonLink[]) ?? [];
  },

  /** (Admin) Vincula um Gerente a um Cirurgião via RPC. */
  async linkManagerToSurgeon(managerId: string, surgeonId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_link_team_manager', {
      p_manager: managerId,
      p_surgeon: surgeonId,
    });
    if (error) throw new Error(error.message);
  },

  /** (Admin) Desvincula um Gerente de um Cirurgião. */
  async unlinkManagerFromSurgeon(managerId: string, surgeonId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_unlink_team_manager', {
      p_manager: managerId,
      p_surgeon: surgeonId,
    });
    if (error) throw new Error(error.message);
  },
};
