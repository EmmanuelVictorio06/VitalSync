/** Autenticação via Supabase Auth (login de médicos/admin). */
import type { Session } from '@supabase/supabase-js';
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

  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  /** Observa login/logout; retorna a subscription para `unsubscribe()`. */
  onAuthChange(cb: (session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};
