/**
 * "Gerenciar Usuários" (Admin) — identidade e acesso dos profissionais.
 *
 * Operações sensíveis (criar conta no Auth, trocar e-mail/senha, excluir) vão
 * por RPCs SECURITY DEFINER que validam `is_admin()` no banco (migration 0007),
 * mantendo a service_role FORA do frontend. Papel/status são UPDATE direto em
 * profiles (RLS de admin), com proteções por trigger (último admin / escalada).
 *
 * Esta tela cuida do USUÁRIO; o vínculo com equipes é só um resumo + link para
 * "Gerenciar Equipes" (sem duplicar o gerenciamento de equipe aqui).
 */
import { supabase } from '../lib/supabase';
import { authService } from './authService';
import type { EntityStatus, UserOverview, UserRole, UserTeamLink } from './types';

export interface UserFilters {
  name?: string;
  email?: string;
  whatsapp?: string;
  role?: UserRole | 'ALL';
  status?: EntityStatus | 'ALL';
  team?: 'ALL' | 'WITH' | 'WITHOUT';
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  whatsapp: string;
  role: UserRole;
  status?: EntityStatus;
  specialty?: string;
  crm?: string;
  notes?: string;
}

export type DeleteUserResult = { kind: 'deleted' } | { kind: 'inactivated'; reason: string };

export const userService = {
  /** Lista completa (RPC com último acesso e nº de equipes). Filtro no cliente. */
  async getUsers(filters: UserFilters = {}): Promise<UserOverview[]> {
    const { data, error } = await supabase.rpc('admin_get_users_overview');
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as UserOverview[]).map((r) => ({ ...r, team_count: Number(r.team_count) }));
    return applyFilters(rows, filters);
  },

  async getUserById(userId: string): Promise<UserOverview | null> {
    const rows = await this.getUsers();
    return rows.find((u) => u.id === userId) ?? null;
  },

  /** Cria a conta de login + profile (RPC admin_create_user). */
  async createUser(input: CreateUserInput): Promise<string> {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_name: input.name.trim(),
      p_email: input.email.trim(),
      p_password: input.password,
      p_whatsapp: input.whatsapp ?? '',
      p_role: input.role,
      p_status: input.status ?? 'ACTIVE',
      p_specialty: input.specialty ?? null,
      p_crm: input.crm ?? null,
      p_notes: input.notes ?? null,
    });
    if (error) throw new Error(translateError(error.message));
    return data as string;
  },

  /** Atualiza dados básicos (não toca e-mail/senha/role — têm fluxo próprio). */
  async updateUser(
    userId: string,
    input: Partial<{ name: string; whatsapp: string | null; specialty: string | null; crm: string | null; notes: string | null; status: EntityStatus }>,
  ): Promise<void> {
    const { error } = await supabase.from('profiles').update(input).eq('id', userId);
    if (error) throw new Error(translateError(error.message));
  },

  /** Altera o papel/perfil (ação sensível). Bloqueios reforçados por trigger. */
  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
    if (error) throw new Error(translateError(error.message));
  },

  activateUser(userId: string): Promise<void> {
    return this.updateUser(userId, { status: 'ACTIVE' });
  },

  inactivateUser(userId: string): Promise<void> {
    return this.updateUser(userId, { status: 'INACTIVE' });
  },

  /** Troca o e-mail de login (RPC; profiles sincroniza via trigger 0006). */
  async updateUserEmail(userId: string, newEmail: string): Promise<void> {
    const { error } = await supabase.rpc('admin_update_user_email', { p_user_id: userId, p_new_email: newEmail.trim() });
    if (error) throw new Error(translateError(error.message));
  },

  /** Define uma senha temporária (RPC). Senha nunca trafega/fica no banco. */
  async setTemporaryPassword(userId: string, password: string): Promise<void> {
    const { error } = await supabase.rpc('admin_set_user_password', { p_user_id: userId, p_password: password });
    if (error) throw new Error(translateError(error.message));
  },

  /** Envia e-mail de redefinição de senha para o usuário. */
  sendPasswordReset(email: string): Promise<void> {
    return authService.sendPasswordResetEmail(email);
  },

  /**
   * Exclui DEFINITIVO só sem vínculos; caso contrário INATIVA (soft delete).
   * A regra é reforçada no banco (admin_delete_user levanta 'HAS_LINKS').
   */
  async deleteUserIfAllowed(userId: string): Promise<DeleteUserResult> {
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
    if (!error) return { kind: 'deleted' };
    if (/HAS_LINKS/.test(error.message)) {
      await this.inactivateUser(userId);
      return { kind: 'inactivated', reason: 'Este usuário possui vínculos ou registros no sistema. Por segurança, ele será apenas inativado.' };
    }
    throw new Error(translateError(error.message));
  },

  /** Resumo das equipes do usuário (cirurgião principal + associado), com link. */
  async getUserTeamLinks(userId: string): Promise<UserTeamLink[]> {
    const [mainRes, memberRes] = await Promise.all([
      supabase
        .from('medical_teams')
        .select('id, team_number, status, surgeon:profiles!medical_teams_main_surgeon_id_fkey(name)')
        .eq('main_surgeon_id', userId),
      supabase
        .from('team_members')
        .select('team_id, medical_teams!inner(id, team_number, status, surgeon:profiles!medical_teams_main_surgeon_id_fkey(name))')
        .eq('doctor_id', userId)
        .eq('status', 'ACTIVE'),
    ]);
    if (mainRes.error) throw new Error(mainRes.error.message);
    if (memberRes.error) throw new Error(memberRes.error.message);

    const links: UserTeamLink[] = [];
    const teamIds = new Set<string>();

    for (const t of (mainRes.data ?? []) as unknown as Array<{ id: string; team_number: number; status: EntityStatus; surgeon: { name: string } | null }>) {
      links.push({ teamId: t.id, teamNumber: t.team_number, roleInTeam: 'MAIN_SURGEON', surgeonName: t.surgeon?.name ?? '—', patientCount: 0, teamStatus: t.status });
      teamIds.add(t.id);
    }
    for (const m of (memberRes.data ?? []) as unknown as Array<{ medical_teams: { id: string; team_number: number; status: EntityStatus; surgeon: { name: string } | null } }>) {
      const t = m.medical_teams;
      if (!t || teamIds.has(t.id)) continue;
      links.push({ teamId: t.id, teamNumber: t.team_number, roleInTeam: 'ASSOCIATED_DOCTOR', surgeonName: t.surgeon?.name ?? '—', patientCount: 0, teamStatus: t.status });
      teamIds.add(t.id);
    }

    // contagem de pacientes ativos por equipe (uma query só)
    if (teamIds.size) {
      const { data: patients } = await supabase.from('patients').select('team_id').eq('status', 'ACTIVE').in('team_id', [...teamIds]);
      const counts = new Map<string, number>();
      for (const p of (patients ?? []) as Array<{ team_id: string }>) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
      for (const l of links) l.patientCount = counts.get(l.teamId) ?? 0;
    }

    return links.sort((a, b) => a.teamNumber - b.teamNumber);
  },
};

/** Filtra a lista de usuários no cliente (a busca é leve para o volume da demo). */
function applyFilters(rows: UserOverview[], f: UserFilters): UserOverview[] {
  const name = f.name?.trim().toLowerCase();
  const email = f.email?.trim().toLowerCase();
  const whatsapp = (f.whatsapp ?? '').replace(/\D+/g, '');
  return rows.filter((u) => {
    if (name && !u.name.toLowerCase().includes(name)) return false;
    if (email && !u.email.toLowerCase().includes(email)) return false;
    if (whatsapp && !(u.whatsapp ?? '').includes(whatsapp)) return false;
    if (f.role && f.role !== 'ALL' && u.role !== f.role) return false;
    if (f.status && f.status !== 'ALL' && u.status !== f.status) return false;
    if (f.team === 'WITH' && u.team_count === 0) return false;
    if (f.team === 'WITHOUT' && u.team_count > 0) return false;
    return true;
  });
}

/** Traduz mensagens cruas para o usuário final. */
function translateError(message: string): string {
  if (/duplicate|already|em uso|unique/i.test(message) && /email/i.test(message)) return 'Este e-mail já está em uso.';
  if (/único administrador/i.test(message)) return 'Não é possível inativar ou rebaixar o único administrador ativo.';
  return message;
}
