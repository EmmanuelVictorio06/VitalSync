/**
 * Convites de profissionais (médico/cirurgião) por link.
 *
 * - Geração: ADMIN/SUPORTE via RPC create_professional_invite (RLS revalida).
 * - Consulta pública (tela de cadastro): RPC get_invite_by_token (só convite válido).
 * - Aceite: Edge Function accept-invite (cria a conta no Auth com a senha do
 *   profissional; service_role nunca chega ao frontend).
 */
import { supabase } from '../lib/supabase';
import { professionalInviteLink } from '../lib/publicUrl';
import type { UserRole } from './types';

/** Papéis que podem ser convidados (não inclui ADMIN/SUPPORT). */
export type InviteRole = 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR';

export interface InviteInfo {
  role: InviteRole;
  team_number: number | null;
  invited_email: string | null;
  invited_phone: string | null;
}

export interface AcceptInviteInput {
  token: string;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  crm: string;
  password: string;
}

export const professionalInviteService = {
  /** Gera um convite e devolve o token + link público de cadastro. */
  async generate(input: {
    role: InviteRole;
    teamId?: string | null;
    phone?: string;
    email?: string;
  }): Promise<{ token: string; link: string }> {
    const { data, error } = await supabase.rpc('create_professional_invite', {
      p_role: input.role,
      p_team_id: input.teamId ?? null,
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
    });
    if (error) throw new Error(error.message);
    const token = data as string;
    return { token, link: professionalInviteLink(token) };
  },

  /** Dados mínimos do convite para a tela pública (null se inválido/expirado). */
  async getByToken(token: string): Promise<InviteInfo | null> {
    const { data, error } = await supabase.rpc('get_invite_by_token', { p_token: token });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as InviteInfo | undefined;
    return row ?? null;
  },

  /** Conclui o cadastro do profissional pelo convite. */
  async accept(input: AcceptInviteInput): Promise<void> {
    const { data, error } = await supabase.functions.invoke('accept-invite', { body: input });
    if (error) throw new Error(await extractError(error));
    if (!(data as { ok?: boolean })?.ok) throw new Error('Não foi possível concluir o cadastro.');
  },
};

async function extractError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON
    }
  }
  return error instanceof Error ? error.message : 'Erro ao concluir o cadastro.';
}
