/**
 * Validações puras por etapa (UX/prevenção de erro) + mapeamento do erro do
 * servidor para a etapa/campo correspondente.
 *
 * A validação autoritativa (CPF duplicado, e-mail duplicado, formato de CRM,
 * etc.) é refeita na Edge Function `accept-invite`; aqui só evitamos enviar
 * dados obviamente inválidos e damos feedback imediato.
 */
import { onlyDigits } from '@vitalsync/shared';
import { validateCpf } from '../../lib/cpfUtils';
import type { FieldErrors, Step, WizardFormState } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Etapa 1 — Identificação: nome completo (nome + sobrenome) e CPF válido. */
export function validateIdentification(f: WizardFormState): FieldErrors {
  const e: FieldErrors = {};
  const parts = f.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length < 2) {
    e.name = 'Informe seu nome completo.';
  } else if (!first || !last || first.length < 2 || last.length < 2) {
    e.name = 'Informe nome e sobrenome válidos.';
  }
  if (!f.cpf.trim()) {
    e.cpf = 'Informe seu CPF.';
  } else if (!validateCpf(f.cpf)) {
    e.cpf = 'CPF inválido. Verifique os dados e tente novamente.';
  }
  return e;
}

/** Etapa 2 — Dados profissionais: CRM obrigatório e telefone válido com DDD. */
export function validateData(f: WizardFormState): FieldErrors {
  const e: FieldErrors = {};
  if (!f.crm.trim()) e.crm = 'CRM obrigatório.';
  const digits = onlyDigits(f.phone);
  if (!f.phone.trim()) e.phone = 'Telefone obrigatório.';
  else if (digits.length < 10) e.phone = 'Telefone inválido.';
  return e;
}

/** Etapa 3 — Acesso: e-mail válido, senha (mín. 8) e confirmação igual. */
export function validateAccess(f: WizardFormState): FieldErrors {
  const e: FieldErrors = {};
  if (!f.email.trim()) e.email = 'E-mail obrigatório.';
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'E-mail inválido.';
  if (!f.password) e.password = 'Senha obrigatória.';
  else if (f.password.length < 8) e.password = 'A senha deve ter no mínimo 8 caracteres.';
  if (f.confirm !== f.password) e.confirm = 'As senhas não conferem.';
  return e;
}

/**
 * Roteia a mensagem de erro do servidor para a etapa/campo correspondente,
 * para que o usuário veja o erro perto do campo problemático (ex.: CPF
 * duplicado → etapa 1; e-mail duplicado → etapa 3).
 */
export function mapSubmitError(msg: string): { step: Step; errors: FieldErrors } {
  const lower = msg.toLowerCase();
  if (lower.includes('cpf')) {
    return { step: 1, errors: { cpf: msg } };
  }
  if (lower.includes('e-mail') || lower.includes('email')) {
    return { step: 3, errors: { email: msg } };
  }
  if (lower.includes('senha')) {
    return { step: 3, errors: { password: msg } };
  }
  // Erro não-mapeável: fica como mensagem geral na etapa atual (3).
  return { step: 3, errors: {} };
}
