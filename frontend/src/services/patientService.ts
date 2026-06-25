/** Pacientes (RLS aplica o escopo por equipe). */
import { supabase } from '../lib/supabase';
import type { ClinicalStatus, Patient } from './types';

export interface PatientWithNames extends Patient {
  surgery_type: { name: string } | null;
  hospital: { name: string } | null;
  medical_team: { team_number: number } | null;
}

export interface NewPatientInput {
  name: string;
  birth_date?: string;
  phone?: string;
  surgery_type_id: string;
  surgery_date?: string;
  hospital_discharge_date?: string;
  hospital_id: string;
  team_id: string;
}

export const patientService = {
  /** Lista pacientes visíveis ao usuário; filtros opcionais. */
  async list(opts: { status?: ClinicalStatus; teamId?: string; search?: string } = {}): Promise<PatientWithNames[]> {
    let q = supabase
      .from('patients')
      .select('*, surgery_type:surgery_types(name), hospital:hospitals(name), medical_team:medical_teams(team_number)')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });
    if (opts.status) q = q.eq('current_status', opts.status);
    if (opts.teamId) q = q.eq('team_id', opts.teamId);
    if (opts.search) q = q.ilike('name', `%${opts.search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as unknown as PatientWithNames[]) ?? [];
  },

  async getById(id: string): Promise<PatientWithNames | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*, surgery_type:surgery_types(name), hospital:hospitals(name), medical_team:medical_teams(team_number)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as PatientWithNames) ?? null;
  },

  /** Cadastra paciente (ADMIN ou cirurgião responsável). Retorna o secure_token. */
  async create(input: NewPatientInput): Promise<Patient> {
    const { data, error } = await supabase.from('patients').insert(input).select().single();
    if (error) throw new Error(error.message);
    return data as Patient;
  },

  async remove(id: string): Promise<void> {
    // Soft delete: marca paciente como INATIVO.
    const { error } = await supabase.from('patients').update({ status: 'INACTIVE' }).eq('id', id);
    if (error) throw new Error(error.message);

    // Marca alertas pendentes/em análise como IGNORED para que sumam das listas ativas.
    // Ignora falhas silenciosamente — o filtro nas queries de alertas já garante
    // que alertas de pacientes INACTIVE não apareçam mesmo se esta operação falhar.
    try {
      await supabase
        .from('clinical_alerts')
        .update({ attendance_status: 'IGNORED', ignored_reason: 'Paciente excluído do monitoramento' })
        .eq('patient_id', id)
        .in('attendance_status', ['PENDING', 'IN_ANALYSIS']);
    } catch {
      // RLS pode bloquear — os filtros nas queries já tratam o restante.
    }
  },
};
