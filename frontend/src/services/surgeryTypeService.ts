/** Tipos de cirurgia (leitura para todos; escrita só ADMIN via RLS). */
import { supabase } from '../lib/supabase';
import type { EntityStatus, SurgeryType } from './types';

export const surgeryTypeService = {
  async list(): Promise<SurgeryType[]> {
    const { data, error } = await supabase.from('surgery_types').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data as SurgeryType[]) ?? [];
  },

  async create(input: { name: string; specialty?: string; description?: string }): Promise<SurgeryType> {
    const { data, error } = await supabase.from('surgery_types').insert(input).select().single();
    if (error) throw new Error(error.message);
    return data as SurgeryType;
  },

  async update(
    id: string,
    input: Partial<{ name: string; specialty: string; description: string; status: EntityStatus }>,
  ): Promise<void> {
    const { error } = await supabase.from('surgery_types').update(input).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('surgery_types').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
