/** Autenticação via Supabase Auth (login de médicos/admin). */
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const authService = {
  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Sessão não criada.');
    return data.session;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  },

  /** Logout (alias semântico usado pela tela de perfil). */
  logout(): Promise<void> {
    return this.signOut();
  },

  /** Encerra a sessão em TODOS os dispositivos (revoga os refresh tokens). */
  async signOutEverywhere(): Promise<void> {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw new Error(error.message);
  },

  /** Usuário do Auth (e-mail, metadados, datas de criação/último login). */
  async getCurrentUser(): Promise<User | null> {
    const { data } = await supabase.auth.getUser();
    return data.user;
  },

  /**
   * Solicita a troca de e-mail no Supabase Auth. Conforme a configuração do
   * projeto, pode ser imediata ou exigir confirmação por e-mail. Retorna
   * `pending` = true quando ainda falta a confirmação. O profile é sincronizado
   * pelo gatilho `on_auth_email_changed` quando o e-mail efetivamente muda.
   */
  async updateEmail(newEmail: string): Promise<{ pending: boolean }> {
    const email = newEmail.trim().toLowerCase();
    const { data, error } = await supabase.auth.updateUser({ email });
    if (error) throw new Error(error.message);
    return { pending: data.user?.email?.toLowerCase() !== email };
  },

  /**
   * Altera a senha. Reautentica com a senha atual antes (o Supabase não exige,
   * mas validamos para evitar troca indevida em sessão aberta). Senha fica só
   * no Auth — nunca no banco.
   */
  async updatePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) throw new Error('Sessão expirada. Faça login novamente.');

    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (reauthError) throw new Error('Senha atual incorreta.');

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  },

  /** Envia e-mail de redefinição de senha (link mágico do Supabase). */
  async sendPasswordResetEmail(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) throw new Error(error.message);
  },

  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  /** Observa login/logout; retorna a subscription para `unsubscribe()`. */
  onAuthChange(cb: (session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};
