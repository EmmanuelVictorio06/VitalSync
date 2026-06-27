/**
 * Modo de homologação médica — flag/whitelist no banco (homologation_settings)
 * e RPCs administrativas (0010_homologation.sql).
 *
 * - `isActive` usa o RPC público `is_homologation_mode` (qualquer perfil) para o
 *   badge "Ambiente de teste".
 * - As demais operações exigem ADMIN (o backend revalida via is_admin()).
 */
import { supabase } from '../lib/supabase';

export interface HomologationSettings {
  homologation_mode: boolean;
  test_recipients: string[];
}

export interface HomologationStats {
  homologation_mode: boolean;
  test_patients: number;
  test_alerts: number;
  whatsapp_sent: number;
  whatsapp_failed: number;
  whatsapp_skipped: number;
  authorized_numbers: number;
  recipients: string[];
}

export const homologationService = {
  /** Flag pública (badge) — funciona para qualquer perfil via RPC. */
  async isActive(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_homologation_mode');
    if (error) return false;
    return Boolean(data);
  },

  /** Configuração completa (ADMIN): modo + whitelist. */
  async getSettings(): Promise<HomologationSettings> {
    const { data, error } = await supabase
      .from('homologation_settings')
      .select('homologation_mode, test_recipients')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      homologation_mode: data?.homologation_mode ?? false,
      test_recipients: (data?.test_recipients as string[] | null) ?? [],
    };
  },

  async setMode(on: boolean): Promise<void> {
    const { error } = await supabase.rpc('homologation_set_mode', { p_on: on });
    if (error) throw new Error(error.message);
  },

  async setRecipients(recipients: string[]): Promise<void> {
    const { error } = await supabase.rpc('homologation_set_recipients', { p_recipients: recipients });
    if (error) throw new Error(error.message);
  },

  async getStats(): Promise<HomologationStats> {
    const { data, error } = await supabase.rpc('homologation_stats');
    if (error) throw new Error(error.message);
    return data as HomologationStats;
  },

  /** Remove APENAS os dados marcados como teste (is_test). Retorna contagens. */
  async clearTestData(): Promise<{ patients_deleted: number; logs_deleted: number }> {
    const { data, error } = await supabase.rpc('admin_clear_test_data');
    if (error) throw new Error(error.message);
    return data as { patients_deleted: number; logs_deleted: number };
  },
};
