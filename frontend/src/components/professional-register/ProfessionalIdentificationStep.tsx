/**
 * Etapa 1 — Identificação: nome completo e CPF.
 *
 * Componente puramente presentacional: recebe o estado do formulário, os erros
 * da etapa e um setter. A validação e o avanço ficam no Wizard.
 */
import { TextInput } from '../ui';
import { PatientCpfField } from '../PatientCpfField';
import type { FieldErrors, WizardFormState } from './types';

export interface StepProps {
  form: WizardFormState;
  errors: FieldErrors;
  setField: <K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => void;
}

export function ProfessionalIdentificationStep({ form, errors, setField }: StepProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="Nome completo"
        required
        value={form.name}
        placeholder="Digite seu nome completo"
        autoComplete="name"
        error={errors.name}
        onChange={(e) => setField('name', e.target.value)}
      />
      <PatientCpfField
        value={form.cpf}
        onChange={(v) => setField('cpf', v)}
        required
        externalError={errors.cpf ?? null}
      />
    </div>
  );
}
