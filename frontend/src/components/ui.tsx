import { type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';
import { ClinicalStatus, formatPhoneBR } from '@vitalsync/shared';

/** Junta classes condicionalmente (equivalente leve do `cn` da referência). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------------- Status badge (semáforo) ---------------- */
const STATUS_META: Record<ClinicalStatus, { cls: string; dot: string; label: string }> = {
  GREEN: { cls: 'bg-stable/10 text-stable border border-stable/20', dot: 'bg-stable', label: 'Estável' },
  YELLOW: { cls: 'bg-warning/10 text-warning border border-warning/20', dot: 'bg-warning', label: 'Atenção' },
  RED: { cls: 'bg-alert/10 text-alert border border-alert/20', dot: 'bg-alert', label: 'Alerta' },
};

export function StatusBadge({ status, showDot = true }: { status: ClinicalStatus; showDot?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.GREEN;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        meta.cls,
      )}
    >
      {showDot && (
        <span className={cn('size-1.5 rounded-full', meta.dot, status === ClinicalStatus.RED && 'pulse-alert')} aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

/** Classe de borda lateral do card conforme o status clínico. */
export function statusBorder(status: ClinicalStatus): string {
  return status === ClinicalStatus.RED
    ? 'border-l-alert'
    : status === ClinicalStatus.YELLOW
      ? 'border-l-warning'
      : 'border-l-stable';
}

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'whatsapp';
const VARIANT_CLS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20',
  secondary: 'border border-primary/30 bg-card text-primary hover:bg-accent',
  ghost: 'border border-border bg-transparent text-foreground hover:bg-muted',
  danger: 'bg-alert text-alert-foreground hover:bg-alert/90',
  success: 'bg-stable text-stable-foreground hover:bg-stable/90 shadow-lg shadow-stable/20',
  whatsapp: 'bg-[#25D366] text-white hover:opacity-90',
};
const SIZE_CLS = {
  sm: 'px-3 py-1.5 text-xs rounded-md',
  md: 'px-4 py-2.5 text-sm rounded-lg',
  lg: 'px-6 py-3.5 text-base rounded-xl',
} as const;

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', block, loading, children, disabled, className, ...rest }: BtnProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-55 disabled:cursor-not-allowed disabled:shadow-none',
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
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
    <div className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label} {required && <span className="text-alert">*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
      {error && <span className="block text-xs font-semibold text-alert mt-1">{error}</span>}
    </div>
  );
}

/* ---------------- Text input ---------------- */
interface TextProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}
export function TextInput({ label, hint, error, required, className, ...rest }: TextProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <input className={cn('input', error && 'invalid', className)} {...rest} />
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
        className={cn('input', error && 'invalid')}
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
      <select className={cn('input', error && 'invalid')} {...rest}>
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
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
        {requireText && (
          <div className="mt-4">
            <Field label={`Digite "${requireText}" para confirmar`}>
              <input className="input" value={confirmInput ?? ''} onChange={(e) => onConfirmInputChange?.(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mt-6">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
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
  const ACTIVE: Record<'g' | 'y' | 'r', string> = {
    g: 'bg-stable text-stable-foreground',
    y: 'bg-warning text-warning-foreground',
    r: 'bg-alert text-alert-foreground',
  };
  return (
    <div>
      <div className="grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              className={cn(
                'aspect-square rounded-md text-xs font-bold transition-all',
                active
                  ? cn(ACTIVE[colorFor(n)], 'scale-110 shadow-md')
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
              aria-pressed={active}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-semibold text-muted-foreground uppercase">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

/* ---------------- Yes / No toggle ---------------- */
export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {([true, false] as const).map((opt) => {
        const active = value === opt;
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'py-4 rounded-xl font-bold text-sm border-2 transition-all',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-primary/30',
            )}
          >
            {opt ? 'Sim' : 'Não'}
          </button>
        );
      })}
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return <div className="text-center text-muted-foreground py-6 animate-pulse">{label}</div>;
}
