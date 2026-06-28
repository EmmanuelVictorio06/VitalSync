// ============================================================================
// Gate de identidade do paciente (CPF) + rate-limit por link.
//
// Fonte ÚNICA da regra, compartilhada pelas Edge Functions do fluxo público:
//   • validate-patient-access  (leitura dos dados do link)
//   • submit-vital-record      (envio da medição)
//
// Regras de segurança:
//   • Erro SEMPRE genérico — nunca revela se o CPF/paciente existe.
//   • CPF puro nunca é gravado nem logado.
//   • Tentativas limitadas por link (tabela public_access_attempts).
//   • Pacientes legados (sem cpf_hash) continuam acessíveis — preserva links já
//     enviados antes desta feature.
// ============================================================================
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashCpf, validateCpf } from './cpf.ts';

// Mensagem única para qualquer falha de identidade (não revela existência).
export const GENERIC_FAIL = 'CPF não confere com este link. Verifique os dados e tente novamente.';
export const LOCK_MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

const MAX_ATTEMPTS = 5; // tentativas antes do bloqueio
const WINDOW_MIN = 15; // janela de contagem (minutos)
const LOCK_MIN = 15; // duração do bloqueio (minutos)

export type GateResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Confirma a identidade do paciente do link (token) pelo CPF, aplicando
 * rate-limit por token. Em sucesso, zera o contador. Erro sempre genérico.
 */
export async function verifyPatientCpf(
  admin: SupabaseClient,
  token: string,
  cpf: string,
  pepper: string,
): Promise<GateResult> {
  const now = Date.now();

  // 1. Rate-limit por link.
  const { data: rl } = await admin
    .from('public_access_attempts')
    .select('attempts, first_attempt_at, locked_until')
    .eq('token', token)
    .maybeSingle();
  if (rl?.locked_until && new Date(rl.locked_until).getTime() > now) {
    return { ok: false, status: 429, error: LOCK_MESSAGE };
  }

  // 2. Localiza o paciente ativo do link (sem revelar nada ainda).
  const { data: patient } = await admin
    .from('patients')
    .select('cpf_hash, status, deleted_at')
    .eq('secure_token', token)
    .maybeSingle();
  const active = patient && patient.status === 'ACTIVE' && !patient.deleted_at;

  // 3. Decide se a identidade confere.
  let ok = false;
  if (active) {
    if (!patient!.cpf_hash) {
      ok = true; // paciente legado: sem hash para comparar → libera.
    } else if (validateCpf(cpf ?? '')) {
      ok = (await hashCpf(cpf, pepper)) === patient!.cpf_hash;
    }
  }

  if (!ok) {
    await registerFailure(admin, token, rl ?? null, now);
    return { ok: false, status: 401, error: GENERIC_FAIL };
  }

  // 4. Sucesso: zera o contador.
  await admin.from('public_access_attempts').delete().eq('token', token);
  return { ok: true };
}

/** Incrementa o contador de falhas e aplica bloqueio ao exceder o limite. */
async function registerFailure(
  admin: SupabaseClient,
  token: string,
  current: { attempts: number; first_attempt_at: string } | null,
  now: number,
): Promise<void> {
  const windowMs = WINDOW_MIN * 60_000;
  const withinWindow = current && now - new Date(current.first_attempt_at).getTime() < windowMs;
  const attempts = (withinWindow ? current!.attempts : 0) + 1;
  const locked = attempts >= MAX_ATTEMPTS;

  await admin.from('public_access_attempts').upsert({
    token,
    attempts,
    first_attempt_at: withinWindow ? current!.first_attempt_at : new Date(now).toISOString(),
    locked_until: locked ? new Date(now + LOCK_MIN * 60_000).toISOString() : null,
    updated_at: new Date(now).toISOString(),
  });
}
