/**
 * Etapa 3 — Acesso ao sistema: e-mail, senha e confirmar senha.
 * A senha usa PasswordInput (botão mostrar/ocultar); confirmação valida igualdade.
 */
import { TextInput } from '../ui';
import { PasswordInput } from '../profile';
import type { StepProps } from './ProfessionalIdentificationStep';

export function ProfessionalAccessStep({ form, errors, setField }: StepProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="E-mail"
        type="email"
        required
        value={form.email}
        placeholder="seuemail@exemplo.com"
        inputMode="email"
        autoComplete="email"
        error={errors.email}
        onChange={(e) => setField('email', e.target.value)}
      />
      <PasswordInput
        label="Senha"
        required
        value={form.password}
        onChange={(v) => setField('password', v)}
        error={errors.password}
        hint="Mínimo de 8 caracteres."
        autoComplete="new-password"
        placeholder="Digite sua senha"
      />
      <PasswordInput
        label="Confirmar senha"
        required
        value={form.confirm}
        onChange={(v) => setField('confirm', v)}
        error={errors.confirm}
        autoComplete="new-password"
        placeholder="Confirme sua senha"
      />
    </div>
  );
}
