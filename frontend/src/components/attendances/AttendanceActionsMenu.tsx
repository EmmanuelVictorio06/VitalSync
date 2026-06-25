import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, MessageCircle, MoreVertical, Pencil, Stethoscope } from 'lucide-react';
import { whatsappLink } from '@vitalsync/shared';
import type { AttendanceRow } from '../../services/attendanceService';
import { cn } from '../ui';

const WHATSAPP_MSG = 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.';
const MENU_W = 224;
const MENU_ITEM_H = 42;
const GAP = 8;

/* ======================= Tipos internos ======================= */

interface MenuEntry {
  kind: 'button' | 'link';
  icon: typeof MoreVertical;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  external?: boolean;
}

/* ======================= MenuItem ======================= */

function MenuItemButton({ icon: Icon, label, onClick, disabled }: MenuEntry) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg',
        'hover:bg-muted text-left transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      )}
    >
      <Icon className="size-4 text-muted-foreground" /> {label}
    </button>
  );
}

function MenuItemLink({ icon: Icon, label, onClick, href, external }: MenuEntry) {
  return (
    <a
      role="menuitem"
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg',
        'hover:bg-muted text-left transition-colors',
      )}
    >
      <Icon className="size-4 text-muted-foreground" /> {label}
    </a>
  );
}

/* ======================= Bottom sheet (mobile) ======================= */

function BottomSheet({
  entries,
  onClose,
}: {
  entries: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Ações do atendimento"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border w-full rounded-t-2xl shadow-xl p-2 pb-6 animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto my-2" />
        <div role="menu" className="space-y-0.5">
          {entries.map((entry, i) =>
            entry.kind === 'link' ? (
              <MenuItemLink key={i} {...entry} />
            ) : (
              <MenuItemButton key={i} {...entry} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================= Portal menu (desktop) ======================= */

function PortalMenu({ rect, entries, onClose }: { rect: DOMRect; entries: MenuEntry[]; onClose: () => void }) {
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
          onContextMenu={(e) => { e.preventDefault(); onClose(); }}
          aria-hidden="true"
        />,
        document.body,
      )}
      {/* Menu propriamente dito */}
      {createPortal(
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: `${left}px`,
            top: `${top}px`,
            width: `${MENU_W}px`,
            zIndex: 9999,
          }}
          className="bg-card border border-border rounded-xl shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          {entries.map((entry, i) =>
            entry.kind === 'link' ? (
              <MenuItemLink key={i} {...entry} />
            ) : (
              <MenuItemButton key={i} {...entry} />
            ),
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ======================= Componente principal ======================= */

export function AttendanceActionsMenu(props: AttendanceActionsMenuProps) {
  const { row, canEdit, onFollow, onViewMeasurement, onViewAlert, onEditObservation } = props;
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeMenu]);

  const entries: MenuEntry[] = useMemo(() => {
    const list: MenuEntry[] = [];
    list.push({ kind: 'button', icon: Stethoscope, label: 'Acompanhar paciente', onClick: () => { closeMenu(); onFollow(); } });
    list.push({ kind: 'button', icon: FileText, label: 'Ver medição relacionada', disabled: !row.vital_record, onClick: () => { closeMenu(); onViewMeasurement(); } });
    if (row.alert) {
      list.push({ kind: 'button', icon: FileText, label: 'Ver alerta original', onClick: () => { closeMenu(); onViewAlert(); } });
    }
    if (row.patient?.phone) {
      list.push({ kind: 'link', icon: MessageCircle, label: 'Conversar no WhatsApp', href: whatsappLink(row.patient.phone, WHATSAPP_MSG), external: true, onClick: closeMenu });
    }
    if (canEdit) {
      list.push({ kind: 'button', icon: Pencil, label: 'Editar observação final', onClick: () => { closeMenu(); onEditObservation(); } });
    }
    return list;
  }, [row, canEdit, onFollow, onViewMeasurement, onViewAlert, onEditObservation, closeMenu]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label="Abrir ações do atendimento"
        aria-haspopup="menu"
        aria-expanded={open}
        className="size-9 min-w-[2.25rem] rounded-lg border border-border hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
      >
        <MoreVertical className="size-4" />
      </button>

      {open && mobile && (
        <BottomSheet entries={entries} onClose={closeMenu} />
      )}

      {open && !mobile && rect && (
        <PortalMenu rect={rect} entries={entries} onClose={closeMenu} />
      )}
    </div>
  );
}

interface AttendanceActionsMenuProps {
  row: AttendanceRow;
  canEdit: boolean;
  onFollow: () => void;
  onViewMeasurement: () => void;
  onViewAlert: () => void;
  onEditObservation: () => void;
}
