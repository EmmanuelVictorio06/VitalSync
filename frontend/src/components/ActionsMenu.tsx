import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { ModalOverlay, cn } from './ui';

/**
 * Menu de overflow genérico ("⋯"): bottom sheet no mobile, popover ancorado no
 * desktop. Nasceu dentro de `AttendanceActionsMenu` e foi extraído para cá
 * quando o card de paciente (MonitoringPage) passou a precisar do mesmo padrão
 * — a mecânica (breakpoint, portal, Escape, clique fora) é idêntica; só muda a
 * lista de itens. Quem usa monta as `entries` e o menu cuida de fechar sozinho
 * antes de executar a ação.
 */

const MENU_W = 224;
const MENU_ITEM_H = 42;
const GAP = 8;
/** Mesmo corte do Tailwind `sm` — abaixo dele o menu vira bottom sheet. */
const MOBILE_QUERY = '(max-width: 639px)';

export interface ActionMenuEntry {
  kind: 'button' | 'link';
  icon: typeof MoreVertical;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  external?: boolean;
  /** Ação destrutiva: destacada em vermelho e separada das demais por uma linha. */
  danger?: boolean;
}

function MenuItem({ entry, onClose }: { entry: ActionMenuEntry; onClose: () => void }) {
  const { kind, icon: Icon, label, onClick, disabled, href, external, danger } = entry;
  // py-2.5 + text-sm dá ~42px de altura: já atende alvo de toque dentro do menu.
  const base = cn(
    'w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg text-left transition-colors',
    danger ? 'text-alert hover:bg-alert/10' : 'hover:bg-muted',
  );
  const iconCls = cn('size-4', danger ? 'text-alert' : 'text-muted-foreground');

  if (kind === 'link') {
    return (
      <a
        role="menuitem"
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        onClick={() => {
          onClose();
          onClick?.();
        }}
        className={base}
      >
        <Icon className={iconCls} /> {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClose();
        onClick?.();
      }}
      className={cn(base, 'disabled:opacity-50 disabled:cursor-not-allowed')}
    >
      <Icon className={iconCls} /> {label}
    </button>
  );
}

/** Itens na ordem recebida, com separador antes do primeiro item destrutivo. */
function MenuItems({ entries, onClose }: { entries: ActionMenuEntry[]; onClose: () => void }) {
  const firstDanger = entries.findIndex((e) => e.danger);
  return (
    <>
      {entries.map((entry, i) => (
        <div key={i}>
          {i === firstDanger && i > 0 && <div className="my-1 border-t border-border" />}
          <MenuItem entry={entry} onClose={onClose} />
        </div>
      ))}
    </>
  );
}

function BottomSheet({
  entries,
  ariaLabel,
  onClose,
}: {
  entries: ActionMenuEntry[];
  ariaLabel: string;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose} className="z-50 bg-foreground/50 backdrop-blur-sm items-end justify-center" ariaLabel={ariaLabel}>
      <div className="bg-card border border-border w-full rounded-t-2xl shadow-xl p-2 pb-6 animate-entry">
        <div className="w-10 h-1 bg-border rounded-full mx-auto my-2" />
        <div role="menu" className="space-y-0.5">
          <MenuItems entries={entries} onClose={onClose} />
        </div>
      </div>
    </ModalOverlay>
  );
}

function PortalMenu({ rect, entries, onClose }: { rect: DOMRect; entries: ActionMenuEntry[]; onClose: () => void }) {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const menuH = entries.length * MENU_ITEM_H + 16;

  let left = rect.right - MENU_W;
  if (left + MENU_W > viewportW - GAP) left = viewportW - MENU_W - GAP;
  if (left < GAP) left = GAP;

  let top = rect.bottom + GAP;
  if (top + menuH > viewportH - GAP) top = rect.top - menuH - GAP;
  if (top < GAP) top = GAP;

  return (
    <>
      {/* Overlay invisível para fechar ao clicar fora */}
      {createPortal(
        <div
          className="fixed inset-0 z-[9998]"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
          aria-hidden="true"
        />,
        document.body,
      )}
      {createPortal(
        <div
          role="menu"
          style={{ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${MENU_W}px`, zIndex: 9999 }}
          className="bg-card border border-border rounded-xl shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItems entries={entries} onClose={onClose} />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ActionsMenu({
  entries,
  ariaLabel,
  buttonClassName,
}: {
  entries: ActionMenuEntry[];
  /** Rótulo do botão "⋯" e do bottom sheet (ex.: "Mais ações do paciente"). */
  ariaLabel: string;
  /** Sobrescreve o tamanho do botão (padrão: 44px no mobile, 36px do `sm` pra cima). */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setMobile(e.matches);
      if (e.matches) setOpen(false); // fecha ao transicionar de desktop → mobile
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setRect(null);
  }, []);

  const openMenu = useCallback(() => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeMenu]);

  if (entries.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'rounded-lg border border-border hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors',
          buttonClassName ?? 'size-11 sm:size-9',
        )}
      >
        <MoreVertical className="size-4" />
      </button>

      {open && mobile && <BottomSheet entries={entries} ariaLabel={ariaLabel} onClose={closeMenu} />}
      {open && !mobile && rect && <PortalMenu rect={rect} entries={entries} onClose={closeMenu} />}
    </div>
  );
}
