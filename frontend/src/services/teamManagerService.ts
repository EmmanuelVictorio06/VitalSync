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

/** Vínculo visto pelo lado do cirurgião (com dados do gerente). */
export interface SurgeonManagerLink {
  id: string;
  team_manager_id: string;
  surgeon_id: string;
  is_active: boolean;
  created_at: string;
  manager?: Pick<Profile, 'id' | 'name' | 'email' | 'whatsapp' | 'professional_tag'> | null;
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

  /**
   * Gerentes ativamente vinculados a um cirurgião. Usado pela tela Gerenciar
   * Equipes (Admin) e por teamViewService.getTeamDetail() (drawer "Integrantes
   * da Equipe" — RLS 0037 libera o próprio cirurgião ler seus gerentes).
   */
  async getManagersOfSurgeon(surgeonId: string): Promise<SurgeonManagerLink[]> {
    const { data, error } = await supabase
      .from('team_manager_surgeons')
      .select('*, manager:profiles!team_manager_surgeons_team_manager_id_fkey(id,name,email,whatsapp,professional_tag)')
      .eq('surgeon_id', surgeonId)
      .eq('is_active', true)
      .order('created_at');
    if (error) throw new Error(translateError(error.message));
    return (data as unknown as SurgeonManagerLink[]) ?? [];
  },

  /** (Admin) Vincula um Gerente a um Cirurgião via RPC (o banco valida papéis + is_admin). */
  async linkManagerToSurgeon(managerId: string, surgeonId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_link_team_manager', {
      p_manager: managerId,
      p_surgeon: surgeonId,
    });
    if (error) throw new Error(translateError(error.message));
  },

  /** (Admin) Desvincula um Gerente de um Cirurgião. */
  async unlinkManagerFromSurgeon(managerId: string, surgeonId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_unlink_team_manager', {
      p_manager: managerId,
      p_surgeon: surgeonId,
    });
    if (error) throw new Error(translateError(error.message));
  },
};

/** Traduz erros das RPCs de vínculo (banco valida; aqui só a mensagem PT-BR). */
function translateError(message: string): string {
  if (/FORBIDDEN/.test(message)) return 'Você não tem permissão para esta ação.';
  if (/INVALID_MANAGER_ROLE/.test(message)) return 'O usuário selecionado não é um Gerente de Equipe.';
  if (/INVALID_SURGEON_ROLE/.test(message)) return 'O usuário selecionado não é um Médico Cirurgião.';
  return message;
}
