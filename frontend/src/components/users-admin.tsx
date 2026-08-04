/**
 * Componentes da tela "Gerenciar Usuários" (Administrador).
 * Peças apresentacionais; a lógica de dados fica em userService/teamService.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  CircleSlash,
  Headphones,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  UserCog,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { storageService } from '../services/storageService';
import type { EntityStatus, UserOverview, UserRole } from '../services/types';
import { Button, CustomSelect, cn } from './ui';
import { initials } from './profile';

/* ---------------- Metadados dos papéis ---------------- */
export const ROLE_META: Record<UserRole, { label: string; badge: string; dot: string }> = {
  ADMIN: { label: 'Administrador', badge: 'bg-primary/10 text-primary border-primary/20', dot: 'bg-primary' },
  MEDICAL_SURGEON: { label: 'Médico Cirurgião', badge: 'bg-stable/10 text-stable border-stable/20', dot: 'bg-stable' },
  ASSOCIATED_DOCTOR: { label: 'Médico Associado', badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  SUPPORT: { label: 'Suporte', badge: 'bg-warning/10 text-warning border-warning/20', dot: 'bg-warning' },
  TEAM_MANAGER: { label: 'Gerente de Equipe', badge: 'bg-info/10 text-info border-info/20', dot: 'bg-info' },
  NURSING_PROFESSIONAL: { label: 'Profissional de Enfermagem', badge: 'bg-stable/10 text-stable border-stable/20', dot: 'bg-stable' },
};

/** Opções de papel para selects/segmentos. */
export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'MEDICAL_SURGEON', label: 'Médico Cirurgião' },
  { value: 'ASSOCIATED_DOCTOR', label: 'Médico Associado' },
  { value: 'SUPPORT', label: 'Suporte' },
  { value: 'TEAM_MANAGER', label: 'Gerente de Equipe' },
  { value: 'NURSING_PROFESSIONAL', label: 'Profissional de Enfermagem' },
];

/* ---------------- Badge de papel ---------------- */
export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role] ?? ROLE_META.ASSOCIATED_DOCTOR;
  // O badge sempre aceita quebra de linha (whitespace-normal): papéis longos
  // como "Profissional de Enfermagem" viram duas linhas controladas dentro da
  // coluna, sem reticências, sem abreviação e sem empurrar o layout. max-w-full
  // + min-w-0 garantem que o badge respeite a largura da célula.
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center justify-center gap-1.5 whitespace-normal text-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider leading-tight border',
        meta.badge,
      )}
      title={meta.label}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
      <span className="min-w-0 text-center">{meta.label}</span>
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

/* ============================ Estado de filtros ============================
   A busca + os cards de filtro rápido + os filtros avançados compartilham um
   único estado, no mesmo espírito da aba "Alertas". Os cards do topo escrevem
   em role/status; os filtros avançados controlam equipe/acesso/cadastro. */

export type UserRoleFilter = UserRole | 'ALL';
export type UserStatusFilter = EntityStatus | 'ALL';
export type UserTeamFilter = 'ALL' | 'WITH' | 'WITHOUT';
export type UserLastAccessFilter = 'ALL' | 'TODAY' | '7D' | '30D' | 'NEVER';
export type UserRegistrationFilter = 'ALL' | 'NEWEST' | 'OLDEST';

export interface UserFiltersState {
  search: string;
  role: UserRoleFilter;
  status: UserStatusFilter;
  team: UserTeamFilter;
  lastAccess: UserLastAccessFilter;
  registration: UserRegistrationFilter;
}

export const EMPTY_USER_FILTERS: UserFiltersState = {
  search: '', role: 'ALL', status: 'ALL', team: 'ALL', lastAccess: 'ALL', registration: 'ALL',
};

/** Contagens exibidas nos cards de filtro rápido. */
export interface UserSummary {
  total: number;
  admins: number;
  surgeons: number;
  associates: number;
  support: number;
  teamManager: number;
  active: number;
  inactive: number;
}

/* ----------------- Cards de filtro rápido (topo) ----------------- */

export type UserQuickKey = 'ALL' | 'ADMIN' | 'MEDICAL_SURGEON' | 'ASSOCIATED_DOCTOR' | 'SUPPORT' | 'TEAM_MANAGER' | 'ACTIVE' | 'INACTIVE';

const USER_QUICK_PRESET: Record<UserQuickKey, Pick<UserFiltersState, 'role' | 'status'>> = {
  ALL: { role: 'ALL', status: 'ALL' },
  ADMIN: { role: 'ADMIN', status: 'ALL' },
  MEDICAL_SURGEON: { role: 'MEDICAL_SURGEON', status: 'ALL' },
  ASSOCIATED_DOCTOR: { role: 'ASSOCIATED_DOCTOR', status: 'ALL' },
  SUPPORT: { role: 'SUPPORT', status: 'ALL' },
  TEAM_MANAGER: { role: 'TEAM_MANAGER', status: 'ALL' },
  ACTIVE: { role: 'ALL', status: 'ACTIVE' },
  INACTIVE: { role: 'ALL', status: 'INACTIVE' },
};

/** Card destacado conforme os filtros atuais (null = combinação avançada). */
export function activeUserQuickCard(f: UserFiltersState): UserQuickKey | null {
  for (const key of Object.keys(USER_QUICK_PRESET) as UserQuickKey[]) {
    const p = USER_QUICK_PRESET[key];
    if (f.role === p.role && f.status === p.status) return key;
  }
  return null;
}

/** Aplica o preset do card; clicar no card já ativo limpa o filtro rápido. */
export function applyUserQuickCard(f: UserFiltersState, key: UserQuickKey): UserFiltersState {
  if (activeUserQuickCard(f) === key) return { ...f, role: 'ALL', status: 'ALL' };
  return { ...f, ...USER_QUICK_PRESET[key] };
}

type UserQuickColor = 'primary' | 'stable' | 'muted' | 'alert' | 'warning' | 'info';
const USER_QUICK_COLOR: Record<UserQuickColor, { icon: string; active: string; num: string }> = {
  primary: { icon: 'bg-primary/10 text-primary', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  stable: { icon: 'bg-stable/10 text-stable', active: 'border-stable ring-1 ring-stable bg-stable/5', num: 'text-stable' },
  muted: { icon: 'bg-muted text-muted-foreground', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  alert: { icon: 'bg-alert/10 text-alert', active: 'border-alert ring-1 ring-alert bg-alert/5', num: 'text-alert' },
  warning: { icon: 'bg-warning/10 text-warning', active: 'border-warning ring-1 ring-warning bg-warning/5', num: 'text-warning' },
  info: { icon: 'bg-info/10 text-info', active: 'border-info ring-1 ring-info bg-info/5', num: 'text-info' },
};

const USER_QUICK_CARDS: Array<{ key: UserQuickKey; label: string; icon: typeof Users; color: UserQuickColor }> = [
  { key: 'ALL', label: 'Total de usuários', icon: Users, color: 'primary' },
  { key: 'ADMIN', label: 'Administradores', icon: ShieldCheck, color: 'primary' },
  { key: 'MEDICAL_SURGEON', label: 'Médicos cirurgiões', icon: Stethoscope, color: 'stable' },
  { key: 'ASSOCIATED_DOCTOR', label: 'Médicos associados', icon: UserCog, color: 'muted' },
  { key: 'SUPPORT', label: 'Suporte', icon: Headphones, color: 'warning' },
  { key: 'TEAM_MANAGER', label: 'Gerentes de equipe', icon: UsersRound, color: 'info' },
  { key: 'ACTIVE', label: 'Usuários ativos', icon: CheckCircle2, color: 'stable' },
  { key: 'INACTIVE', label: 'Usuários inativos', icon: CircleSlash, color: 'alert' },
];

export function UserQuickFilterCard({ label, value, icon: Icon, color, active, onClick }: {
  label: string; value: number; icon: typeof Users; color: UserQuickColor; active: boolean; onClick: () => void;
}) {
  const c = USER_QUICK_COLOR[color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'text-left bg-card border rounded-xl p-3 sm:p-4 shadow-sm flex items-center gap-3 transition-all',
        'hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? c.active : 'border-border',
      )}
    >
      <span className={cn('size-9 sm:size-10 rounded-lg flex items-center justify-center shrink-0', c.icon)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className={cn('text-xl sm:text-2xl font-extrabold tracking-tight leading-none', active && c.num)}>{value}</p>
        <p className="text-[11px] text-muted-foreground font-semibold mt-1 truncate">{label}</p>
      </div>
    </button>
  );
}

export function UserSummaryQuickFilters({ summary, active, onSelect }: {
  summary: UserSummary; active: UserQuickKey | null; onSelect: (key: UserQuickKey) => void;
}) {
  const counts: Record<UserQuickKey, number> = {
    ALL: summary.total, ADMIN: summary.admins, MEDICAL_SURGEON: summary.surgeons,
    ASSOCIATED_DOCTOR: summary.associates, SUPPORT: summary.support, TEAM_MANAGER: summary.teamManager,
    ACTIVE: summary.active, INACTIVE: summary.inactive,
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 animate-entry">
      {USER_QUICK_CARDS.map((c) => (
        <UserQuickFilterCard
          key={c.key}
          label={c.label}
          value={counts[c.key]}
          icon={c.icon}
          color={c.color}
          active={active === c.key}
          onClick={() => onSelect(c.key)}
        />
      ))}
    </div>
  );
}

/* ----------------- Barra de busca + botão "Filtros" ----------------- */

/** Conta os filtros avançados ativos (badge do botão "Filtros"). */
export function countUserAdvancedFilters(f: UserFiltersState): number {
  let n = 0;
  if (f.team !== 'ALL') n++;
  if (f.lastAccess !== 'ALL') n++;
  if (f.registration !== 'ALL') n++;
  return n;
}

export function UserSearchBar({ search, onSearch, onOpenFilters, activeFilterCount }: {
  search: string;
  onSearch: (v: string) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="flex items-stretch gap-2 animate-entry">
      <div className="relative flex-1 min-w-0">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input pl-9"
          placeholder="Buscar por nome, e-mail ou WhatsApp..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        className="inline-flex items-center gap-2 px-3 sm:px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors shrink-0"
      >
        <SlidersHorizontal className="size-4" />
        <span className="hidden sm:inline">Filtros</span>
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}

/* ----------------- Chips de filtros ativos ----------------- */

function chipLabels(f: UserFiltersState): Array<{ key: keyof UserFiltersState; label: string }> {
  const out: Array<{ key: keyof UserFiltersState; label: string }> = [];
  if (f.role !== 'ALL') out.push({ key: 'role', label: `Perfil: ${ROLE_META[f.role].label}` });
  if (f.status !== 'ALL') out.push({ key: 'status', label: `Status: ${f.status === 'ACTIVE' ? 'Ativos' : 'Inativos'}` });
  if (f.team !== 'ALL') out.push({ key: 'team', label: `Equipe: ${f.team === 'WITH' ? 'Com equipe' : 'Sem equipe'}` });
  if (f.lastAccess !== 'ALL') {
    const m: Record<Exclude<UserLastAccessFilter, 'ALL'>, string> = { TODAY: 'Hoje', '7D': 'Últimos 7 dias', '30D': 'Últimos 30 dias', NEVER: 'Nunca acessou' };
    out.push({ key: 'lastAccess', label: `Último acesso: ${m[f.lastAccess]}` });
  }
  if (f.registration !== 'ALL') {
    out.push({ key: 'registration', label: `Cadastro: ${f.registration === 'NEWEST' ? 'Mais recentes' : 'Mais antigos'}` });
  }
  return out;
}

export function UserActiveFilterChips({ filters, onRemove, onClear }: {
  filters: UserFiltersState;
  onRemove: (key: keyof UserFiltersState) => void;
  onClear: () => void;
}) {
  const chips = chipLabels(filters);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 animate-entry">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 pl-3 pr-1.5 py-1 text-xs font-semibold">
          {chip.label}
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            className="size-4 rounded-full hover:bg-primary/20 flex items-center justify-center"
            aria-label={`Remover filtro ${chip.label}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClear} className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline">
          Limpar tudo
        </button>
      )}
    </div>
  );
}

/* ----------------- Filtros avançados (bottom sheet / modal) ----------------- */

// Wrapper sobre o CustomSelect (listbox estilizado) preservando a API usada
// pelos filtros: `onChange(v)` recebe o valor direto (sem evento). Mantém o
// mesmo padrão visual dos demais dropdowns do site.
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <CustomSelect
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
    />
  );
}

export function UserAdvancedFilters({ value, onApply, onClose }: {
  value: UserFiltersState;
  onApply: (next: UserFiltersState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<UserFiltersState>(value);
  const set = <K extends keyof UserFiltersState>(k: K, v: UserFiltersState[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function clear() {
    setDraft((d) => ({ ...d, role: 'ALL', status: 'ALL', team: 'ALL', lastAccess: 'ALL', registration: 'ALL' }));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Filtros avançados"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-extrabold tracking-tight flex-1">Filtros avançados</h2>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FilterSelect label="Perfil do usuário" value={draft.role} onChange={(v) => set('role', v as UserRoleFilter)}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'ADMIN', label: 'Administrador' }, { value: 'MEDICAL_SURGEON', label: 'Médico Cirurgião' }, { value: 'ASSOCIATED_DOCTOR', label: 'Médico Associado' }, { value: 'SUPPORT', label: 'Suporte' }, { value: 'TEAM_MANAGER', label: 'Gerente de Equipe' }]} />
          <FilterSelect label="Status" value={draft.status} onChange={(v) => set('status', v as UserStatusFilter)}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'ACTIVE', label: 'Ativos' }, { value: 'INACTIVE', label: 'Inativos' }]} />
          <FilterSelect label="Equipe" value={draft.team} onChange={(v) => set('team', v as UserTeamFilter)}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'WITH', label: 'Com equipe' }, { value: 'WITHOUT', label: 'Sem equipe' }]} />
          <FilterSelect label="Último acesso" value={draft.lastAccess} onChange={(v) => set('lastAccess', v as UserLastAccessFilter)}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'TODAY', label: 'Hoje' }, { value: '7D', label: 'Últimos 7 dias' }, { value: '30D', label: 'Últimos 30 dias' }, { value: 'NEVER', label: 'Nunca acessou' }]} />
          <FilterSelect label="Data de cadastro" value={draft.registration} onChange={(v) => set('registration', v as UserRegistrationFilter)}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'NEWEST', label: 'Mais recentes' }, { value: 'OLDEST', label: 'Mais antigos' }]} />
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={clear}>Limpar filtros</Button>
          <Button onClick={() => { onApply(draft); onClose(); }}>Aplicar filtros</Button>
        </footer>
      </div>
    </div>
  );
}

/* ----------------- Aplicação dos filtros + ordenação ----------------- */

export function applyUserFilters(users: UserOverview[], f: UserFiltersState): UserOverview[] {
  const q = f.search.trim().toLowerCase();
  const qDigits = onlyDigits(f.search);
  const now = Date.now();
  const within: Record<string, number> = { TODAY: 1, '7D': 7, '30D': 30 };

  const list = users.filter((u) => {
    if (q) {
      const matchText = u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchPhone = qDigits.length > 0 && (u.whatsapp ?? '').includes(qDigits);
      if (!matchText && !matchPhone) return false;
    }
    if (f.role !== 'ALL' && u.role !== f.role) return false;
    if (f.status !== 'ALL' && u.status !== f.status) return false;
    if (f.team === 'WITH' && u.team_count === 0) return false;
    if (f.team === 'WITHOUT' && u.team_count > 0) return false;
    if (f.lastAccess === 'NEVER') {
      if (u.last_sign_in_at) return false;
    } else if (f.lastAccess !== 'ALL') {
      if (!u.last_sign_in_at) return false;
      const days = within[f.lastAccess] ?? 0;
      if (days > 0 && now - new Date(u.last_sign_in_at).getTime() > days * 86_400_000) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (f.registration === 'NEWEST') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (f.registration === 'OLDEST') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return a.name.localeCompare(b.name, 'pt-BR');
  });
  return list;
}
