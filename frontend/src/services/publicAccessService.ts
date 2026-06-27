/**
 * Acesso público do paciente (anônimo, por link). Antes de exibir qualquer
 * dado, o paciente confirma a identidade com o CPF — a validação acontece na
 * Edge Function `validate-patient-access` (compara com o cpf_hash usando o
 * pepper, que nunca chega ao frontend).
 */
import { supabase } from '../lib/supabase';
import { validateCpf } from '../lib/cpfUtils';
import type { PatientLinkInfo } from './vitalSignsService';

/** Mensagem genérica do servidor (não revela se o CPF/paciente existe). */
const GENERIC = 'CPF não confere com este link. Verifique os dados e tente novamente.';

export const publicAccessService = {
  /**
   * Confirma a identidade do paciente pelo CPF e devolve os dados do link.
   * Lança com mensagem amigável em caso de erro (genérica por segurança).
   */
  async validate(token: string, cpf: string): Promise<PatientLinkInfo> {
    if (!validateCpf(cpf)) {
      // Evita ida ao servidor com CPF claramente inválido (e conta tentativa à toa).
      throw new Error(GENERIC);
    }

    const { data, error } = await supabase.functions.invoke('validate-patient-access', {
      body: { token, cpf },
    });

    if (error) {
      throw new Error(await extractError(error));
    }
    const patient = (data as { patient?: PatientLinkInfo })?.patient;
    if (!patient) throw new Error(GENERIC);
    return patient;
  },
};

/** Extrai a mensagem (genérica) retornada pela Edge Function. */
async function extractError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON
    }
  }
  return GENERIC;
}
