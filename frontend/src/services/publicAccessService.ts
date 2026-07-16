/**
 * Acesso público do paciente (anônimo, por link). Antes de exibir qualquer
 * dado, o paciente confirma a identidade com o CPF — a validação acontece na
 * Edge Function `validate-patient-access` (compara com o cpf_hash usando o
 * pepper, que nunca chega ao frontend).
 */
import { Period } from '@vitalsync/shared';
import { supabase } from '../lib/supabase';
import { validateCpf } from '../lib/cpfUtils';
import type { PatientLinkInfo } from './vitalSignsService';

/** Mensagem genérica do servidor (não revela se o CPF/paciente existe). */
const GENERIC = 'CPF não confere com este link. Verifique os dados e tente novamente.';

/** Resultado da validação do link: dados do paciente + estado do dia. */
export interface PatientAccessValidation {
  patient: PatientLinkInfo;
  /** Períodos já registrados HOJE (fuso America/Sao_Paulo) para este paciente. */
  periodsFilledToday: Period[];
  /** Toggle de admin: quando ligado, o paciente pode reenviar/corrigir o mesmo período. */
  allowResendSamePeriod: boolean;
}

export const publicAccessService = {
  /**
   * Confirma a identidade do paciente pelo CPF e devolve os dados do link,
   * junto com os períodos de hoje já registrados (para a UI bloquear reenvio).
   * Lança com mensagem amigável em caso de erro (genérica por segurança).
   */
  async validate(token: string, cpf: string): Promise<PatientAccessValidation> {
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
    const body = data as {
      patient?: PatientLinkInfo;
      periodsFilledToday?: string[];
      allowResendSamePeriod?: boolean;
    } | null;
    if (!body?.patient) throw new Error(GENERIC);
    return {
      patient: body.patient,
      // Defaults defensivos: se a função ainda não devolver os campos novos,
      // a tela se comporta como antes (nada bloqueado).
      periodsFilledToday: (body.periodsFilledToday ?? []).filter(
        (p): p is Period => p === Period.MORNING || p === Period.NIGHT,
      ),
      allowResendSamePeriod: body.allowResendSamePeriod === true,
    };
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
