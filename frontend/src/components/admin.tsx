/** Componentes reutilizáveis da seção Administração. */
import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Plus, Search } from 'lucide-react';
import type { EntityStatus } from '../lib/admin-types';
import { cn } from './ui';

/* ---------------- Cabeçalho de página administrativa ---------------- */
export function AdminPageHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-3 animate-entry">
      <div className="flex-1">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>
      </div>
      {actionLabel && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 self-start sm:self-auto"
        >
          <Plus className="size-4" /> {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ---------------- Badge Ativo/Inativo ---------------- */
export function StatusPill({ status }: { status: EntityStatus }) {
  const active = status === 'ACTIVE';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
        active ? 'bg-stable/10 text-stable border-stable/20' : 'bg-muted text-muted-foreground border-border',
      )}
    >
      <span className={cn('size-1.5 rounded-full', active ? 'bg-stable' : 'bg-muted-foreground')} aria-hidden />
      {active ? 'Ativo' : 'Inativo'}
    </span>
  );
}

/* ---------------- Toggle switch ---------------- */
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-6 w-10 items-center rounded-full p-0.5 transition-colors shrink-0 overflow-hidden',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'block size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
      {label && <span className="text-sm font-medium">{label}</span>}
    </label>
  );
}

/* ---------------- Busca ---------------- */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
      <Search className="size-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
      />
    </div>
  );
}

/* ---------------- Filtro segmentado ---------------- */
export function SegmentedFilter<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex gap-1 bg-muted rounded-lg p-1 self-start">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
            value === o.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Estados de carregamento / vazio / erro ---------------- */
export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return <p className="text-center text-muted-foreground py-10 animate-pulse">{label}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
      <Inbox className="size-8 mx-auto mb-3 opacity-40" />
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-card border border-alert/30 rounded-xl p-10 text-center">
      <AlertCircle className="size-8 mx-auto mb-3 text-alert" />
      <p className="font-semibold">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/* ---------------- Tabela administrativa responsiva ----------------
   Desktop: tabela tradicional. Mobile: cada linha vira um card. */
export interface AdminColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  /** Não exibir no card mobile (ex.: colunas redundantes). */
  hideOnMobile?: boolean;
  className?: string;
}

export function AdminTable<T>({
  columns,
  rows,
  keyFor,
  actions,
}: {
  columns: Array<AdminColumn<T>>;
  rows: T[];
  keyFor: (row: T) => string;
  /** Ações da linha (botões de ícone). */
  actions?: (row: T) => ReactNode;
}) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((c) => (
                <th
                  key={c.header}
                  className={cn('text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground', c.className)}
                >
                  {c.header}
                </th>
              ))}
              {actions && <th className="px-4 py-3 w-1" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={keyFor(row)} className="hover:bg-muted/30 transition-colors">
                {columns.map((c) => (
                  <td key={c.header} className={cn('px-4 py-3', c.className)}>
                    {c.render(row)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {rows.map((row) => (
          <div key={keyFor(row)} className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-2">
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((c) => (
                <div key={c.header} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {c.header}
                  </span>
                  <span className="text-right min-w-0">{c.render(row)}</span>
                </div>
              ))}
            {actions && <div className="flex gap-2 justify-end pt-2 border-t border-border">{actions(row)}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Botão de ação de linha (ícone) ---------------- */
export function RowIconButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'size-8 rounded-md border flex items-center justify-center transition-colors',
        danger
          ? 'border-alert/30 text-alert hover:bg-alert/5'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Seção de configurações ---------------- */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-5">
      <header>
        <h3 className="font-bold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </header>
      {children}
    </section>
  );
}
