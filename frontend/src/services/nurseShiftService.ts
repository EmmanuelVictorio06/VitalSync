/**
 * Plantão do Profissional de Enfermagem (migration 0065).
 *
 * "Livre" é CALCULADO no banco (`nurse_is_free`): em plantão, não pausado e
 * abaixo do limite de WIP. Não existe toggle manual de disponibilidade — um
 * toggle mente quando a pessoa esquece ligado e some da distribuição.
 */
import { supabase } from '../lib/supabase';
import type { NurseShift } from './types';

export const nurseShiftService = {
  /** Turno aberto do usuário logado, ou null se estiver fora de plantão. */
  async getMyShift(): Promise<NurseShift | null> {
    const { data, error } = await supabase.rpc('nurse_my_shift');
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as NurseShift | undefined;
    return row ?? null;
  },

  async openShift(): Promise<void> {
    const { error } = await supabase.rpc('nurse_open_shift');
    if (error) throw new Error(error.message);
  },

  /** Pausa curta (almoço/banheiro) — não encerra o turno. */
  async pauseShift(): Promise<void> {
    const { error } = await supabase.rpc('nurse_pause_shift');
    if (error) throw new Error(error.message);
  },

  async resumeShift(): Promise<void> {
    const { error } = await supabase.rpc('nurse_resume_shift');
    if (error) throw new Error(error.message);
  },

  async closeShift(): Promise<void> {
    const { error } = await supabase.rpc('nurse_close_shift');
    if (error) throw new Error(error.message);
  },
};
