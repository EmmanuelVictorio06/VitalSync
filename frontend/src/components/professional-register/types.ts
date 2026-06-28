/**
 * Tipos e constantes compartilhadas do wizard de cadastro de profissional.
 *
 * O estado do formulário é único e vive no Wizard; cada etapa enxerga só os
 * campos que lhe cabem. `FieldErrors` carrega erros por campo (validação local
 * ao avançar OU erros vindos do servidor no submit final).
 */
import type { InviteInfo } from '../../services/professionalInviteService';

export type Step = 1 | 2 | 3;

export const STEP_LABELS: Record<Step, string> = {
  1: 'Identificação',
  2: 'Dados profissionais',
  3: 'Acesso',
};

export const STEP_COUNT = 3;

/** Fundo suave (cinza muito claro → azul muito claro), comum a todo o fluxo. */
export const GRADIENT_BG: React.CSSProperties = {
  background: 'linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%)',
};

export interface WizardFormState {
  name: string;
  cpf: string;
  crm: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
}

export type FieldErrors = Partial<Record<keyof WizardFormState, string>>;

export const EMPTY_FORM: WizardFormState = {
  name: '',
  cpf: '',
  crm: '',
  phone: '',
  email: '',
  password: '',
  confirm: '',
};

/** Pré-preenche e-mail/telefone a partir do convite (quando o admin informou). */
export function formFromInvite(invite: InviteInfo | null): WizardFormState {
  return {
    ...EMPTY_FORM,
    email: invite?.invited_email ?? '',
    phone: invite?.invited_phone ?? '',
  };
}
