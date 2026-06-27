/**
 * ProfessionalRegisterWizard — orquestra o cadastro de profissional em 3 etapas.
 *
 * Responsabilidades:
 *  - manter o estado único do formulário (com pré-preenchimento do convite);
 *  - validar cada etapa antes de avançar (prevenção de erro);
 *  - chamar `professionalInviteService.accept` na etapa 3;
 *  - mapear erros do servidor (CPF/e-mail duplicado) de volta à etapa/campo;
 *  - renderizar o indicador de progresso, a etapa atual e os botões;
 *  - transição suave entre etapas (animate-entry com key).
 *
 * Separação: validações em `validation.ts`, tipos em `types.ts`, etapas em
 * arquivos próprios, sucesso em `ProfessionalRegisterSuccess`.
 */
import { useState } from 'react';
import { ArrowLeft, Loader2, Stethoscope } from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { professionalInviteService, type InviteInfo } from '../../services/professionalInviteService';
import {
  ProfessionalRegisterStepIndicator,
} from './ProfessionalRegisterStepIndicator';
import { ProfessionalIdentificationStep } from './ProfessionalIdentificationStep';
import { ProfessionalDataStep } from './ProfessionalDataStep';
import { ProfessionalAccessStep } from './ProfessionalAccessStep';
import { ProfessionalRegisterSuccess, GRADIENT_BG } from './ProfessionalRegisterSuccess';
import {
  formFromInvite,
  type FieldErrors,
  type Step,
  type WizardFormState,
} from './types';
import { mapSubmitError, validateAccess, validateData, validateIdentification } from './validation';

const ROLE_LABEL: Record<InviteInfo['role'], string> = {
  MAIN_SURGEON: 'Cirurgião Principal',
  ASSOCIATED_DOCTOR: 'Médico Associado',
};

export interface ProfessionalRegisterWizardProps {
  token: string;
  invite: InviteInfo;
  onDone: () => void;
}

export function ProfessionalRegisterWizard({ token, invite, onDone }: ProfessionalRegisterWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<WizardFormState>(() => formFromInvite(invite));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setField<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
    setSubmitError(null);
  }

  function validateCurrent(): FieldErrors {
    if (step === 1) return validateIdentification(form);
    if (step === 2) return validateData(form);
    return validateAccess(form);
  }

  function goNext() {
    const e = validateCurrent();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitError(null);
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  function goBack() {
    setSubmitError(null);
    setErrors({});
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  async function submit() {
    const e = validateAccess(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await professionalInviteService.accept({
        token,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: onlyDigits(form.phone),
        cpf: form.cpf,
        crm: form.crm.trim(),
        password: form.password,
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível concluir o cadastro. Tente novamente.';
      const { step: targetStep, errors: mapped } = mapSubmitError(msg);
      setStep(targetStep);
      setErrors(mapped);
      setSubmitError(Object.keys(mapped).length === 0 ? msg : null);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <ProfessionalRegisterSuccess />;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (step < 3) goNext();
    else void submit();
  }

  const primaryLabel = step < 3 ? 'Continuar' : 'Concluir cadastro';
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6" style={GRADIENT_BG}>
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-6 sm:p-8 w-full max-w-[480px]">
        {/* Cabeçalho */}
        <div className="text-center">
          <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
            <Stethoscope className="size-8" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Cadastro de profissional</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Convite para{' '}
            <strong className="text-primary font-bold">{ROLE_LABEL[invite.role]}</strong>
            {invite.team_number != null && ` · Equipe nº ${String(invite.team_number).padStart(2, '0')}`}
          </p>
        </div>

        {/* Indicador de progresso */}
        <div className="mt-6">
          <ProfessionalRegisterStepIndicator current={step} />
        </div>

        {/* Formulário da etapa atual */}
        <form className="mt-6" onSubmit={handleSubmit} noValidate>
          <div key={step} className="animate-entry">
            {step === 1 && <ProfessionalIdentificationStep form={form} errors={errors} setField={setField} />}
            {step === 2 && <ProfessionalDataStep form={form} errors={errors} setField={setField} />}
            {step === 3 && <ProfessionalAccessStep form={form} errors={errors} setField={setField} />}
          </div>

          {/* Erro geral (não atrelado a um campo) */}
          {submitError && (
            <p className="mt-4 text-sm text-alert font-semibold text-center bg-alert/5 border border-alert/20 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}

          {/* Botões */}
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-border font-semibold text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="size-4" /> Voltar
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'Enviando…' : primaryLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
