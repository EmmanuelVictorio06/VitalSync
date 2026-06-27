/**
 * Operações de paciente que envolvem dado sensível (CPF) e precisam rodar em
 * ambiente seguro. O hash/cripto do CPF e a inserção acontecem na Edge Function
 * `create-patient` (service_role + segredos). Este service só orquestra a
 * chamada e traduz erros para mensagens claras.
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
};

/** Extrai a mensagem de erro retornada pela Edge Function (campo `error`). */
async function extractFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON: cai no fallback abaixo.
    }
  }
  return error instanceof Error ? error.message : 'Erro ao cadastrar paciente.';
}
