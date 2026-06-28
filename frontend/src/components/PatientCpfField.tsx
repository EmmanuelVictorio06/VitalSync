/**
 * Campo de CPF reutilizável (cadastro/edição).
 *
 * - Máscara automática `000.000.000-00` (formatCpf) enquanto o usuário digita.
 * - Validação visual no blur (validateCpf) com mensagem clara.
 * - Suporte a erro externo (ex.: "CPF já cadastrado"), que tem prioridade sobre
 *   o erro de formato.
 *
 * No modo edição, o CPF é OPCIONAL: deixe `required=false` e use um hint
 * "Deixe em branco para manter o CPF atual" — o backend preserva o hash quando
 * o campo vem vazio.
 */
import { useState } from 'react';
import { TextInput } from './ui';
import { formatCpf, validateCpf } from '../lib/cpfUtils';

export interface PatientCpfFieldProps {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
  /** Erro externo (ex.: unicidade) — sobrepõe o erro de formato. */
  externalError?: string | null;
  label?: string;
  placeholder?: string;
}

export function PatientCpfField({
  value,
  onChange,
  required = false,
  hint,
  externalError,
  label = 'CPF',
  placeholder = '000.000.000-00',
}: PatientCpfFieldProps) {
  const [touched, setTouched] = useState(false);

  // Erro de formato só aparece depois do blur e se houver valor.
  const formatError =
    touched && value.trim() !== '' && !validateCpf(value)
      ? 'CPF inválido. Verifique os dados e tente novamente.'
      : null;

  const error = externalError ?? formatError;

  return (
    <TextInput
      label={label}
      hint={hint}
      error={error ?? undefined}
      required={required}
      value={value}
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      onChange={(e) => onChange(formatCpf(e.target.value))}
      onBlur={() => setTouched(true)}
    />
  );
}
