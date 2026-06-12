import { type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';
import { ClinicalStatus, formatPhoneBR } from '@vitalsync/shared';

/* ---------------- Status badge (semáforo) ---------------- */
const STATUS_META: Record<ClinicalStatus, { cls: string; label: string }> = {
  GREEN: { cls: 'green', label: 'Estável' },
  YELLOW: { cls: 'yellow', label: 'Atenção' },
  RED: { cls: 'red', label: 'Alerta' },
};

export function StatusBadge({ status }: { status: ClinicalStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.GREEN;
  return (
    <span className={`badge ${meta.cls}`}>
      <span className="dot" aria-hidden />
      {meta.label}
    </span>
  );
}

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'whatsapp';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', block, loading, children, disabled, ...rest }: BtnProps) {
  const cls = ['btn'];
  if (variant !== 'primary') cls.push(`btn-${variant}`);
  if (size === 'sm') cls.push('btn-sm');
  if (size === 'lg') cls.push('btn-lg');
  if (block) cls.push('btn-block');
  return (
    <button className={cls.join(' ')} disabled={disabled || loading} {...rest}>
      {loading ? 'Aguarde…' : children}
    </button>
  );
}

/* ---------------- Field wrapper ---------------- */
export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/* ---------------- Text input ---------------- */
interface TextProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}
export function TextInput({ label, hint, error, required, ...rest }: TextProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <input className={error ? 'invalid' : ''} {...rest} />
    </Field>
  );
}

/* ---------------- Phone input (máscara reutilizável) ---------------- */
export function PhoneInput({
  label = 'WhatsApp',
  value,
  onChange,
  error,
  hint = 'Ex.: (41) 99999-9999',
  required,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <input
        inputMode="numeric"
        placeholder="(00) 00000-0000"
        className={error ? 'invalid' : ''}
        value={formatPhoneBR(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/* ---------------- Select (dropdown reutilizável) ---------------- */
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}
export function SelectField({ label, hint, error, options, placeholder = 'Selecione…', required, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <select className={error ? 'invalid' : ''} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ---------------- Confirm modal (ação destrutiva) ---------------- */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  requireText,
  onConfirm,
  onCancel,
  busy,
  confirmInput,
  onConfirmInputChange,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  requireText?: string; // se definido, exige digitar este texto para habilitar
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  confirmInput?: string;
  onConfirmInputChange?: (v: string) => void;
}) {
  const enabled = !requireText || confirmInput?.trim().toUpperCase() === requireText.toUpperCase();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="subtext">{message}</p>
        {requireText && (
          <Field label={`Digite "${requireText}" para confirmar`}>
            <input value={confirmInput ?? ''} onChange={(e) => onConfirmInputChange?.(e.target.value)} />
          </Field>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <span className="spacer" />
          <Button variant="danger" onClick={onConfirm} disabled={!enabled} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Intensity scale (dor / dispneia) ---------------- */
export function IntensityScale({
  value,
  onChange,
  colorFor,
  leftLabel,
  rightLabel,
}: {
  value: number | null;
  onChange: (v: number) => void;
  colorFor: (n: number) => 'g' | 'y' | 'r';
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div>
      <div className="scale-row">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            className={`scale-btn ${colorFor(n)} ${value === n ? 'sel' : ''}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="kv" style={{ marginTop: 6 }}>
        <span>{leftLabel}</span>
        <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{rightLabel}</span>
      </div>
    </div>
  );
}

/* ---------------- Yes / No toggle ---------------- */
export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-group">
      <Button type="button" variant={value === true ? 'danger' : 'ghost'} onClick={() => onChange(true)}>
        Sim
      </Button>
      <Button type="button" variant={value === false ? 'success' : 'ghost'} onClick={() => onChange(false)}>
        Não
      </Button>
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return <div className="loading">{label}</div>;
}
