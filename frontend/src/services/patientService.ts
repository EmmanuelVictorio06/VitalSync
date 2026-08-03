/** Pacientes (RLS aplica o escopo por equipe). */
import { isWithinMonitoringWindow } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import { patientSecurityService, type SecurePatientUpdate } from './patientSecurityService';
import type { ClinicalStatus, Patient } from './types';

/** Paciente com uma coleta programada de hoje (manhã/noite) ainda sem registro, já com a janela fechada. */
export interface MissingMeasurementPatient {
  id: string;
  name: string;
  phone: string | null;
  team_id: string;
  period: 'MORNING' | 'NIGHT';
}

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
  /** Resumo de prontuário (texto livre, opcional). */
  medical_record_summary?: string;
  /** Sexo do paciente (M/F) — variável demográfica do estudo. */
  sex?: 'M' | 'F';
  weight_kg?: number;
  height_cm?: number;
  /** Lista de comorbidades (texto livre por item). */
  comorbidities?: string[];
  /** Tempo de internação hospitalar em dias. */
  length_of_stay_days?: number;
  /** Contato alternativo exigido na inclusão do paciente. */
  alternative_phone?: string;
  /** Data de assinatura do TCLE. */
  tcle_accepted_at?: string;
}

/** Filtro de procedência: reais, de teste ou ambos. */
export type PatientKind = 'all' | 'real' | 'test';

// Colunas seguras para o painel — NUNCA traz cpf_hash/cpf_encrypted.
const PATIENT_COLUMNS =
  'id, name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date, ' +
  'hospital_id, team_id, secure_token, status, current_status, is_test, medical_record_summary, ' +
  'sex, weight_kg, height_cm, comorbidities, length_of_stay_days, alternative_phone, tcle_accepted_at, ' +
  'created_at, deleted_at, surgery_type:surgery_types(name), hospital:hospitals(name), ' +
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

  /**
   * Atualiza dados de um paciente (ADMIN ou cirurgião responsável da equipe
   * atual). O CPF é opcional — vazio preserva o atual; preenchido é re-hasheado
   * na Edge Function `update-patient` (service_role + segredos), nunca no
   * frontend. A troca de equipe é permitida só ao ADMIN (revalidada no servidor).
   */
  async update(input: SecurePatientUpdate): Promise<Patient> {
    return patientSecurityService.updateWithCpf(input);
  },

  /** Exclusão lógica: marca deleted_at/deleted_by e silencia alertas pendentes. */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.rpc('soft_delete_patient', { p_id: id });
    if (error) throw new Error(error.message);
  },

  /**
   * Detecta ausência de resposta (protocolo 5.6.3/5.6.4): pacientes ativos, na
   * janela de 10 dias, sem a coleta do período de hoje já com a janela
   * fechada (manhã 08–10h, noite 18–20h). Visibilidade para contato ativo —
   * não dispara nada sozinho (RLS já limita ao escopo do usuário).
   */
  async getMissingTodayMeasurements(): Promise<MissingMeasurementPatient[]> {
    const hourSP = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(
        new Date(),
      ),
    );
    const periodsToCheck: Array<'MORNING' | 'NIGHT'> = [];
    if (hourSP >= 10) periodsToCheck.push('MORNING');
    if (hourSP >= 20) periodsToCheck.push('NIGHT');
    if (periodsToCheck.length === 0) return [];

    const { data: patients, error } = await supabase
      .from('patients')
      .select('id, name, phone, team_id, hospital_discharge_date')
      .eq('status', 'ACTIVE')
      .is('deleted_at', null);
    if (error) throw new Error(error.message);

    const active = (patients ?? []).filter(
      (p) => p.hospital_discharge_date && isWithinMonitoringWindow(new Date(p.hospital_discharge_date)),
    );
    if (active.length === 0) return [];

    const todaySP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const { data: records, error: recErr } = await supabase
      .from('vital_sign_records')
      .select('patient_id, period')
      .eq('record_date', todaySP)
      .in('patient_id', active.map((p) => p.id));
    if (recErr) throw new Error(recErr.message);
    const done = new Set((records ?? []).map((r) => `${r.patient_id}:${r.period}`));

    const missing: MissingMeasurementPatient[] = [];
    for (const p of active) {
      for (const period of periodsToCheck) {
        if (!done.has(`${p.id}:${period}`)) {
          missing.push({ id: p.id, name: p.name, phone: p.phone, team_id: p.team_id, period });
        }
      }
    }
    return missing;
  },
};
