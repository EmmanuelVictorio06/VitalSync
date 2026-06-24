/**
 * Componentes da tela "Gerenciar Usuários" (Administrador).
 * Peças apresentacionais; a lógica de dados fica em userService/teamService.
 */
import type { ReactNode } from 'react';
import { storageService } from '../services/storageService';
import type { UserRole } from '../services/types';
import { cn } from './ui';
import { initials } from './profile';

/* ---------------- Metadados dos papéis ---------------- */
export const ROLE_META: Record<UserRole, { label: string; badge: string; dot: string }> = {
  ADMIN: { label: 'Administrador', badge: 'bg-primary/10 text-primary border-primary/20', dot: 'bg-primary' },
  MAIN_SURGEON: { label: 'Cirurgião Principal', badge: 'bg-stable/10 text-stable border-stable/20', dot: 'bg-stable' },
  ASSOCIATED_DOCTOR: { label: 'Médico Associado', badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
};

/** Opções de papel para selects/segmentos (sem PACIENTE — não tem login aqui). */
export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'MAIN_SURGEON', label: 'Cirurgião Principal' },
  { value: 'ASSOCIATED_DOCTOR', label: 'Médico Associado' },
];

/* ---------------- Badge de papel ---------------- */
export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role] ?? ROLE_META.ASSOCIATED_DOCTOR;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border', meta.badge)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

/* ---------------- Avatar (foto ou iniciais) ---------------- */
export function UserAvatar({ name, avatarPath, size = 9 }: { name: string; avatarPath: string | null; size?: number }) {
  const url = avatarPath ? storageService.getProfileAvatarUrl(avatarPath) : null;
  return (
    <span
      className="rounded-full overflow-hidden bg-primary/10 text-primary grid place-items-center font-bold shrink-0 border border-border"
      style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem`, fontSize: `${size * 0.09}rem` }}
    >
      {url ? <img src={url} alt={`Avatar de ${name}`} className="size-full object-cover" /> : initials(name)}
    </span>
  );
}

/* ---------------- Drawer lateral (detalhes) ---------------- */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border-l border-border shadow-xl h-full overflow-y-auto animate-entry">
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-5 py-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button onClick={onClose} className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-6">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Shell de modal centralizado ---------------- */
export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={cn('bg-card border border-border rounded-xl shadow-lg p-6 w-full space-y-4 animate-entry my-8', wide ? 'max-w-2xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button onClick={onClose} className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center shrink-0" aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
