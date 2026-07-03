/** Componentes reutilizáveis da seção Administração. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Inbox, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { EntityStatus } from '../lib/admin-types';
import { useBreakpoint } from '../hooks/useBreakpoint';
import type { Breakpoint } from '../constants/breakpoints';
import { Responsive } from './responsive/Responsive';
import { Button, PageHeader, cn } from './ui';

/* ---------------- Cabeçalho de página administrativa ---------------- */
/** Delega ao PageHeader global para manter o mesmo cabeçalho/botão do resto do app. */
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
    <PageHeader
      title={title}
      subtitle={subtitle}
      action={
        actionLabel ? (
          <Button onClick={onAction}>
            <Plus className="size-4" /> {actionLabel}
          </Button>
        ) : undefined
      }
    />
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
  /** Ajuste opcional da linha no card mobile. */
  mobileRowClassName?: string;
  /** Ajuste opcional do valor no card mobile. */
  mobileValueClassName?: string;
}

export function AdminTable<T>({
  columns,
  rows,
  keyFor,
  actions,
  tableClassName,
  actionsClassName,
  desktopMin = 'md',
  mobileMax = 'sm',
}: {
  columns: Array<AdminColumn<T>>;
  rows: T[];
  keyFor: (row: T) => string;
  /** Ações da linha (botões de ícone). */
  actions?: (row: T) => ReactNode;
  /** Ajuste opcional para tabelas densas que precisam de uma malha própria. */
  tableClassName?: string;
  /** Largura/alinhamento da coluna de ações no desktop. */
  actionsClassName?: string;
  /** Breakpoint mínimo para renderizar a tabela. */
  desktopMin?: Breakpoint;
  /** Breakpoint máximo para renderizar os cards. */
  mobileMax?: Breakpoint;
}) {
  return (
    <>
      {/* Desktop: tabela tradicional. `Responsive` evita montar a versão mobile
          em paralelo (sem rodar hooks/render dela fora do breakpoint).
          overflow-x-auto: se faltar largura, rola DENTRO do card (nunca na página);
          os menus de ação usam portal, então não são cortados pelo container. */}
      <Responsive min={desktopMin}>
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-x-auto">
        <table className={cn('w-full table-fixed text-sm', tableClassName)}>
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
              {actions && <th className={cn('px-4 py-3 text-right', actionsClassName)} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={keyFor(row)} className="hover:bg-muted/30 transition-colors">
                {columns.map((c) => (
                  <td key={c.header} className={cn('px-4 py-3 overflow-hidden', c.className)}>
                    {c.render(row)}
                  </td>
                ))}
                {actions && (
                  <td className={cn('px-4 py-3 overflow-visible', actionsClassName)}>
                    <div className="flex gap-2 justify-end">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Responsive>

      {/* Mobile: cada linha vira card. */}
      <Responsive max={mobileMax}>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={keyFor(row)} className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-2">
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((c) => (
                <div key={c.header} className={cn(c.mobileRowClassName ?? 'flex items-center justify-between', 'gap-3 text-sm')}>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {c.header}
                  </span>
                  <span className={cn('text-right min-w-0', c.mobileValueClassName)}>{c.render(row)}</span>
                </div>
              ))}
            {actions && <div className="flex gap-2 justify-end pt-2 border-t border-border">{actions(row)}</div>}
          </div>
        ))}
      </div>
      </Responsive>
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
        'size-8 shrink-0 rounded-md border flex items-center justify-center transition-colors',
        danger
          ? 'border-alert/30 text-alert hover:bg-alert/5'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Menu "Mais ações" (três pontos) ----------------
   Agrupa as ações secundárias da linha. O painel é renderizado via PORTAL no
   document.body, então NUNCA é cortado por containers com overflow (cards,
   tabela com overflow-x-auto). No desktop abre ancorado ao botão (com detecção
   de colisão); no mobile abre como bottom sheet, com alvos de toque grandes. */
export interface RowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function RowActionsMenu({ actions, label = 'Mais ações' }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bp = useBreakpoint();
  const isMobile = bp === 'base' || bp === 'sm';
  const MENU_W = 224;

  // Fecha ao rolar/redimensionar (evita painel em posição obsoleta) e no Esc.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r && !isMobile) {
      const left = Math.max(16, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 16));
      const estH = actions.length * 40 + 8;
      const top = r.bottom + 6 + estH > window.innerHeight - 16 ? Math.max(16, r.top - estH - 6) : r.bottom + 6;
      setCoords({ top, left });
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="size-8 shrink-0 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9998]" role="presentation" onClick={() => setOpen(false)}>
            {isMobile ? (
              <div
                role="menu"
                aria-label={label}
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-x-0 bottom-0 bg-card border-t border-border rounded-t-2xl shadow-xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] animate-entry"
              >
                <div className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full bg-border" aria-hidden />
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    onClick={() => { setOpen(false); a.onClick(); }}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-left transition-colors min-h-[44px]',
                      a.danger ? 'text-alert hover:bg-alert/5' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="shrink-0">{a.icon}</span>
                    <span className="truncate">{a.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div
                role="menu"
                aria-label={label}
                onClick={(e) => e.stopPropagation()}
                style={{ top: coords.top, left: coords.left, width: MENU_W }}
                className="absolute z-[9999] bg-card border border-border rounded-lg shadow-lg py-1 animate-entry"
              >
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    onClick={() => { setOpen(false); a.onClick(); }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                      a.danger ? 'text-alert hover:bg-alert/5' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground">{a.icon}</span>
                    <span className="truncate">{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
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
