/**
 * Componentes da tela "Gerenciar Equipes" (Administrador).
 *
 * Peças apresentacionais e de formulário reutilizadas pela página. A lógica de
 * dados fica nos serviços (teamService/profileService); aqui só UI + validação
 * de formulário. Reaproveita os componentes base de ui.tsx e admin.tsx.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  BellRing,
  CheckCircle2,
  CircleSlash,
  Mail,
  Phone,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  Users2,
  X,
} from 'lucide-react';
import { formatPhoneBR, onlyDigits } from '@vitalsync/shared';
import type { TeamDetail } from '../services/teamViewService';
import { Button, PhoneInput, TextInput, cn } from './ui';

/* ---------------- Card de resumo (topo da tela) ---------------- */
export function SummaryCard({
  label,
  value,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'primary' | 'stable' | 'warning' | 'alert' | 'muted';
}) {
  const TONE: Record<string, string> = {
    primary: 'text-primary bg-primary/10',
    stable: 'text-stable bg-stable/10',
    warning: 'text-warning bg-warning/10',
    alert: 'text-alert bg-alert/10',
    muted: 'text-muted-foreground bg-muted',
  };
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex items-center gap-3">
      <span className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${TONE[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold tracking-tight leading-none">{value}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

/* ---------------- Tela de acesso negado ---------------- */
export function AccessDenied() {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto w-full">
      <div className="bg-card border border-alert/30 rounded-xl shadow-sm p-12 text-center">
        <ShieldAlert className="size-10 mx-auto mb-4 text-alert" />
        <h2 className="text-xl font-extrabold tracking-tight">Acesso restrito</h2>
        <p className="text-muted-foreground mt-2">Você não tem permissão para acessar esta página.</p>
      </div>
    </div>
  );
}

/* ---------------- Linha de contato (e-mail / WhatsApp) ---------------- */
export function ContactLine({ email, whatsapp }: { email?: string | null; whatsapp?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
      {email && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate">
          <Mail className="size-3 shrink-0" /> {email}
        </span>
      )}
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <Phone className="size-3 shrink-0" /> {whatsapp ? formatPhoneBR(whatsapp) : '—'}
      </span>
    </div>
  );
}

/* ---------------- Sub-formulário: novo médico ---------------- */
export interface NewDoctorDraft {
  name: string;
  email: string;
  password: string;
  confirm: string;
  whatsapp: string;
}

export const EMPTY_DOCTOR: NewDoctorDraft = { name: '', email: '', password: '', confirm: '', whatsapp: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida os campos de um novo médico. Retorna a mensagem de erro ou null. */
export function validateNewDoctor(d: NewDoctorDraft): string | null {
  if (!d.name.trim()) return 'Informe o nome completo do médico.';
  if (!EMAIL_RE.test(d.email.trim())) return 'Informe um e-mail válido.';
  if (d.password.length < 6) return 'A senha deve ter no mínimo 6 caracteres.';
  if (d.confirm !== d.password) return 'As senhas não conferem.';
  return null;
}

export function NewDoctorFields({
  value,
  onChange,
}: {
  value: NewDoctorDraft;
  onChange: (d: NewDoctorDraft) => void;
}) {
  function set<K extends keyof NewDoctorDraft>(k: K, v: NewDoctorDraft[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <div className="sm:col-span-2">
        <TextInput label="Nome completo" required placeholder="Ex. Dra. Ana Souza" value={value.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <TextInput label="E-mail (login)" type="email" required placeholder="medico@email.com" value={value.email} onChange={(e) => set('email', e.target.value)} />
      <PhoneInput label="WhatsApp" value={value.whatsapp} onChange={(v) => set('whatsapp', v)} />
      <TextInput label="Senha temporária" type="password" required placeholder="••••••••" hint="Mínimo 6 caracteres." value={value.password} onChange={(e) => set('password', e.target.value)} />
      <TextInput label="Confirmar senha" type="password" required placeholder="••••••••" value={value.confirm} onChange={(e) => set('confirm', e.target.value)} />
    </div>
  );
}

/* ---------------- Seletor "existente vs. novo" ---------------- */
export function ModeTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex gap-1 bg-muted rounded-lg p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              active ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Helpers de exibição ---------------- */
export function StatusTeamBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${
        active ? 'bg-stable/10 text-stable border-stable/20' : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      <span className={`size-1.5 rounded-full ${active ? 'bg-stable' : 'bg-muted-foreground'}`} aria-hidden />
      {active ? 'Ativa' : 'Inativa'}
    </span>
  );
}

/** Dia de monitoramento aproximado (dias desde a alta hospitalar). */
export function monitoringDayFrom(dischargeDate: string | null): number | null {
  if (!dischargeDate) return null;
  const d = new Date(dischargeDate);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return diff < 0 ? null : diff + 1;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ============================ Estado de filtros ============================
   Busca + cards de filtro rápido + filtros avançados compartilham um único
   estado, no mesmo espírito das telas "Alertas" e "Gerenciar Usuários". Os
   cards do topo escrevem em status/patients/alerts; os filtros avançados
   adicionam cirurgião, médico associado e faixa de pacientes. */

export type TeamStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
export type TeamPatientsFilter = 'ALL' | 'WITH' | 'WITHOUT';
export type TeamAlertsFilter = 'ALL' | 'WITH' | 'WITHOUT';
export type TeamPatientCountFilter = 'ALL' | 'ZERO' | '1_5' | '5_PLUS';

export interface TeamFiltersState {
  search: string;
  status: TeamStatusFilter;
  patients: TeamPatientsFilter;
  alerts: TeamAlertsFilter;
  surgeon: string; // 'ALL' | profileId
  associate: string; // 'ALL' | profileId
  patientCount: TeamPatientCountFilter;
}

export const EMPTY_TEAM_FILTERS: TeamFiltersState = {
  search: '', status: 'ALL', patients: 'ALL', alerts: 'ALL', surgeon: 'ALL', associate: 'ALL', patientCount: 'ALL',
};

/** Uma equipe "tem alertas" se há pacientes em alerta vermelho ou alertas não atendidos. */
export function teamHasAlerts(t: TeamDetail): boolean {
  return t.summary.stats.alert > 0 || t.summary.stats.unattendedAlerts > 0;
}

/* ----------------- Cards de filtro rápido (topo) ----------------- */

export type TeamQuickKey = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'WITH_PATIENTS' | 'WITHOUT_PATIENTS' | 'WITH_ALERTS';

const TEAM_QUICK_PRESET: Record<TeamQuickKey, Pick<TeamFiltersState, 'status' | 'patients' | 'alerts'>> = {
  ALL: { status: 'ALL', patients: 'ALL', alerts: 'ALL' },
  ACTIVE: { status: 'ACTIVE', patients: 'ALL', alerts: 'ALL' },
  INACTIVE: { status: 'INACTIVE', patients: 'ALL', alerts: 'ALL' },
  WITH_PATIENTS: { status: 'ALL', patients: 'WITH', alerts: 'ALL' },
  WITHOUT_PATIENTS: { status: 'ALL', patients: 'WITHOUT', alerts: 'ALL' },
  WITH_ALERTS: { status: 'ALL', patients: 'ALL', alerts: 'WITH' },
};

/** Card destacado conforme os filtros atuais (null = combinação avançada). */
export function activeTeamQuickCard(f: TeamFiltersState): TeamQuickKey | null {
  for (const key of Object.keys(TEAM_QUICK_PRESET) as TeamQuickKey[]) {
    const p = TEAM_QUICK_PRESET[key];
    if (f.status === p.status && f.patients === p.patients && f.alerts === p.alerts) return key;
  }
  return null;
}

/** Aplica o preset do card; clicar no card já ativo volta para "Todas". */
export function applyTeamQuickCard(f: TeamFiltersState, key: TeamQuickKey): TeamFiltersState {
  if (activeTeamQuickCard(f) === key) return { ...f, status: 'ALL', patients: 'ALL', alerts: 'ALL' };
  return { ...f, ...TEAM_QUICK_PRESET[key] };
}

type TeamQuickColor = 'primary' | 'stable' | 'muted' | 'alert';
const TEAM_QUICK_COLOR: Record<TeamQuickColor, { icon: string; active: string; num: string }> = {
  primary: { icon: 'bg-primary/10 text-primary', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  stable: { icon: 'bg-stable/10 text-stable', active: 'border-stable ring-1 ring-stable bg-stable/5', num: 'text-stable' },
  muted: { icon: 'bg-muted text-muted-foreground', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  alert: { icon: 'bg-alert/10 text-alert', active: 'border-alert ring-1 ring-alert bg-alert/5', num: 'text-alert' },
};

const TEAM_QUICK_CARDS: Array<{ key: TeamQuickKey; label: string; icon: typeof Users; color: TeamQuickColor }> = [
  { key: 'ALL', label: 'Todas as equipes', icon: Users2, color: 'primary' },
  { key: 'ACTIVE', label: 'Equipes ativas', icon: CheckCircle2, color: 'stable' },
  { key: 'INACTIVE', label: 'Equipes inativas', icon: CircleSlash, color: 'muted' },
  { key: 'WITH_PATIENTS', label: 'Com pacientes', icon: Activity, color: 'primary' },
  { key: 'WITHOUT_PATIENTS', label: 'Sem pacientes', icon: Users, color: 'muted' },
  { key: 'WITH_ALERTS', label: 'Com alertas', icon: BellRing, color: 'alert' },
];

export function TeamQuickFilterCard({ label, value, icon: Icon, color, active, onClick }: {
  label: string; value: number; icon: typeof Users; color: TeamQuickColor; active: boolean; onClick: () => void;
}) {
  const c = TEAM_QUICK_COLOR[color];
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

export function TeamSummaryQuickFilters({ teams, active, onSelect }: {
  teams: TeamDetail[]; active: TeamQuickKey | null; onSelect: (key: TeamQuickKey) => void;
}) {
  const counts: Record<TeamQuickKey, number> = {
    ALL: teams.length,
    ACTIVE: teams.filter((t) => t.summary.status === 'ACTIVE').length,
    INACTIVE: teams.filter((t) => t.summary.status === 'INACTIVE').length,
    WITH_PATIENTS: teams.filter((t) => t.patients.length > 0).length,
    WITHOUT_PATIENTS: teams.filter((t) => t.patients.length === 0).length,
    WITH_ALERTS: teams.filter((t) => teamHasAlerts(t)).length,
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 animate-entry">
      {TEAM_QUICK_CARDS.map((c) => (
        <TeamQuickFilterCard
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

/* ----------------- Resumo geral secundário ----------------- */

export function TeamStatsRow({ mainSurgeons, associatedDoctors, linkedPatients }: {
  mainSurgeons: number; associatedDoctors: number; linkedPatients: number;
}) {
  const items = [
    { label: 'Cirurgiões principais', value: mainSurgeons },
    { label: 'Médicos associados', value: associatedDoctors },
    { label: 'Pacientes vinculados', value: linkedPatients },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm text-sm animate-entry">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Resumo geral</span>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="font-extrabold tracking-tight">{i.value}</span>
          <span className="text-muted-foreground">{i.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ----------------- Barra de busca + botão "Filtros" ----------------- */

/** Conta os filtros avançados ativos (badge do botão "Filtros"). */
export function countTeamAdvancedFilters(f: TeamFiltersState): number {
  let n = 0;
  if (f.surgeon !== 'ALL') n++;
  if (f.associate !== 'ALL') n++;
  if (f.patientCount !== 'ALL') n++;
  return n;
}

export function TeamSearchBar({ search, onSearch, onOpenFilters, activeFilterCount }: {
  search: string;
  onSearch: (v: string) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="flex items-stretch gap-2 animate-entry">
      <div className="relative flex-1">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input pl-9"
          placeholder="Buscar por equipe, cirurgião ou médico..."
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

const PATIENT_COUNT_LABEL: Record<Exclude<TeamPatientCountFilter, 'ALL'>, string> = {
  ZERO: '0 pacientes', '1_5': '1 a 5 pacientes', '5_PLUS': 'Mais de 5 pacientes',
};

function teamChips(f: TeamFiltersState, surgeonName: (id: string) => string, associateName: (id: string) => string): Array<{ key: keyof TeamFiltersState; label: string }> {
  const out: Array<{ key: keyof TeamFiltersState; label: string }> = [];
  if (f.status !== 'ALL') out.push({ key: 'status', label: `Status: ${f.status === 'ACTIVE' ? 'Ativas' : 'Inativas'}` });
  if (f.patients !== 'ALL') out.push({ key: 'patients', label: `Pacientes: ${f.patients === 'WITH' ? 'Com pacientes' : 'Sem pacientes'}` });
  if (f.alerts !== 'ALL') out.push({ key: 'alerts', label: `Alertas: ${f.alerts === 'WITH' ? 'Com alertas' : 'Sem alertas'}` });
  if (f.surgeon !== 'ALL') out.push({ key: 'surgeon', label: `Cirurgião: ${surgeonName(f.surgeon)}` });
  if (f.associate !== 'ALL') out.push({ key: 'associate', label: `Médico: ${associateName(f.associate)}` });
  if (f.patientCount !== 'ALL') out.push({ key: 'patientCount', label: `Qtd.: ${PATIENT_COUNT_LABEL[f.patientCount]}` });
  return out;
}

export function TeamActiveFilterChips({ filters, surgeonOptions, associateOptions, onRemove, onClear }: {
  filters: TeamFiltersState;
  surgeonOptions: Array<{ value: string; label: string }>;
  associateOptions: Array<{ value: string; label: string }>;
  onRemove: (key: keyof TeamFiltersState) => void;
  onClear: () => void;
}) {
  const nameOf = (opts: Array<{ value: string; label: string }>, id: string) => opts.find((o) => o.value === id)?.label ?? id;
  const chips = teamChips(filters, (id) => nameOf(surgeonOptions, id), (id) => nameOf(associateOptions, id));
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

function TeamFilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <select className="input py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function TeamAdvancedFilters({ value, surgeonOptions, associateOptions, onApply, onClose }: {
  value: TeamFiltersState;
  surgeonOptions: Array<{ value: string; label: string }>;
  associateOptions: Array<{ value: string; label: string }>;
  onApply: (next: TeamFiltersState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TeamFiltersState>(value);
  const set = <K extends keyof TeamFiltersState>(k: K, v: TeamFiltersState[K]) => setDraft((d) => ({ ...d, [k]: v }));

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
    setDraft((d) => ({ ...d, status: 'ALL', patients: 'ALL', alerts: 'ALL', surgeon: 'ALL', associate: 'ALL', patientCount: 'ALL' }));
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
          <TeamFilterSelect label="Status da equipe" value={draft.status} onChange={(v) => set('status', v as TeamStatusFilter)}
            options={[{ value: 'ALL', label: 'Todas' }, { value: 'ACTIVE', label: 'Ativas' }, { value: 'INACTIVE', label: 'Inativas' }]} />
          <TeamFilterSelect label="Pacientes" value={draft.patients} onChange={(v) => set('patients', v as TeamPatientsFilter)}
            options={[{ value: 'ALL', label: 'Todas' }, { value: 'WITH', label: 'Com pacientes' }, { value: 'WITHOUT', label: 'Sem pacientes' }]} />
          <TeamFilterSelect label="Alertas" value={draft.alerts} onChange={(v) => set('alerts', v as TeamAlertsFilter)}
            options={[{ value: 'ALL', label: 'Todas' }, { value: 'WITH', label: 'Com pacientes em alerta' }, { value: 'WITHOUT', label: 'Sem alertas ativos' }]} />
          <TeamFilterSelect label="Quantidade de pacientes" value={draft.patientCount} onChange={(v) => set('patientCount', v as TeamPatientCountFilter)}
            options={[{ value: 'ALL', label: 'Todas' }, { value: 'ZERO', label: '0 pacientes' }, { value: '1_5', label: '1 a 5 pacientes' }, { value: '5_PLUS', label: 'Mais de 5 pacientes' }]} />
          <TeamFilterSelect label="Cirurgião principal" value={draft.surgeon} onChange={(v) => set('surgeon', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...surgeonOptions]} />
          <TeamFilterSelect label="Médico associado" value={draft.associate} onChange={(v) => set('associate', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...associateOptions]} />
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={clear}>Limpar filtros</Button>
          <Button onClick={() => { onApply(draft); onClose(); }}>Aplicar filtros</Button>
        </footer>
      </div>
    </div>
  );
}

/* ----------------- Aplicação dos filtros ----------------- */

export function applyTeamFilters(teams: TeamDetail[], f: TeamFiltersState): TeamDetail[] {
  const q = f.search.trim().toLowerCase();
  const qDigits = onlyDigits(f.search);

  return teams.filter((t) => {
    const { summary, members, patients } = t;

    if (q || qDigits) {
      const haystack = [
        String(summary.number),
        `equipe ${pad2(summary.number)}`,
        summary.surgeonName,
        ...members.flatMap((m) => [m.name, m.email]),
      ].join(' ').toLowerCase();
      const matchText = q ? haystack.includes(q) : false;
      const matchPhone = qDigits.length > 0 && members.some((m) => (m.whatsapp ?? '').includes(qDigits));
      if (!matchText && !matchPhone) return false;
    }

    if (f.status !== 'ALL' && summary.status !== f.status) return false;
    if (f.patients === 'WITH' && patients.length === 0) return false;
    if (f.patients === 'WITHOUT' && patients.length > 0) return false;
    if (f.alerts === 'WITH' && !teamHasAlerts(t)) return false;
    if (f.alerts === 'WITHOUT' && teamHasAlerts(t)) return false;
    if (f.surgeon !== 'ALL' && members.find((m) => m.isSurgeon)?.id !== f.surgeon) return false;
    if (f.associate !== 'ALL' && !members.some((m) => !m.isSurgeon && m.id === f.associate)) return false;
    if (f.patientCount === 'ZERO' && patients.length !== 0) return false;
    if (f.patientCount === '1_5' && (patients.length < 1 || patients.length > 5)) return false;
    if (f.patientCount === '5_PLUS' && patients.length <= 5) return false;

    return true;
  });
}
