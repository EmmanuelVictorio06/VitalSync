/** Hospitais (leitura para todos; escrita só ADMIN via RLS). */
import { supabase } from '../lib/supabase';
import type { EntityStatus, Hospital } from './types';

export const hospitalService = {
  async list(): Promise<Hospital[]> {
    const { data, error } = await supabase.from('hospitals').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data as Hospital[]) ?? [];
  },

  async create(input: { name: string; city?: string; state?: string }): Promise<Hospital> {
    const { data, error } = await supabase.from('hospitals').insert(input).select().single();
    if (error) throw new Error(error.message);
    return data as Hospital;
  },

  async update(id: string, input: Partial<{ name: string; city: string; state: string; status: EntityStatus }>): Promise<void> {
    const { error } = await supabase.from('hospitals').update(input).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('hospitals').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
