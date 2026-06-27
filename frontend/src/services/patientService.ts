/** Pacientes (RLS aplica o escopo por equipe). */
import { supabase } from '../lib/supabase';
import { patientSecurityService } from './patientSecurityService';
import type { ClinicalStatus, Patient } from './types';

export interface PatientWithNames extends Patient {
  surgery_type: { name: string } | null;
  hospital: { name: string } | null;
  medical_team: { team_number: number } | null;
}

export interface NewPatientInput {
  name: string;
  /** CPF (com ou sem máscara) — protegido no servidor (hash + cifra). */
  cpf: string;
  birth_date?: string;
  phone?: string;
  surgery_type_id: string;
  surgery_date?: string;
  hospital_discharge_date?: string;
  hospital_id: string;
  team_id: string;
  /** Paciente fictício da homologação médica. */
  is_test?: boolean;
}

/** Filtro de procedência: reais, de teste ou ambos. */
export type PatientKind = 'all' | 'real' | 'test';

// Colunas seguras para o painel — NUNCA traz cpf_hash/cpf_encrypted.
const PATIENT_COLUMNS =
  'id, name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date, ' +
  'hospital_id, team_id, secure_token, status, current_status, is_test, created_at, ' +
  'deleted_at, surgery_type:surgery_types(name), hospital:hospitals(name), ' +
  'medical_team:medical_teams(team_number)';

export const patientService = {
  /**
   * Lista pacientes visíveis ao usuário (exclui excluídos por padrão).
   * `includeDeleted` traz também os arquivados — uso restrito (Admin, RLS revalida).
   */
  async list(
    opts: {
      status?: ClinicalStatus;
      teamId?: string;
      search?: string;
      kind?: PatientKind;
      includeDeleted?: boolean;
    } = {},
  ): Promise<PatientWithNames[]> {
    let q = supabase.from('patients').select(PATIENT_COLUMNS).order('created_at', { ascending: false });
    if (!opts.includeDeleted) q = q.is('deleted_at', null);
    if (opts.status) q = q.eq('current_status', opts.status);
    if (opts.teamId) q = q.eq('team_id', opts.teamId);
    if (opts.kind === 'test') q = q.eq('is_test', true);
    if (opts.kind === 'real') q = q.eq('is_test', false);
    if (opts.search) q = q.ilike('name', `%${opts.search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as unknown as PatientWithNames[]) ?? [];
  },

  async getById(id: string): Promise<PatientWithNames | null> {
    const { data, error } = await supabase
      .from('patients')
      .select(PATIENT_COLUMNS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as PatientWithNames) ?? null;
  },

  /**
   * Cadastra paciente (ADMIN ou cirurgião responsável). O CPF é protegido na
   * Edge Function `create-patient` (hash + cifra). Retorna o paciente com o
   * secure_token para gerar o link público.
   */
  async create(input: NewPatientInput): Promise<Patient> {
    return patientSecurityService.createWithCpf(input);
  },

  /** Exclusão lógica: marca deleted_at/deleted_by e silencia alertas pendentes. */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.rpc('soft_delete_patient', { p_id: id });
    if (error) throw new Error(error.message);
  },
};
