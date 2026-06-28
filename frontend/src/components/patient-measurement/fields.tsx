/**
 * Campos reutilizáveis do wizard de medição — visual coerente com o cadastro
 * de profissional (input claro, foco azul, label, ajuda e erro próximos).
 */
import type { ComponentType } from 'react';
import { cn } from '../ui';

type IconType = ComponentType<{ className?: string }>;

/* ---------------- NumericInput ---------------- */
/** Campo numérico grande (abre teclado numérico no celular), com ícone, ajuda e erro. */
export function NumericInput({
  icon: Icon,
  label,
  placeholder,
  hint,
  error,
  value,
  onChange,
  inputMode = 'numeric',
}: {
  icon?: IconType;
  label: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-bold text-foreground mb-1.5">
        {Icon && <Icon className="size-3.5 text-primary" />}
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full bg-muted/60 border rounded-xl px-4 py-3.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
          error ? 'border-alert' : 'border-border',
        )}
      />
      {hint && !error && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
      {error && <span className="block text-xs font-semibold text-alert mt-1">{error}</span>}
    </label>
  );
}

/* ---------------- SymptomScaleSelector ---------------- */
/**
 * Escala 0–10 reutilizável (dor e dispneia usam o MESMO componente).
 *
 * Visual compacto e moderno: bolinhas pequenas em UMA linha horizontal com
 * scroll interno (sem scroll lateral na página). No desktop tudo cabe sem
 * scroll aparente. Selecionado em azul; valor exibido como "2/10".
 */
export function SymptomScaleSelector({
  icon: Icon,
  label,
  description,
  value,
  onChange,
  minLabel,
  maxLabel,
  error,
}: {
  icon?: IconType;
  label: string;
  description?: string;
  value: number | null;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          {Icon && <Icon className="size-3.5 text-primary translate-y-px" />}
          {label}
        </span>
        <span
          className={cn(
            'ml-auto text-xs font-bold tabular-nums',
            value === null ? 'text-muted-foreground' : 'text-primary',
          )}
        >
          {value === null ? 'Não informado' : `${value}/10`}
        </span>
      </div>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}

      {/* Grade que SEMPRE cabe na largura: 6 colunas no mobile (2 linhas
          enxutas), 11 colunas a partir de sm. As bolinhas se ajustam à largura
          disponível (aspect-square), então nunca estouram nem geram scroll. */}
      <div className="mt-2.5 grid grid-cols-6 sm:grid-cols-11 gap-1.5 sm:gap-2">
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              aria-label={`${label}: ${n} de 10`}
              onClick={() => onChange(n)}
              className={cn(
                'w-full aspect-square max-w-12 mx-auto rounded-full text-sm font-semibold grid place-items-center transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active
                  ? 'bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20'
                  : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between gap-3 mt-2 text-[11px] leading-tight font-semibold text-muted-foreground">
        <span>{minLabel}</span>
        <span className="text-right">{maxLabel}</span>
      </div>
      {error && <span className="block text-xs font-semibold text-alert mt-1.5">{error}</span>}
    </div>
  );
}

/* ---------------- YesNoSelector ---------------- */
/** Pergunta Sim/Não com dois botões iguais; selecionado em azul. */
export function YesNoSelector({
  label,
  value,
  onChange,
  yesLabel = 'Sim',
  noLabel = 'Não',
  error,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
  error?: string;
}) {
  return (
    <div>
      <span className="block text-sm font-bold mb-2">{label}</span>
      <div className="grid grid-cols-2 gap-3">
        {([true, false] as const).map((opt) => {
          const active = value === opt;
          return (
            <button
              key={String(opt)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt)}
              className={cn(
                'min-h-12 py-3 rounded-xl font-bold text-sm border-2 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                active
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30',
              )}
            >
              {opt ? yesLabel : noLabel}
            </button>
          );
        })}
      </div>
      {error && <span className="block text-xs font-semibold text-alert mt-1.5">{error}</span>}
    </div>
  );
}
