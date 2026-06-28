/**
 * Campo de CPF com máscara 000.000.000-00 e teclado numérico no celular.
 * Usa o wrapper `Field` (label/erro padrão) e a classe `input` do projeto, para
 * ficar visualmente consistente com os demais campos do wizard.
 */
import { Field, cn } from '../ui';
import { formatCpf } from '../../lib/cpfUtils';

export function CpfInput({
  value,
  onChange,
  required,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
}) {
  return (
    <Field label="CPF" error={error} required={required}>
      <input
        className={cn('input', error && 'invalid')}
        value={value}
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        onChange={(e) => onChange(formatCpf(e.target.value))}
      />
    </Field>
  );
}
