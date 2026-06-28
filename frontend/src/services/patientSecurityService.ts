/**
 * Operações de paciente que envolvem dado sensível (CPF) e precisam rodar em
 * ambiente seguro. O hash/cripto do CPF e a inserção/atualização acontecem nas
 * Edge Functions `create-patient`/`update-patient` (service_role + segredos).
 * Este service só orquestra a chamada e traduz erros para mensagens claras.
 */
import { supabase } from '../lib/supabase';
import { validateCpf } from '../lib/cpfUtils';
import type { Patient } from './types';

export interface SecurePatientInput {
  name: string;
  cpf: string;
  birth_date?: string;
  phone?: string;
  surgery_type_id: string;
  surgery_date?: string;
  hospital_discharge_date?: string;
  hospital_id: string;
  team_id: string;
  is_test?: boolean;
}

/**
 * Campos editáveis de um paciente. `cpf` é OPCIONAL: vazio/omitido preserva o
 * CPF existente (o frontend nunca tem o CPF em claro de um paciente já criado,
 * pois só guardamos hash/cifra no servidor). Se preenchido, é re-hasheado.
 */
export interface SecurePatientUpdate {
  id: string;
  name?: string;
  cpf?: string;
  birth_date?: string;
  phone?: string;
  surgery_type_id?: string;
  surgery_date?: string;
  hospital_discharge_date?: string;
  hospital_id?: string;
  team_id?: string;
}

export const patientSecurityService = {
  /**
   * Cadastra paciente com CPF protegido via Edge Function. Faz uma validação
   * prévia de CPF (UX) — a validação autoritativa é refeita no servidor.
   */
  async createWithCpf(input: SecurePatientInput): Promise<Patient> {
    if (!validateCpf(input.cpf)) {
      throw new Error('CPF inválido. Verifique os dígitos e tente novamente.');
    }

    const { data, error } = await supabase.functions.invoke('create-patient', { body: input });

    if (error) {
      // A Edge Function devolve { error } com status != 2xx; o corpo vem em
      // error.context (Response). Tenta extrair a mensagem amigável.
      const message = await extractFunctionError(error);
      throw new Error(message);
    }
    const patient = (data as { patient?: Patient })?.patient;
    if (!patient) throw new Error('Não foi possível cadastrar o paciente.');
    return patient;
  },

  /**
   * Atualiza paciente via Edge Function `update-patient`. O CPF só é enviado
   * se o admin preencheu um novo — vazio significa "manter o atual". O servidor
   * revalida, re-hash e checa unicidade; o frontend nunca manipula o hash.
   */
  async updateWithCpf(input: SecurePatientUpdate): Promise<Patient> {
    if (input.cpf && input.cpf.trim() !== '' && !validateCpf(input.cpf)) {
      throw new Error('CPF inválido. Verifique os dígitos e tente novamente.');
    }

    const { data, error } = await supabase.functions.invoke('update-patient', { body: input });

    if (error) {
      const message = await extractFunctionError(error, 'Erro ao atualizar o paciente.');
      throw new Error(message);
    }
    const patient = (data as { patient?: Patient })?.patient;
    if (!patient) throw new Error('Não foi possível atualizar o paciente.');
    return patient;
  },
};

/** Extrai a mensagem de erro retornada pela Edge Function (campo `error`). */
async function extractFunctionError(error: unknown, fallback = 'Erro ao cadastrar paciente.'): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON: cai no fallback abaixo.
    }
  }
  return error instanceof Error ? error.message : fallback;
}
