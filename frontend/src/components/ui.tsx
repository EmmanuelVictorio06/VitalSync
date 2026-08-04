import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { ClinicalStatus, formatPhoneBR, onlyDigits } from '@vitalsync/shared';

/** Junta classes condicionalmente (equivalente leve do `cn` da referência). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------------- Container e cabeçalho de página ---------------- */
/**
 * Wrapper padrão das telas internas: padding e centralização consistentes.
 * `size` define a largura máxima — `default` (até 6xl) para telas comuns e
 * `wide` (até 7xl) para telas densas (dashboards, listas grandes).
 */
export function PageContainer({
  size = 'default',
  className,
  children,
}: {
  size?: 'default' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('p-4 md:p-8 mx-auto w-full space-y-6', size === 'wide' ? 'max-w-7xl' : 'max-w-6xl', className)}>
      {children}
    </div>
  );
}

/** Cabeçalho padrão da página: título, subtítulo opcional e slot de ação à direita. */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 animate-entry', className)}>
      <div className="min-w-0">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
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

/* ---------------- Textarea ---------------- */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}
export function TextareaField({ label, hint, error, required, className, ...rest }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <textarea className={cn('input resize-none overflow-y-auto', error && 'invalid', className)} {...rest} />
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
        onChange={(e) => onChange(onlyDigits(e.target.value))}
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

/* ---------------- Custom Select (listbox estilizado, não nativo) ----------------
   Diferente do SelectField (acima, <select> nativo), este renderiza um botão +
   listbox próprio, reutilizando o mesmo padrão visual do ProfessionalCombobox.
   Motivo: no mobile, o menu aberto do <select> nativo é controlado pelo SO
   (iOS/Android) e não pode ser estilizado — fica cinza escuro/fora do design.
   Aqui o menu segue o design system (fundo branco, borda suave, hover azul,
   cantos arredondados). Acessível por teclado e confortável ao toque.

   A API é compatível com a do SelectField: `onChange` recebe um evento com
   `target.value`, então a chamada `(e) => setX(e.target.value)` não muda. */
export interface CustomSelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  label,
  hint,
  error,
  options,
  placeholder = 'Selecione…',
  required,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  error?: string;
  options: CustomSelectOption[];
  placeholder?: string;
  required?: boolean;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      // O listbox é portado para o body, então wrapRef não o contém. Comparamos
      // o alvo tanto com o wrapper (botão) quanto com o próprio listbox (via
      // data-attribute) para não fechar ao clicar dentro dele.
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest?.('[data-cs-listbox]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Posiciona o listbox (portado para o body) em relação ao botão e decide
  // abrir para cima quando não há espaço abaixo. Recalcula no scroll/resize para
  // acompanhar o botão (ex.: modal rolável). Portal evita clipping por containers
  // com overflow-auto/hidden (caso do modal "Filtros avançados") e z-index alto
  // garante que fique acima do rodapé do modal.
  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;

    const MAX_H = 240; // max-h-60 (15rem) do <ul>
    const GAP = 4; // mt-1 / mb-1

    const place = () => {
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const up = below < MAX_H && above > below;
      setDropUp(up);
      setMenuStyle({
        position: 'fixed',
        left: r.left,
        width: r.width,
        ...(up ? { bottom: window.innerHeight - r.top - GAP } : { top: r.bottom + GAP }),
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const prevOpen = useRef(open);

  // Reseta o destaque ao abrir e devolve o foco ao botão ao fechar.
  // prevOpen evita que o focus dispare no mount inicial (onde open é false),
  // o que antes fazia o último CustomSelect da página roubar o scroll.
  useEffect(() => {
    if (open) {
      setHighlight(0);
    } else if (prevOpen.current) {
      btnRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open]);

  function choose(v: string) {
    onChange({ target: { value: v } });
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const o = options[highlight];
      if (o) choose(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <div className="relative" ref={wrapRef}>
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            'input flex items-center justify-between gap-2 text-left',
            error && 'invalid',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className={cn('size-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
        </button>

        {open &&
          createPortal(
            <div
              data-cs-listbox
              className={cn(
                'z-[1000] rounded-lg border border-border bg-card shadow-lg overflow-hidden',
                dropUp ? 'animate-dropup' : 'animate-entry',
              )}
              style={menuStyle}
            >
              <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
                {options.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground text-center">Sem opções</li>
                ) : (
                  options.map((o, i) => {
                    const active = o.value === value;
                    return (
                      <li key={o.value} role="option" aria-selected={active}>
                        <button
                          type="button"
                          onClick={() => choose(o.value)}
                          onMouseEnter={() => setHighlight(i)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors',
                            i === highlight ? 'bg-primary/10' : 'hover:bg-muted/60',
                            active && 'text-primary font-semibold',
                          )}
                        >
                          <span className="text-sm truncate flex-1">{o.label}</span>
                          {active && <Check className="size-4 text-primary shrink-0" />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
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
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md my-auto max-h-[90vh] overflow-y-auto animate-entry"
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

/* ---------------- Tag única do profissional (identificador visual/busca) ----------------
   Badge discreta exibida ao lado/abaixo do nome. Não compete com o nome: tipografia
   menor, monoespaçada e tom suave. Não renderiza nada quando não há tag. */
export function ProfessionalTag({ tag, className }: { tag?: string | null; className?: string }) {
  if (!tag) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-muted-foreground',
        className,
      )}
      title={`Identificador do profissional: ${tag}`}
    >
      {tag}
    </span>
  );
}

/* ---------------- Combobox pesquisável de profissionais ----------------
   Substitui o <select> simples quando há muitos profissionais: busca por nome,
   tag ou e-mail, com resultado mostrando nome + tag + papel/e-mail. Salva sempre
   o id interno (value/onChange) — a tag é só apoio à identificação. Mobile-friendly. */
export interface ProfessionalOption {
  id: string;
  name: string;
  tag: string | null;
  email?: string | null;
  roleLabel?: string | null;
}

export function ProfessionalCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Buscar por nome ou tag…',
  hint,
  error,
  required,
  disabled,
  emptyText = 'Nenhum profissional encontrado.',
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: ProfessionalOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.tag ?? '').toLowerCase().includes(q) ||
        (o.email ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Foca a busca ao abrir; limpa o termo ao fechar.
  useEffect(() => {
    if (open) {
      setHighlight(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery('');
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[highlight];
      if (o) choose(o.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'input flex items-center justify-between gap-2 text-left',
            error && 'invalid',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? (
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="truncate">{selected.name}</span>
                {selected.tag && <span className="font-mono text-[11px] text-muted-foreground shrink-0">{selected.tag}</span>}
              </span>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            <div className="relative border-b border-border">
              <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none"
                aria-controls={listId}
              />
            </div>
            <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground text-center">{emptyText}</li>
              ) : (
                filtered.map((o, i) => {
                  const active = o.id === value;
                  return (
                    <li key={o.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => choose(o.id)}
                        onMouseEnter={() => setHighlight(i)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors',
                          i === highlight ? 'bg-muted' : 'hover:bg-muted/60',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold truncate">{o.name}</span>
                            {o.tag && <span className="font-mono text-[11px] text-muted-foreground">{o.tag}</span>}
                          </span>
                          {(o.email || o.roleLabel) && (
                            <span className="block text-xs text-muted-foreground truncate">
                              {[o.roleLabel, o.email].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        {active && <Check className="size-4 text-primary shrink-0" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>
    </Field>
  );
}
