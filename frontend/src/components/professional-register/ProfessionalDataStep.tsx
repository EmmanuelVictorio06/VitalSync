/**
 * Etapa 2 — Dados profissionais: CRM e telefone (WhatsApp).
 */
import { PhoneInput, TextInput } from '../ui';
import type { StepProps } from './ProfessionalIdentificationStep';

export function ProfessionalDataStep({ form, errors, setField }: StepProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="CRM"
        required
        value={form.crm}
        placeholder="Ex: CRM/PR 12345"
        autoComplete="organization-title"
        error={errors.crm}
        onChange={(e) => setField('crm', e.target.value)}
      />
      <PhoneInput
        label="Telefone (WhatsApp)"
        required
        value={form.phone}
        onChange={(v) => setField('phone', v)}
        error={errors.phone}
        hint="Informe o número que será usado para receber comunicações do VitalSync."
      />
    </div>
  );
}
