/** Perfil do usuário (role, nome) — usado para menus e RBAC no frontend. */
import { supabase } from '../lib/supabase';
import { extractEdgeError } from '../lib/edgeError';
import { storageService } from './storageService';
import { teamViewService, type TeamSummary } from './teamViewService';
import type { NotificationPrefs, Profile, RoleInTeam, UserRole } from './types';

/** Helper interno: id do usuário logado (ou erro de sessão). */
async function requireUid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('Sessão expirada. Faça login novamente.');
  return uid;
}

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
   * ADMIN — via Edge Function `admin-create-user` (auth.admin.createUser; valida
   * is_admin no servidor), substituindo a RPC admin_create_doctor que inseria à
   * mão em auth.users (frágil — C-06). Retorna o id do profile criado.
   */
  async createDoctorProfile(input: {
    name: string;
    email: string;
    password: string;
    whatsapp: string;
    role: RoleInTeam;
  }): Promise<string> {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        whatsapp: input.whatsapp ?? '',
        role: input.role,
      },
    });
    if (error) throw new Error(await extractEdgeError(error, 'Não foi possível cadastrar o médico.'));
    const id = (data as { id?: string })?.id;
    if (!id) throw new Error('Não foi possível cadastrar o médico.');
    return id;
  },

  /* ======================= "Meu Perfil" (próprio usuário) ======================= */

  /**
   * Atualiza os dados pessoais do PRÓPRIO usuário. Nunca toca em role/status
   * (protegidos por trigger no banco). Senha e e-mail NÃO passam por aqui —
   * vão pelo Supabase Auth (authService).
   */
  async updateMyProfile(input: {
    name?: string;
    whatsapp?: string | null;
    specialty?: string | null;
    crm?: string | null;
    notes?: string | null;
  }): Promise<Profile> {
    const uid = await requireUid();
    const { data, error } = await supabase.from('profiles').update(input).eq('id', uid).select().single();
    if (error) throw new Error(error.message);
    return data as Profile;
  },

  /** Atalho para atualizar só o WhatsApp (usado ao ligar alertas por WhatsApp). */
  updateMyWhatsapp(whatsapp: string): Promise<Profile> {
    return this.updateMyProfile({ whatsapp });
  },

  /** Sobe um novo avatar, salva o caminho e remove o anterior (se houver). */
  async updateAvatar(file: File): Promise<Profile> {
    const uid = await requireUid();
    const current = await this.getProfile(uid);
    const path = await storageService.uploadProfileAvatar(file, uid);
    const { data, error } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', uid).select().single();
    if (error) throw new Error(error.message);
    if (current?.avatar_url && current.avatar_url !== path) {
      await storageService.deleteProfileAvatar(current.avatar_url).catch(() => {});
    }
    return data as Profile;
  },

  /** Remove o avatar atual (arquivo + referência no perfil). */
  async removeAvatar(): Promise<Profile> {
    const uid = await requireUid();
    const current = await this.getProfile(uid);
    if (current?.avatar_url) await storageService.deleteProfileAvatar(current.avatar_url).catch(() => {});
    const { data, error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid).select().single();
    if (error) throw new Error(error.message);
    return data as Profile;
  },

  /** Equipes do usuário logado (RLS já restringe às que ele participa). */
  getMyTeams(): Promise<TeamSummary[]> {
    return teamViewService.listMyTeams();
  },

  /** Salva as preferências de notificação (jsonb em profiles). */
  async updateNotificationPreferences(prefs: NotificationPrefs): Promise<Profile> {
    const uid = await requireUid();
    const { data, error } = await supabase
      .from('profiles')
      .update({ notification_prefs: prefs })
      .eq('id', uid)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Profile;
  },

  /** Registra uma solicitação de desativação da própria conta (ADMIN analisa). */
  async requestAccountDeactivation(reason?: string): Promise<void> {
    const uid = await requireUid();
    const { error } = await supabase.from('account_requests').insert({ profile_id: uid, type: 'DEACTIVATION', reason: reason ?? null });
    if (error) throw new Error(error.message);
  },

  /** Quantidade de administradores ATIVOS (evita o único admin se autodesativar). */
  async countActiveAdmins(): Promise<number> {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
      .eq('status', 'ACTIVE');
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
};
