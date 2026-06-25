/**
 * Componentes da aba "Meus Atendimentos" — histórico clínico do profissional.
 *
 * Apresentação + ações leves; os dados e as chamadas ao Supabase ficam na
 * MyAttendancesPage / attendanceService. O escopo por perfil é garantido pela
 * RLS (attendance_rw); aqui só adaptamos a UI e os filtros locais.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  Bell,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  ListChecks,
  MessageCircle,
  MoreVertical,
  Pencil,
  Search,
  SlidersHorizontal,
  Stethoscope,
  Thermometer,
  Users,
  Wind,
  Droplets,
  X,
} from 'lucide-react';
import { Period, calculateAge, formatCivilDate, whatsappLink } from '@vitalsync/shared';
import type { AttendanceConfirmation } from '../services/types';
import type {
  AttendanceOrigin,
  AttendanceRow,
  AttendanceState,
  AttendanceSummary,
} from '../services/attendanceService';
import { attendanceService } from '../services/attendanceService';
import { storageService } from '../services/storageService';
import { Button, Field, Loading, StatusBadge, cn } from './ui';

/* ============================ Helpers ============================ */

const fmtDate = (v: string | null | undefined) => (v ? formatCivilDate(v) : '—');
const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('pt-BR') : '—');

const teamLabel = (n: number | null | undefined) => (n != null ? `Equipe ${String(n).padStart(2, '0')}` : '—');

/** Estado do atendimento (IN_ANALYSIS / ATTENDED / IGNORED). */
const STATE_META: Record<AttendanceState, { label: string; cls: string }> = {
  IN_ANALYSIS: { label: 'Em análise', cls: 'bg-primary/10 text-primary border border-primary/20' },
  ATTENDED: { label: 'Atendido', cls: 'bg-stable/10 text-stable border border-stable/20' },
  IGNORED: { label: 'Ignorado', cls: 'bg-muted text-muted-foreground border border-border' },
};

export function AttendanceStatusBadge({ status }: { status: AttendanceState | null }) {
  const meta = (status && STATE_META[status]) || STATE_META.IN_ANALYSIS;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider', meta.cls)}>
      {meta.label}
    </span>
  );
}

const ORIGIN_META: Record<AttendanceOrigin, { label: string; icon: typeof Bell; cls: string }> = {
  ALERT: { label: 'Alerta clínico', icon: Bell, cls: 'bg-warning/10 text-warning border border-warning/20' },
  MANUAL_REVIEW: { label: 'Acompanhamento manual', icon: Stethoscope, cls: 'bg-primary/10 text-primary border border-primary/20' },
};

export function AttendanceOriginBadge({ origin }: { origin: AttendanceOrigin }) {
  const meta = ORIGIN_META[origin];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.cls)}>
      <Icon className="size-3" /> {meta.label}
    </span>
  );
}

/** Valor que disparou o alerta relacionado (a partir do registro de sinais). */
function triggerValue(row: AttendanceRow): string {
  const r = row.vital_record;
  const type = row.related_vital_sign;
  if (!r || !type) return '—';
  switch (type) {
    case 'Temperatura': return r.temperature != null ? `${r.temperature}°C` : '—';
    case 'Saturação': return r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—';
    case 'Dor': return r.pain_level != null ? `${r.pain_level}/10` : '—';
    case 'Sangramento': return r.has_bleeding ? 'Presente' : '—';
    default: return '—';
  }
}

/** Faixa de referência / regra clínica aplicada (texto curto e didático). */
function clinicalRule(row: AttendanceRow): string {
  const red = row.alert?.status === 'RED';
  switch (row.related_vital_sign) {
    case 'Temperatura': return red ? 'Temperatura ≥ 38,5 °C' : 'Temperatura ≥ 37,8 °C';
    case 'Saturação': return red ? 'Saturação < 92%' : 'Saturação < 94%';
    case 'Dor': return red ? 'Dor ≥ 8/10' : 'Dor ≥ 5/10';
    case 'Sangramento': return 'Sangramento relatado';
    default: return '—';
  }
}

const observationPreview = (row: AttendanceRow): string =>
  row.observation?.trim() ? row.observation.trim() : 'Sem observação registrada.';

/* ======================= Quick filter cards (topo) ======================= */

export type QuickKey = 'ALL' | 'TODAY' | 'IN_ANALYSIS' | 'RESOLVED';

type QuickColor = 'primary' | 'stable';
const QUICK_COLOR: Record<QuickColor, { icon: string; active: string; num: string }> = {
  primary: { icon: 'bg-primary/10 text-primary', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  stable: { icon: 'bg-stable/10 text-stable', active: 'border-stable ring-1 ring-stable bg-stable/5', num: 'text-stable' },
};

// Resumo enxuto: 4 atalhos essenciais. Vermelho/amarelo continuam disponíveis
// nos filtros avançados (Nível do alerta) e na borda lateral de cada card.
const QUICK_CARDS: Array<{ key: QuickKey; label: string; icon: typeof Bell; color: QuickColor }> = [
  { key: 'ALL', label: 'Todos', icon: ClipboardList, color: 'primary' },
  { key: 'TODAY', label: 'Hoje', icon: CalendarCheck, color: 'stable' },
  { key: 'IN_ANALYSIS', label: 'Em análise', icon: Activity, color: 'primary' },
  { key: 'RESOLVED', label: 'Resolvidos', icon: ListChecks, color: 'stable' },
];

function QuickCard({ label, value, icon: Icon, color, active, onClick }: {
  label: string; value: number; icon: typeof Bell; color: QuickColor; active: boolean; onClick: () => void;
}) {
  const c = QUICK_COLOR[color];
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

export function AttendanceQuickFilters({ summary, active, onSelect }: {
  summary: AttendanceSummary; active: QuickKey; onSelect: (key: QuickKey) => void;
}) {
  const counts: Record<QuickKey, number> = {
    ALL: summary.total, TODAY: summary.today, IN_ANALYSIS: summary.inAnalysis,
    RESOLVED: summary.resolved,
  };
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-entry">
      {QUICK_CARDS.map((c) => (
        <QuickCard
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

/* ============================ Filters ============================ */

export interface AttendanceFiltersState {
  search: string;
  /** Card rápido ativo (dimensão própria, aplicada junto com os demais filtros). */
  quick: QuickKey;
  period: 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D';
  status: 'ALL' | AttendanceState;
  origin: 'ALL' | AttendanceOrigin;
  level: 'ALL' | 'RED' | 'YELLOW' | 'NONE';
  signal: string; // 'ALL' | label
  team: string; // 'ALL' | team_number
  patient: string; // 'ALL' | patient id
  surgeryType: string; // 'ALL' | nome do tipo
}

export const EMPTY_FILTERS: AttendanceFiltersState = {
  search: '', quick: 'ALL', period: 'ALL', status: 'ALL', origin: 'ALL',
  level: 'ALL', signal: 'ALL', team: 'ALL', patient: 'ALL', surgeryType: 'ALL',
};

const SIGNAL_OPTIONS = ['Temperatura', 'Saturação', 'Pressão', 'Frequência Cardíaca', 'Dor', 'Dispneia', 'Diurese', 'Vômitos', 'Sangramento', 'Passos'];

/** Aplica o card rápido; clicar no que já estava ativo volta para "Todos". */
export function applyQuickCard(f: AttendanceFiltersState, key: QuickKey): AttendanceFiltersState {
  return { ...f, quick: f.quick === key ? 'ALL' : key };
}

/** Conta os filtros avançados ativos (não inclui busca nem card rápido). */
export function countAdvancedFilters(f: AttendanceFiltersState): number {
  let n = 0;
  if (f.period !== 'ALL') n++;
  if (f.status !== 'ALL') n++;
  if (f.origin !== 'ALL') n++;
  if (f.level !== 'ALL') n++;
  if (f.signal !== 'ALL') n++;
  if (f.team !== 'ALL') n++;
  if (f.patient !== 'ALL') n++;
  if (f.surgeryType !== 'ALL') n++;
  return n;
}

function isToday(iso: string): boolean {
  const d = new Date(iso); const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
function isYesterday(iso: string): boolean {
  const d = new Date(iso); const y = new Date(); y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
}

function matchesQuick(row: AttendanceRow, quick: QuickKey): boolean {
  switch (quick) {
    case 'ALL': return true;
    case 'TODAY': return isToday(row.created_at);
    case 'IN_ANALYSIS': return row.status === 'IN_ANALYSIS';
    case 'RESOLVED': return row.status === 'ATTENDED' || row.status === 'IGNORED';
  }
}

/** Texto pesquisável agregado de um atendimento. */
function searchableText(row: AttendanceRow): string {
  return [
    row.patient?.name,
    teamLabel(row.team?.team_number),
    row.surgeon_name,
    row.professional_name,
    row.observation,
    row.patient?.surgery_type?.name,
    row.patient?.hospital?.name,
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Aplica busca + card rápido + filtros avançados (RLS já limitou o escopo). */
export function applyAttendanceFilters(rows: AttendanceRow[], f: AttendanceFiltersState): AttendanceRow[] {
  const now = Date.now();
  const within: Record<string, number> = { '7D': 7, '30D': 30 };
  const term = f.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (term && !searchableText(row).includes(term)) return false;
    if (!matchesQuick(row, f.quick)) return false;
    if (f.status !== 'ALL' && row.status !== f.status) return false;
    if (f.origin !== 'ALL' && row.origin !== f.origin) return false;
    if (f.level !== 'ALL') {
      if (f.level === 'NONE' ? row.alert != null : row.alert?.status !== f.level) return false;
    }
    if (f.signal !== 'ALL' && (row.related_vital_sign ?? '').toLowerCase() !== f.signal.toLowerCase()) return false;
    if (f.team !== 'ALL' && String(row.team?.team_number ?? '') !== f.team) return false;
    if (f.patient !== 'ALL' && row.patient?.id !== f.patient) return false;
    if (f.surgeryType !== 'ALL' && (row.patient?.surgery_type?.name ?? '') !== f.surgeryType) return false;
    if (f.period !== 'ALL') {
      if (f.period === 'TODAY' && !isToday(row.created_at)) return false;
      if (f.period === 'YESTERDAY' && !isYesterday(row.created_at)) return false;
      const days = within[f.period];
      if (days && now - new Date(row.created_at).getTime() > days * 86_400_000) return false;
    }
    return true;
  });
}

/** Ordena: mais recentes primeiro. */
export function sortAttendances(rows: AttendanceRow[]): AttendanceRow[] {
  return [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/* ----------------------------- Search bar ------------------------------- */

export function AttendanceSearchBar({ search, onSearch, onOpenFilters, activeFilterCount }: {
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
          placeholder="Buscar por paciente..."
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

/* --------------------------- Active filter chips ------------------------ */

const PERIOD_LABEL: Record<AttendanceFiltersState['period'], string> = {
  ALL: '', TODAY: 'Hoje', YESTERDAY: 'Ontem', '7D': 'Últimos 7 dias', '30D': 'Últimos 30 dias',
};
const LEVEL_LABEL: Record<AttendanceFiltersState['level'], string> = {
  ALL: '', RED: 'Vermelho', YELLOW: 'Amarelo', NONE: 'Sem alerta',
};

export function AttendanceActiveFilterChips({ filters, onChange, teamOptions, patientOptions }: {
  filters: AttendanceFiltersState;
  onChange: (next: AttendanceFiltersState) => void;
  teamOptions: Array<{ value: string; label: string }>;
  patientOptions: Array<{ value: string; label: string }>;
}) {
  const chips: Array<{ key: keyof AttendanceFiltersState; label: string }> = [];
  if (filters.period !== 'ALL') chips.push({ key: 'period', label: `Período: ${PERIOD_LABEL[filters.period]}` });
  if (filters.status !== 'ALL') chips.push({ key: 'status', label: `Status: ${STATE_META[filters.status as AttendanceState].label}` });
  if (filters.origin !== 'ALL') chips.push({ key: 'origin', label: `Origem: ${ORIGIN_META[filters.origin as AttendanceOrigin].label}` });
  if (filters.level !== 'ALL') chips.push({ key: 'level', label: `Alerta: ${LEVEL_LABEL[filters.level]}` });
  if (filters.signal !== 'ALL') chips.push({ key: 'signal', label: `Sinal: ${filters.signal}` });
  if (filters.team !== 'ALL') chips.push({ key: 'team', label: teamOptions.find((t) => t.value === filters.team)?.label ?? `Equipe ${filters.team}` });
  if (filters.patient !== 'ALL') chips.push({ key: 'patient', label: `Paciente: ${patientOptions.find((p) => p.value === filters.patient)?.label ?? '—'}` });
  if (filters.surgeryType !== 'ALL') chips.push({ key: 'surgeryType', label: `Cirurgia: ${filters.surgeryType}` });

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 animate-entry">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-full bg-muted text-xs font-semibold pl-2.5 pr-1 py-1">
          {chip.label}
          <button
            type="button"
            onClick={() => onChange({ ...filters, [chip.key]: 'ALL' })}
            className="size-4 rounded-full hover:bg-foreground/10 flex items-center justify-center"
            aria-label={`Remover filtro ${chip.label}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search, quick: filters.quick })}
        className="text-xs font-semibold text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        Limpar todos
      </button>
    </div>
  );
}

/* --------------------------- Advanced filters sheet --------------------- */

function Sel({ label, value, onChange, options }: {
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

export function AttendanceFiltersSheet({ value, onApply, onClose, teamOptions, patientOptions, surgeryTypeOptions }: {
  value: AttendanceFiltersState;
  onApply: (next: AttendanceFiltersState) => void;
  onClose: () => void;
  teamOptions: Array<{ value: string; label: string }>;
  patientOptions: Array<{ value: string; label: string }>;
  surgeryTypeOptions: Array<{ value: string; label: string }>;
}) {
  const [draft, setDraft] = useState<AttendanceFiltersState>(value);
  const set = <K extends keyof AttendanceFiltersState>(k: K, v: AttendanceFiltersState[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const activeCount = countAdvancedFilters(draft);

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
    setDraft((d) => ({
      ...d, period: 'ALL', status: 'ALL', origin: 'ALL', level: 'ALL',
      signal: 'ALL', team: 'ALL', patient: 'ALL', surgeryType: 'ALL',
    }));
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
          <h2 className="font-extrabold tracking-tight flex-1">
            Filtros avançados{activeCount > 0 ? ` · ${activeCount}` : ''}
          </h2>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Sel label="Período" value={draft.period} onChange={(v) => set('period', v as AttendanceFiltersState['period'])}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'TODAY', label: 'Hoje' }, { value: 'YESTERDAY', label: 'Ontem' }, { value: '7D', label: 'Últimos 7 dias' }, { value: '30D', label: 'Últimos 30 dias' }]} />
          <Sel label="Status do atendimento" value={draft.status} onChange={(v) => set('status', v as AttendanceFiltersState['status'])}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'IN_ANALYSIS', label: 'Em análise' }, { value: 'ATTENDED', label: 'Atendido' }, { value: 'IGNORED', label: 'Ignorado com justificativa' }]} />
          <Sel label="Origem do atendimento" value={draft.origin} onChange={(v) => set('origin', v as AttendanceFiltersState['origin'])}
            options={[{ value: 'ALL', label: 'Todas' }, { value: 'ALERT', label: 'Alerta clínico' }, { value: 'MANUAL_REVIEW', label: 'Acompanhamento manual' }]} />
          <Sel label="Nível do alerta" value={draft.level} onChange={(v) => set('level', v as AttendanceFiltersState['level'])}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'RED', label: 'Vermelho' }, { value: 'YELLOW', label: 'Amarelo' }, { value: 'NONE', label: 'Sem alerta' }]} />
          <Sel label="Sinal vital relacionado" value={draft.signal} onChange={(v) => set('signal', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...SIGNAL_OPTIONS.map((s) => ({ value: s, label: s }))]} />
          <Sel label="Equipe" value={draft.team} onChange={(v) => set('team', v)}
            options={[{ value: 'ALL', label: 'Todas' }, ...teamOptions]} />
          <Sel label="Paciente" value={draft.patient} onChange={(v) => set('patient', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...patientOptions]} />
          <Sel label="Tipo de cirurgia" value={draft.surgeryType} onChange={(v) => set('surgeryType', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...surgeryTypeOptions]} />
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={clear}>Limpar filtros</Button>
          <Button onClick={() => { onApply(draft); onClose(); }}>Aplicar filtros</Button>
        </footer>
      </div>
    </div>
  );
}

/* ============================ Attendance card ============================ */

const WHATSAPP_MSG = 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.';

/** Data/hora amigável: "25/06/2026 às 01:02". */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function Initials({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return (
    <span className="size-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">
      {initials}
    </span>
  );
}

/** Borda lateral pelo nível clínico; em análise sinaliza azul (em andamento). */
function clinicalBorder(row: AttendanceRow): string {
  if (row.status === 'IN_ANALYSIS') return 'border-l-primary';
  if (row.clinical_status === 'RED') return 'border-l-alert';
  if (row.clinical_status === 'YELLOW') return 'border-l-warning';
  return 'border-l-stable';
}

/** Menu "Mais opções" (três pontos) com as ações secundárias do atendimento. */
export function AttendanceActionsMenu({ row, canEdit, onFollow, onViewMeasurement, onEditObservation }: {
  row: AttendanceRow;
  canEdit: boolean;
  onFollow: () => void;
  onViewMeasurement: () => void;
  onEditObservation: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={open}
        className="size-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center text-muted-foreground"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 bg-card border border-border rounded-xl shadow-lg p-1 animate-entry">
          <MenuItem icon={Stethoscope} label="Acompanhar paciente" onClick={() => { setOpen(false); onFollow(); }} />
          <MenuItem icon={FileText} label="Ver medição relacionada" disabled={!row.vital_record} onClick={() => { setOpen(false); onViewMeasurement(); }} />
          {row.patient?.phone && (
            <a
              role="menuitem"
              href={whatsappLink(row.patient.phone, WHATSAPP_MSG)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-muted text-left"
            >
              <MessageCircle className="size-4 text-[#25D366]" /> Conversar no WhatsApp
            </a>
          )}
          {canEdit && (
            <MenuItem icon={Pencil} label="Editar observação" onClick={() => { setOpen(false); onEditObservation(); }} />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, disabled }: {
  icon: typeof Bell; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-muted text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon className="size-4 text-muted-foreground" /> {label}
    </button>
  );
}

export function AttendanceCard({ row, canEdit, onDetails, onFollow, onViewMeasurement, onEditObservation, onResolve }: {
  row: AttendanceRow;
  canEdit: boolean;
  onDetails: () => void;
  onFollow: () => void;
  onViewMeasurement: () => void;
  onEditObservation: () => void;
  onResolve: () => void;
}) {
  const canResolve = canEdit && row.status === 'IN_ANALYSIS' && !!row.alert_id;
  return (
    <li className={cn('bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 animate-entry', clinicalBorder(row))}>
      <div className="flex items-start gap-3">
        <Initials name={row.patient?.name ?? '—'} />
        <div className="flex-1 min-w-0">
          {/* Linha principal: paciente + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold truncate">{row.patient?.name ?? '—'}</p>
            <StatusBadge status={row.clinical_status} />
            <AttendanceStatusBadge status={row.status} />
          </div>
          {/* Linha secundária: quando · profissional */}
          <p className="mt-1 text-xs text-muted-foreground truncate">
            {fmtWhen(row.created_at)} · {row.professional_name ?? '—'}
          </p>
          {/* Linha de contexto: equipe · origem */}
          <p className="text-xs text-muted-foreground truncate">
            {teamLabel(row.team?.team_number)} · {ORIGIN_META[row.origin].label}
          </p>
          {/* Observação resumida */}
          <p className="mt-2 text-sm text-foreground/80 line-clamp-2">{observationPreview(row)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <Button size="sm" variant="secondary" onClick={onDetails}><Eye className="size-3.5" /> Ver detalhes</Button>
        {canResolve && (
          <Button size="sm" variant="success" onClick={onResolve}><CheckCircle2 className="size-3.5" /> Resolver</Button>
        )}
        <div className="ml-auto">
          <AttendanceActionsMenu
            row={row}
            canEdit={canEdit}
            onFollow={onFollow}
            onViewMeasurement={onViewMeasurement}
            onEditObservation={onEditObservation}
          />
        </div>
      </div>
    </li>
  );
}

/* ============================ Details drawer ============================ */

const SIGNAL_ICON: Record<string, typeof Bell> = {
  Temperatura: Thermometer, Saturação: Wind, Dor: AlertCircle, Sangramento: Droplets,
};

export function AttendanceDetailsDrawer({ row, canEdit, onClose, onEditObservation, onResolve }: {
  row: AttendanceRow;
  canEdit: boolean;
  onClose: () => void;
  onEditObservation: () => void;
  onResolve: () => void;
}) {
  const [timeline, setTimeline] = useState<AttendanceConfirmation[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [drainPhotoUrl, setDrainPhotoUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const r = row.vital_record;
  const TypeIcon = (row.related_vital_sign && SIGNAL_ICON[row.related_vital_sign]) || Stethoscope;

  useEffect(() => {
    let active = true;
    attendanceService.getTimeline(row).then((t) => active && setTimeline(t)).catch(() => active && setTimeline([]));
    if (r?.wound_photo_path) {
      storageService.getPatientPhotoUrl(r.wound_photo_path).then((u) => active && setPhotoUrl(u)).catch(() => {});
    }
    if (r?.drain_photo_path) {
      storageService.getPatientPhotoUrl(r.drain_photo_path).then((u) => active && setDrainPhotoUrl(u)).catch(() => {});
    }
    return () => { active = false; };
  }, [row, r?.wound_photo_path, r?.drain_photo_path]);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex justify-end" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-background w-full max-w-lg h-full overflow-y-auto shadow-xl animate-entry" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center gap-3 z-10">
          <span className="size-9 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <TypeIcon className="size-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold tracking-tight">Detalhes do Atendimento</h2>
            <p className="text-xs text-muted-foreground truncate">{row.patient?.name ?? '—'}</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* 1. Paciente */}
          <DSection title="Dados do paciente" icon={Users}>
            <DGrid items={[
              ['Nome', row.patient?.name ?? '—'],
              ['Idade', row.patient?.birth_date ? `${calculateAge(new Date(row.patient.birth_date))} anos` : '—'],
              ['Telefone', row.patient?.phone ?? '—'],
              ['Tipo de cirurgia', row.patient?.surgery_type?.name ?? '—'],
              ['Hospital', row.patient?.hospital?.name ?? '—'],
              ['Data da cirurgia', fmtDate(row.patient?.surgery_date)],
              ['Data da alta', fmtDate(row.patient?.hospital_discharge_date)],
              ['Dia de monitoramento', r?.monitoring_day ? `D+${r.monitoring_day}` : '—'],
            ]} />
          </DSection>

          {/* 2. Atendimento */}
          <DSection title="Dados do atendimento" icon={ClipboardList}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <AttendanceStatusBadge status={row.status} />
              <AttendanceOriginBadge origin={row.origin} />
            </div>
            <DGrid items={[
              ['Profissional', row.professional_name ?? '—'],
              ['Perfil', roleLabel(row.professional_role)],
              ['Data/hora', fmtDateTime(row.created_at)],
              ['Equipe', teamLabel(row.team?.team_number)],
              ['Cirurgião responsável', row.surgeon_name ?? '—'],
            ]} />
            <div className="mt-3 bg-muted rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Observação / conduta</p>
              <p className="text-sm">{observationPreview(row)}</p>
            </div>
          </DSection>

          {/* 3. Dados clínicos relacionados */}
          {row.alert && (
            <DSection title="Dados clínicos relacionados" icon={TypeIcon}>
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={row.alert.status} />
              </div>
              <DGrid items={[
                ['Sinal vital', row.related_vital_sign ?? '—'],
                ['Valor registrado', triggerValue(row)],
                ['Faixa de referência', clinicalRule(row)],
                ['Nível do alerta', row.alert.status === 'RED' ? 'Vermelho' : 'Amarelo'],
                ['Período', r?.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
                ['Criado em', fmtDateTime(row.alert.created_at)],
              ]} />
              {row.alert.ignored_reason && (
                <p className="text-xs text-muted-foreground mt-2 bg-muted rounded-lg p-2">
                  <span className="font-bold uppercase">Justificativa: </span>{row.alert.ignored_reason}
                </p>
              )}
            </DSection>
          )}

          {/* 4. Medição completa */}
          {r && (
            <DSection title="Registro da medição" icon={Activity}>
              <DGrid items={[
                ['Data', fmtDate(r.record_date)],
                ['Período', r.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
                ['Temperatura', r.temperature != null ? `${r.temperature} °C` : '—'],
                ['Saturação', r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—'],
                ['Pressão arterial', r.systolic_pressure != null ? `${r.systolic_pressure}/${r.diastolic_pressure ?? '—'} mmHg` : '—'],
                ['Frequência cardíaca', r.heart_rate != null ? `${r.heart_rate} bpm` : '—'],
                ['Dor', r.pain_level != null ? `${r.pain_level}/10` : '—'],
                ['Dispneia', r.dyspnea_level != null ? `${r.dyspnea_level}/10` : '—'],
                ['Diurese', r.urination_count != null ? `${r.urination_count}×` : '—'],
                ['Vômitos', r.vomiting_count != null ? `${r.vomiting_count}×` : '—'],
                ['Sangramento', r.has_bleeding ? 'Sim' : 'Não'],
                ['Passos', r.steps != null ? String(r.steps) : '—'],
              ]} />
              {(photoUrl || drainPhotoUrl) && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {photoUrl && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Cicatriz operatória</p>
                      <button type="button" onClick={() => setZoom(photoUrl)} className="block w-full">
                        <img src={photoUrl} alt="Foto da cicatriz operatória" className="rounded-lg border border-border max-h-56 w-full object-cover" />
                      </button>
                    </div>
                  )}
                  {drainPhotoUrl && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Dreno</p>
                      <button type="button" onClick={() => setZoom(drainPhotoUrl)} className="block w-full">
                        <img src={drainPhotoUrl} alt="Foto do dreno" className="rounded-lg border border-border max-h-56 w-full object-cover" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </DSection>
          )}

          {/* 5. Timeline */}
          <DSection title="Histórico" icon={Clock}>
            <AttendanceTimeline row={row} timeline={timeline} />
          </DSection>
        </div>

        {/* Ações */}
        <footer className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex flex-wrap gap-2">
          {row.patient && (
            <Link to={`/patients/${row.patient.id}`} className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md">
              <Stethoscope className="size-3.5" /> Acompanhar paciente
            </Link>
          )}
          {row.vital_record && row.patient && (
            <Link to={`/patients/${row.patient.id}`} className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md">
              <FileText className="size-3.5" /> Ver medição
            </Link>
          )}
          {row.patient?.phone && (
            <a href={whatsappLink(row.patient.phone, 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.')} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 font-semibold bg-[#25D366] text-white hover:opacity-90 px-3 py-1.5 text-xs rounded-md">
              <MessageCircle className="size-3.5" /> WhatsApp
            </a>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onEditObservation}><Pencil className="size-3.5" /> Editar observação</Button>
          )}
          {canEdit && row.status === 'IN_ANALYSIS' && row.alert_id && (
            <Button size="sm" variant="success" onClick={onResolve}><CheckCircle2 className="size-3.5" /> Marcar como resolvido</Button>
          )}
        </footer>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[70] bg-foreground/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setZoom(null); }}>
          <img src={zoom} alt="Foto ampliada" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function roleLabel(role: AttendanceRow['professional_role']): string {
  switch (role) {
    case 'ADMIN': return 'Administrador';
    case 'MAIN_SURGEON': return 'Cirurgião Principal';
    case 'ASSOCIATED_DOCTOR': return 'Médico Associado';
    default: return '—';
  }
}

function DSection({ title, icon: Icon, children }: { title: string; icon: typeof Bell; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold mb-3">
        <Icon className="size-4 text-primary" /> {title}
      </h3>
      {children}
    </section>
  );
}

function DGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{k}</dt>
          <dd className="font-semibold mt-0.5 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ============================ Timeline ============================ */

export function AttendanceTimeline({ row, timeline }: {
  row: AttendanceRow; timeline: AttendanceConfirmation[] | null;
}) {
  const events = useMemo(() => {
    const out: Array<{ at: string; label: string }> = [];
    if (row.alert) {
      out.push({ at: row.alert.created_at, label: `Alerta gerado (${row.alert.status === 'RED' ? 'vermelho' : 'amarelo'})` });
    }
    for (const t of timeline ?? []) {
      const label = t.status === 'ATTENDED' ? 'Marcado como atendido'
        : t.status === 'IN_ANALYSIS' ? 'Marcado como em análise'
          : t.status === 'IGNORED' ? 'Alerta ignorado' : 'Acompanhamento registrado';
      out.push({ at: t.created_at, label: t.observation ? `${label}: ${t.observation}` : label });
    }
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [row, timeline]);

  if (timeline === null) return <Loading label="Carregando histórico…" />;
  if (events.length === 0) return <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="size-2 rounded-full bg-primary mt-1.5" />
            {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-1">
            <p className="text-sm font-medium leading-snug">{e.label}</p>
            <p className="text-[11px] text-muted-foreground">{fmtDateTime(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ============================ Edit observation modal ============================ */

export function EditAttendanceObservationModal({ row, onConfirm, onCancel }: {
  row: AttendanceRow;
  onConfirm: (observation: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [observation, setObservation] = useState(row.observation ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!observation.trim()) { setError('Descreva a observação ou conduta do atendimento.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(observation.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar a observação.');
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Editar observação" onCancel={onCancel}>
      <p className="text-sm text-muted-foreground">Atualize a conduta ou observação registrada neste atendimento.</p>
      <div className="mt-4">
        <Field label="Observação do atendimento" required error={error ?? undefined}>
          <textarea
            className="input min-h-28 resize-y"
            placeholder="Descreva a conduta ou observação do atendimento."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button onClick={confirm} loading={busy}>Salvar observação</Button>
      </ModalFooter>
    </ModalShell>
  );
}

export function ResolveAttendanceModal({ row, onConfirm, onCancel }: {
  row: AttendanceRow;
  onConfirm: (observation: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [observation, setObservation] = useState(row.observation ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      // "Observação final" é opcional na UI; quando vazia, registramos uma
      // conduta padrão para manter a rastreabilidade do atendimento.
      await onConfirm(observation.trim() || 'Atendimento revisado e resolvido.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao resolver o atendimento.');
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Marcar atendimento como resolvido?" onCancel={onCancel}>
      <p className="text-sm text-muted-foreground">Confirme que a situação deste atendimento foi revisada e resolvida.</p>
      <div className="mt-4">
        <Field label="Observação final" hint="Opcional — descreva a conduta, se desejar." error={error ?? undefined}>
          <textarea
            className="input min-h-24 resize-y"
            placeholder="Ex.: paciente reavaliado e estável; conduta mantida."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="success" onClick={confirm} loading={busy}><CheckCircle2 className="size-4" /> Confirmar resolução</Button>
      </ModalFooter>
    </ModalShell>
  );
}

function ModalShell({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md my-auto max-h-[90vh] overflow-y-auto animate-entry" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold tracking-tight mb-1">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 mt-6">{children}</div>;
}

/* ============================ States ============================ */

export function AttendanceListSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 border-l-border animate-pulse">
          <div className="flex items-start gap-3">
            <span className="size-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="h-4 w-44 max-w-[60%] bg-muted rounded" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                {Array.from({ length: 6 }).map((__, j) => (
                  <div key={j} className="h-3 bg-muted rounded" />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex gap-2">
            <div className="h-7 w-24 bg-muted rounded-md" />
            <div className="h-7 w-24 bg-muted rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AttendanceEmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry">
      <ClipboardList className="size-8 mx-auto mb-3 opacity-40" />
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function AttendanceErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-card border border-alert/30 rounded-xl p-12 text-center animate-entry">
      <AlertCircle className="size-8 mx-auto mb-3 text-alert" />
      <p className="font-semibold">Não foi possível carregar seus atendimentos. Tente novamente.</p>
      <div className="mt-4 flex justify-center">
        <Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button>
      </div>
    </div>
  );
}
