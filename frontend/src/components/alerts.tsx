/**
 * Componentes da aba "Alertas" — central de acompanhamento clínico.
 *
 * Apresentação + ações; os dados e o disparo das RPCs ficam na AlertsPage.
 * O escopo por perfil é garantido pelo Supabase (RLS); aqui só adaptamos a UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Droplets,
  Eye,
  FileText,
  MessageCircle,
  Search,
  Send,
  SlidersHorizontal,
  Stethoscope,
  Thermometer,
  Undo2,
  Users,
  Wind,
  X,
} from 'lucide-react';
import { Period, calculateAge, formatCivilDate, whatsappLink } from '@vitalsync/shared';
import type { AttendanceStatus, AttendanceConfirmation, NotificationLog } from '../services/types';
import type { AlertRow, AlertSummary, TeamProfessional } from '../services/alertService';
import { alertService } from '../services/alertService';
import { storageService } from '../services/storageService';
import { Button, Field, Loading, StatusBadge, cn } from './ui';

/* ============================ Helpers ============================ */

const ATT_META: Record<AttendanceStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Pendente', cls: 'bg-warning/10 text-warning border border-warning/20' },
  IN_ANALYSIS: { label: 'Em análise', cls: 'bg-primary/10 text-primary border border-primary/20' },
  ATTENDED: { label: 'Atendido', cls: 'bg-stable/10 text-stable border border-stable/20' },
  IGNORED: { label: 'Ignorado', cls: 'bg-muted text-muted-foreground border border-border' },
};

export function AttendanceStatusBadge({ status, label }: { status: AttendanceStatus; label?: string }) {
  const meta = ATT_META[status] ?? ATT_META.PENDING;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider', meta.cls)}>
      {label ?? meta.label}
    </span>
  );
}

/** Rótulo do badge de atendimento: em análise mostra QUEM travou o alerta. */
export function attendanceBadgeLabel(a: AlertRow): string | undefined {
  if (a.attendance_status === 'IN_ANALYSIS' && a.in_analysis_by_name) {
    return `Em análise por ${a.in_analysis_by_name}`;
  }
  return undefined;
}

/** Tooltip exibido quando o alerta está travado por outro profissional. */
export const LOCK_TOOLTIP =
  'Somente o profissional que colocou este alerta em análise pode atendê-lo ou ignorá-lo. O Cirurgião Principal da equipe pode usar "Liberar" para devolvê-lo à fila.';

const fmtDate = (v: string | null | undefined) => (v ? formatCivilDate(v) : '—');
const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('pt-BR') : '—');

/** Valor que disparou o alerta (a partir do registro de sinais). */
function triggerValue(a: AlertRow): string {
  const r = a.vital_record;
  if (!r) return '—';
  switch (a.type) {
    case 'Temperatura': return r.temperature != null ? `${r.temperature}°C` : '—';
    case 'Saturação': return r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—';
    case 'Dor': return r.pain_level != null ? `${r.pain_level}/10` : '—';
    case 'Sangramento': return r.has_bleeding ? 'Presente' : '—';
    default: return '—';
  }
}

/** Regra clínica aplicada (texto curto e didático). */
function clinicalRule(a: AlertRow): string {
  switch (a.type) {
    case 'Temperatura': return a.status === 'RED' ? 'Temperatura ≥ 38,5 °C' : 'Temperatura ≥ 37,8 °C';
    case 'Saturação': return a.status === 'RED' ? 'Saturação < 92%' : 'Saturação < 94%';
    case 'Dor': return a.status === 'RED' ? 'Dor ≥ 8/10' : 'Dor ≥ 5/10';
    case 'Sangramento': return 'Sangramento relatado';
    default: return 'Conjunto de sinais limítrofes';
  }
}

const teamLabel = (n: number | null | undefined) => (n != null ? `Equipe ${String(n).padStart(2, '0')}` : '—');

/** Resumo seguro (sem dados sensíveis demais) para a área de transferência. */
export function alertSummaryText(a: AlertRow): string {
  const first = (a.patient?.name ?? '—').split(' ')[0];
  return [
    `VitalSync — Alerta ${a.status === 'RED' ? 'VERMELHO' : 'AMARELO'}`,
    `Paciente: ${first}`,
    `Alteração: ${a.type ?? '—'} (${triggerValue(a)})`,
    a.vital_record?.period ? `Período: ${a.vital_record.period === Period.MORNING ? 'Manhã' : 'Noite'}` : null,
    a.vital_record?.monitoring_day ? `Monitoramento: D+${a.vital_record.monitoring_day}` : null,
    `Equipe: ${a.team?.team_number != null ? String(a.team.team_number).padStart(2, '0') : '—'}`,
    `Atendimento: ${ATT_META[a.attendance_status].label}`,
  ].filter(Boolean).join('\n');
}

/* ======================= Quick filter cards (topo) ======================= */
// Os cards do topo são atalhos de filtro: escrevem em severity + attendance.
// Um card por vez fica ativo; clicar no ativo volta para a "fila ativa" padrão.

export type QuickKey = 'ALL' | 'RED' | 'YELLOW' | 'IN_ANALYSIS' | 'ATTENDED';

const QUICK_PRESET: Record<QuickKey, Pick<AlertFiltersState, 'severity' | 'attendance'>> = {
  ALL: { severity: 'ALL', attendance: 'ALL' },
  RED: { severity: 'RED', attendance: 'ALL' },
  YELLOW: { severity: 'YELLOW', attendance: 'ALL' },
  IN_ANALYSIS: { severity: 'ALL', attendance: 'IN_ANALYSIS' },
  ATTENDED: { severity: 'ALL', attendance: 'ATTENDED' },
};

/** Card destacado conforme os filtros atuais (null = fila ativa padrão ou combinação avançada). */
export function activeQuickCard(f: AlertFiltersState): QuickKey | null {
  for (const key of Object.keys(QUICK_PRESET) as QuickKey[]) {
    const p = QUICK_PRESET[key];
    if (f.severity === p.severity && f.attendance === p.attendance) return key;
  }
  return null;
}

/** Aplica o preset do card; se já estava ativo, volta para a fila ativa (não atendidos). */
export function applyQuickCard(f: AlertFiltersState, key: QuickKey): AlertFiltersState {
  if (activeQuickCard(f) === key) return { ...f, severity: 'ALL', attendance: 'ACTIVE' };
  return { ...f, ...QUICK_PRESET[key] };
}

type QuickColor = 'primary' | 'alert' | 'warning' | 'stable';
const QUICK_COLOR: Record<QuickColor, { icon: string; active: string; num: string }> = {
  primary: { icon: 'bg-primary/10 text-primary', active: 'border-primary ring-1 ring-primary bg-primary/5', num: 'text-primary' },
  alert: { icon: 'bg-alert/10 text-alert', active: 'border-alert ring-1 ring-alert bg-alert/5', num: 'text-alert' },
  warning: { icon: 'bg-warning/10 text-warning', active: 'border-warning ring-1 ring-warning bg-warning/5', num: 'text-warning' },
  stable: { icon: 'bg-stable/10 text-stable', active: 'border-stable ring-1 ring-stable bg-stable/5', num: 'text-stable' },
};

const QUICK_CARDS: Array<{ key: QuickKey; label: string; icon: typeof Bell; color: QuickColor }> = [
  { key: 'ALL', label: 'Todos os alertas', icon: Bell, color: 'primary' },
  { key: 'RED', label: 'Vermelhos', icon: AlertCircle, color: 'alert' },
  { key: 'YELLOW', label: 'Amarelos', icon: AlertTriangle, color: 'warning' },
  { key: 'IN_ANALYSIS', label: 'Em análise', icon: Activity, color: 'primary' },
  { key: 'ATTENDED', label: 'Atendidos', icon: CheckCircle2, color: 'stable' },
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

export function AlertQuickFilters({ summary, active, onSelect }: {
  summary: AlertSummary; active: QuickKey | null; onSelect: (key: QuickKey) => void;
}) {
  const counts: Record<QuickKey, number> = {
    ALL: summary.total, RED: summary.red, YELLOW: summary.yellow,
    IN_ANALYSIS: summary.inAnalysis, ATTENDED: summary.attended,
  };
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 animate-entry">
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

export interface AlertFiltersState {
  search: string;
  severity: 'ALL' | 'RED' | 'YELLOW';
  /** 'ACTIVE' (padrão) esconde Atendido/Ignorado; 'ALL' mostra tudo. */
  attendance: 'ALL' | 'ACTIVE' | AttendanceStatus;
  period: 'ALL' | 'TODAY' | '7D' | '30D';
  signal: string; // 'ALL' | label
  measurement: 'ALL' | 'MORNING' | 'NIGHT';
  team: string; // 'ALL' | teamNumber as string (só Admin)
}

// Por padrão a lista mostra só os ATIVOS (não atendidos). Os atendidos/ignorados
// somem e voltam ao escolher "Atendido"/"Todos" no filtro ou ao buscar por nome.
export const EMPTY_FILTERS: AlertFiltersState = {
  search: '', severity: 'ALL', attendance: 'ACTIVE', period: 'ALL', signal: 'ALL', measurement: 'ALL', team: 'ALL',
};

const SIGNAL_OPTIONS = ['Temperatura', 'Saturação', 'Pressão', 'Frequência Cardíaca', 'Dor', 'Dispneia', 'Diurese', 'Vômitos', 'Sangramento', 'Passos'];

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

/** Conta os filtros avançados ativos (para o badge do botão "Filtros"). */
export function countAdvancedFilters(f: AlertFiltersState): number {
  let n = 0;
  if (f.period !== 'ALL') n++;
  if (f.signal !== 'ALL') n++;
  if (f.measurement !== 'ALL') n++;
  if (f.team !== 'ALL') n++;
  return n;
}

/** Barra enxuta sempre visível: busca por paciente + botão "Filtros" (abre o sheet). */
export function AlertSearchBar({ search, onSearch, onOpenFilters, activeFilterCount }: {
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
          placeholder="Buscar por nome do paciente..."
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

/** Filtros avançados — bottom sheet no mobile, modal centralizado no desktop. */
export function AlertFiltersSheet({ value, onApply, onClose, isAdmin, teamOptions }: {
  value: AlertFiltersState;
  onApply: (next: AlertFiltersState) => void;
  onClose: () => void;
  isAdmin: boolean;
  teamOptions: Array<{ value: string; label: string }>;
}) {
  const [draft, setDraft] = useState<AlertFiltersState>(value);
  const set = <K extends keyof AlertFiltersState>(k: K, v: AlertFiltersState[K]) => setDraft((d) => ({ ...d, [k]: v }));
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
    setDraft((d) => ({ ...d, severity: 'ALL', attendance: 'ACTIVE', period: 'ALL', signal: 'ALL', measurement: 'ALL', team: 'ALL' }));
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
          <Sel label="Status do alerta" value={draft.severity} onChange={(v) => set('severity', v as AlertFiltersState['severity'])}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'RED', label: 'Alerta' }, { value: 'YELLOW', label: 'Atenção' }]} />
          <Sel label="Atendimento" value={draft.attendance} onChange={(v) => set('attendance', v as AlertFiltersState['attendance'])}
            options={[{ value: 'ACTIVE', label: 'Ativos (não atendidos)' }, { value: 'PENDING', label: 'Pendente' }, { value: 'IN_ANALYSIS', label: 'Em análise' }, { value: 'ATTENDED', label: 'Atendido' }, { value: 'IGNORED', label: 'Ignorado' }, { value: 'ALL', label: 'Todos' }]} />
          <Sel label="Período" value={draft.period} onChange={(v) => set('period', v as AlertFiltersState['period'])}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'TODAY', label: 'Hoje' }, { value: '7D', label: 'Últimos 7 dias' }, { value: '30D', label: 'Últimos 30 dias' }]} />
          <Sel label="Sinal vital" value={draft.signal} onChange={(v) => set('signal', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...SIGNAL_OPTIONS.map((s) => ({ value: s, label: s }))]} />
          <Sel label="Medição" value={draft.measurement} onChange={(v) => set('measurement', v as AlertFiltersState['measurement'])}
            options={[{ value: 'ALL', label: 'Ambos' }, { value: 'MORNING', label: 'Manhã' }, { value: 'NIGHT', label: 'Noite' }]} />
          {isAdmin && (
            <Sel label="Equipe" value={draft.team} onChange={(v) => set('team', v)}
              options={[{ value: 'ALL', label: 'Todas' }, ...teamOptions]} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={clear}>Limpar filtros</Button>
          <Button onClick={() => { onApply(draft); onClose(); }}>Aplicar filtros</Button>
        </footer>
      </div>
    </div>
  );
}

function isResolved(a: AlertRow): boolean {
  return a.attendance_status === 'ATTENDED' || a.attendance_status === 'IGNORED';
}

/** Aplica os filtros sobre a lista carregada (RLS já limitou o escopo). */
export function applyAlertFilters(alerts: AlertRow[], f: AlertFiltersState): AlertRow[] {
  const now = Date.now();
  const within: Record<string, number> = { TODAY: 1, '7D': 7, '30D': 30 };
  const searching = f.search.trim().length > 0;
  return alerts.filter((a) => {
    if (searching && !(a.patient?.name ?? '').toLowerCase().includes(f.search.trim().toLowerCase())) return false;
    // Atendimento: 'ACTIVE' esconde resolvidos — exceto durante uma busca por nome,
    // que revela também os atendidos/ignorados daquele paciente.
    if (f.attendance === 'ACTIVE') {
      if (isResolved(a) && !searching) return false;
    } else if (f.attendance !== 'ALL' && a.attendance_status !== f.attendance) {
      return false;
    }
    if (f.severity !== 'ALL' && a.status !== f.severity) return false;
    if (f.signal !== 'ALL' && (a.type ?? '').toLowerCase() !== f.signal.toLowerCase()) return false;
    if (f.measurement !== 'ALL' && a.vital_record?.period !== f.measurement) return false;
    if (f.team !== 'ALL' && String(a.team?.team_number ?? '') !== f.team) return false;
    if (f.period !== 'ALL') {
      const days = within[f.period] ?? 0;
      const ageMs = now - new Date(a.created_at).getTime();
      if (days > 0 && ageMs > days * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });
}

/** Ordena: não resolvidos primeiro; vermelhos antes de amarelos; mais recentes no topo. */
export function sortAlerts(alerts: AlertRow[]): AlertRow[] {
  const sev: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
  return [...alerts].sort((a, b) => {
    const ra = isResolved(a) ? 1 : 0;
    const rb = isResolved(b) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const sa = sev[a.status] ?? 3;
    const sb = sev[b.status] ?? 3;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/* ============================ Alert card ============================ */

export function AlertCard({ alert, canAttend, lockedByOther, canRelease, onDetails, onInAnalysis, onAttend, onRelease }: {
  alert: AlertRow;
  canAttend: boolean;
  /** Alerta travado por outro profissional (usuário não é dono do lock, Admin nem Cirurgião Principal). */
  lockedByOther: boolean;
  /** Pode liberar o alerta de volta à fila (dono do lock, Admin ou Cirurgião Principal). */
  canRelease: boolean;
  onDetails: () => void;
  onInAnalysis: () => void;
  onAttend: () => void;
  onRelease: () => void;
}) {
  const resolved = alert.attendance_status === 'ATTENDED' || alert.attendance_status === 'IGNORED';
  return (
    <li
      className={cn(
        'bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 animate-entry',
        alert.status === 'RED' ? 'border-l-alert' : 'border-l-warning',
        resolved && 'opacity-75',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className={cn('size-2.5 rounded-full mt-1.5 shrink-0', alert.status === 'RED' ? 'bg-alert pulse-alert' : 'bg-warning')} />
        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn('truncate', alert.status === 'RED' ? 'font-extrabold' : 'font-bold')}>{alert.patient?.name ?? '—'}</p>
            <StatusBadge status={alert.status} />
            <AttendanceStatusBadge status={alert.attendance_status} label={attendanceBadgeLabel(alert)} />
          </div>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <Meta label="Alteração" value={`${alert.type ?? '—'} · ${triggerValue(alert)}`} />
            <Meta label="Período" value={alert.vital_record?.period ? (alert.vital_record.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'} />
            <Meta label="Monitoramento" value={alert.vital_record?.monitoring_day ? `D+${alert.vital_record.monitoring_day}` : '—'} />
            <Meta label="Equipe" value={teamLabel(alert.team?.team_number)} />
            <Meta label="Cirurgião" value={alert.surgeon_name ?? '—'} />
            <Meta label="Quando" value={fmtDateTime(alert.created_at)} />
            {alert.attended_by_name && <Meta label="Atendido por" value={alert.attended_by_name} />}
            {alert.attended_at && <Meta label="Em" value={fmtDateTime(alert.attended_at)} />}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
        <Button size="sm" variant="ghost" onClick={onDetails}><Eye className="size-3.5" /> Ver detalhes</Button>
        {canAttend && !resolved && (
          <>
            {alert.attendance_status === 'PENDING' && (
              <Button size="sm" variant="secondary" onClick={onInAnalysis}><Activity className="size-3.5" /> Em análise</Button>
            )}
            <Button
              size="sm"
              variant="success"
              onClick={onAttend}
              disabled={lockedByOther}
              title={lockedByOther ? LOCK_TOOLTIP : undefined}
            >
              <CheckCircle2 className="size-3.5" /> Atender
            </Button>
          </>
        )}
        {canRelease && !resolved && (
          <Button size="sm" variant="ghost" onClick={onRelease} title="Devolve o alerta para a fila de pendentes.">
            <Undo2 className="size-3.5" /> Liberar
          </Button>
        )}
      </div>
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

/* ============================ Details drawer ============================ */

const SIGNAL_ICON: Record<string, typeof Bell> = {
  Temperatura: Thermometer, Saturação: Wind, Dor: AlertCircle, Sangramento: Droplets,
};

export function AlertDetailsDrawer({ alert, perms, onClose, onAction, onAttend, onIgnore, onRelease }: {
  alert: AlertRow;
  perms: { canAttend: boolean; canResend: boolean; lockedByOther: boolean; canRelease: boolean };
  onClose: () => void;
  onAction: () => void; // recarrega a lista após uma ação
  onAttend: () => void;
  onIgnore: () => void;
  onRelease: () => void;
}) {
  const [timeline, setTimeline] = useState<AttendanceConfirmation[] | null>(null);
  const [logs, setLogs] = useState<NotificationLog[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [drainPhotoUrl, setDrainPhotoUrl] = useState<string | null>(null);
  const [busyResend, setBusyResend] = useState(false);
  const r = alert.vital_record;
  const resolved = alert.attendance_status === 'ATTENDED' || alert.attendance_status === 'IGNORED';
  const TypeIcon = (alert.type && SIGNAL_ICON[alert.type]) || Stethoscope;

  useEffect(() => {
    let active = true;
    Promise.all([alertService.getTimeline(alert.id), alertService.getNotificationLogs(alert.id)])
      .then(([t, l]) => { if (active) { setTimeline(t); setLogs(l); } })
      .catch(() => { if (active) { setTimeline([]); setLogs([]); } });
    if (r?.wound_photo_path) {
      storageService.getPatientPhotoUrl(r.wound_photo_path).then((u) => active && setPhotoUrl(u)).catch(() => {});
    }
    if (r?.drain_photo_path) {
      storageService.getPatientPhotoUrl(r.drain_photo_path).then((u) => active && setDrainPhotoUrl(u)).catch(() => {});
    }
    return () => { active = false; };
  }, [alert.id, r?.wound_photo_path, r?.drain_photo_path]);

  async function copySummary() {
    await navigator.clipboard.writeText(alertSummaryText(alert));
  }
  async function resend() {
    setBusyResend(true);
    try {
      await alertService.resendNotification(alert.id);
      const l = await alertService.getNotificationLogs(alert.id);
      setLogs(l);
      onAction();
    } finally {
      setBusyResend(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex justify-end" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-background w-full max-w-lg h-full overflow-y-auto shadow-xl animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <header className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center gap-3 z-10">
          <span className={cn('size-9 rounded-lg flex items-center justify-center', alert.status === 'RED' ? 'bg-alert/10 text-alert' : 'bg-warning/10 text-warning')}>
            <TypeIcon className="size-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold tracking-tight">Detalhes do Alerta</h2>
            <p className="text-xs text-muted-foreground truncate">{alert.patient?.name ?? '—'}</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* 1. Paciente */}
          <DSection title="Informações do paciente" icon={Users}>
            <DGrid items={[
              ['Nome', alert.patient?.name ?? '—'],
              ['Idade', alert.patient?.birth_date ? `${calculateAge(new Date(alert.patient.birth_date))} anos` : '—'],
              ['Telefone', alert.patient?.phone ?? '—'],
              ['Tipo de cirurgia', alert.patient?.surgery_type?.name ?? '—'],
              ['Data da cirurgia', fmtDate(alert.patient?.surgery_date)],
              ['Data da alta', fmtDate(alert.patient?.hospital_discharge_date)],
              ['Dia de monitoramento', r?.monitoring_day ? `D+${r.monitoring_day}` : '—'],
              ['Equipe', teamLabel(alert.team?.team_number)],
              ['Cirurgião responsável', alert.surgeon_name ?? '—'],
            ]} />
          </DSection>

          {/* 2. Medição */}
          <DSection title="Informações da medição" icon={Activity}>
            <DGrid items={[
              ['Data', fmtDate(r?.record_date)],
              ['Período', r?.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
              ['Temperatura', r?.temperature != null ? `${r.temperature} °C` : '—'],
              ['Saturação', r?.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—'],
              ['Pressão arterial', r?.systolic_pressure != null ? `${r.systolic_pressure}/${r.diastolic_pressure ?? '—'} mmHg` : '—'],
              ['Frequência cardíaca', r?.heart_rate != null ? `${r.heart_rate} bpm` : '—'],
              ['Dor', r?.pain_level != null ? `${r.pain_level}/10` : '—'],
              ['Dispneia', r?.dyspnea_level != null ? `${r.dyspnea_level}/10` : '—'],
              ['Diurese', r?.urination_count != null ? `${r.urination_count}×` : '—'],
              ['Vômitos', r?.vomiting_count != null ? `${r.vomiting_count}×` : '—'],
              ['Sangramento', r?.has_bleeding ? 'Sim' : 'Não'],
              ['Passos', r?.steps != null ? String(r.steps) : '—'],
            ]} />
            {r && (
              <p className="mt-3 text-xs">
                <span className="font-bold">Possui dreno:</span>{' '}
                <span className={r.has_drain ? 'text-primary font-semibold' : 'text-muted-foreground'}>
                  {r.has_drain ? 'Sim' : 'Não'}
                </span>
              </p>
            )}
            {(photoUrl || drainPhotoUrl) && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {photoUrl && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Cicatriz operatória</p>
                    <img src={photoUrl} alt="Foto da cicatriz operatória" className="rounded-lg border border-border max-h-56 w-full object-cover" />
                  </div>
                )}
                {drainPhotoUrl && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Dreno</p>
                    <img src={drainPhotoUrl} alt="Foto do dreno" className="rounded-lg border border-border max-h-56 w-full object-cover" />
                  </div>
                )}
              </div>
            )}
          </DSection>

          {/* 3. Alerta */}
          <DSection title="Informações do alerta" icon={TypeIcon}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <StatusBadge status={alert.status} />
              <AttendanceStatusBadge status={alert.attendance_status} label={attendanceBadgeLabel(alert)} />
            </div>
            <DGrid items={[
              ['Tipo', alert.type ?? '—'],
              ['Valor que disparou', triggerValue(alert)],
              ['Regra clínica', clinicalRule(alert)],
              ['Criado em', fmtDateTime(alert.created_at)],
              ...(alert.attendance_status === 'IN_ANALYSIS' && alert.in_analysis_by_name
                ? [
                    ['Em análise por', alert.in_analysis_by_name] as [string, string],
                    ['Em análise desde', fmtDateTime(alert.in_analysis_at)] as [string, string],
                  ]
                : []),
            ]} />
            <p className="text-sm mt-2">{alert.description}</p>
            {alert.attendance_status === 'IGNORED' && alert.ignored_reason && (
              <p className="text-xs text-muted-foreground mt-2 bg-muted rounded-lg p-2">
                <span className="font-bold uppercase">Justificativa: </span>{alert.ignored_reason}
              </p>
            )}
          </DSection>

          {/* 4. Timeline */}
          <DSection title="Histórico de ações" icon={Clock}>
            <AlertTimeline alert={alert} timeline={timeline} logs={logs} />
          </DSection>

          {/* 5. Logs WhatsApp */}
          <DSection title="Logs de WhatsApp" icon={MessageCircle}>
            <AlertNotificationLogs logs={logs} />
          </DSection>
        </div>

        {/* Ações */}
        <footer className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex flex-wrap gap-2">
          {alert.patient && (
            <Link to={`/patients/${alert.patient.id}`} className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md">
              <Stethoscope className="size-3.5" /> Acompanhar paciente
            </Link>
          )}
          {alert.vital_record && alert.patient && (
            <Link to={`/patients/${alert.patient.id}`} className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md">
              <FileText className="size-3.5" /> Ver registro original
            </Link>
          )}
          {alert.patient?.phone && (
            <a href={whatsappLink(alert.patient.phone, 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.')} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 font-semibold bg-[#25D366] text-white hover:opacity-90 px-3 py-1.5 text-xs rounded-md">
              <MessageCircle className="size-3.5" /> WhatsApp
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={copySummary}><ClipboardCopy className="size-3.5" /> Copiar resumo</Button>
          {perms.canResend && (
            <Button size="sm" variant="ghost" onClick={resend} loading={busyResend}><Send className="size-3.5" /> Reenviar</Button>
          )}
          {perms.canRelease && !resolved && (
            <Button size="sm" variant="ghost" onClick={onRelease} title="Devolve o alerta para a fila de pendentes.">
              <Undo2 className="size-3.5" /> Liberar
            </Button>
          )}
          {perms.canAttend && !resolved && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={onIgnore}
                disabled={perms.lockedByOther}
                title={perms.lockedByOther ? LOCK_TOOLTIP : undefined}
              >
                Ignorar
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={onAttend}
                disabled={perms.lockedByOther}
                title={perms.lockedByOther ? LOCK_TOOLTIP : undefined}
              >
                <CheckCircle2 className="size-3.5" /> Atender
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
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

export function AlertTimeline({ alert, timeline, logs }: {
  alert: AlertRow; timeline: AttendanceConfirmation[] | null; logs: NotificationLog[] | null;
}) {
  const events = useMemo(() => {
    const out: Array<{ at: string; label: string }> = [];
    out.push({ at: alert.created_at, label: `Alerta gerado (${alert.status === 'RED' ? 'vermelho' : 'amarelo'})` });
    // Só conta envios efetivos (ignora SKIPPED_TEST_MODE e pendentes).
    const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ', 'sent', 'delivered', 'logged'];
    const delivered = (logs ?? []).filter((l) => l.sent_at && SENT_STATUSES.includes(l.status));
    const firstSent = delivered[0];
    if (firstSent) {
      out.push({ at: firstSent.sent_at ?? alert.created_at, label: `WhatsApp enviado para a equipe (${delivered.length})` });
    }
    for (const t of timeline ?? []) {
      const label = t.status === 'ATTENDED' ? 'Marcado como atendido'
        : t.status === 'IN_ANALYSIS' ? 'Marcado como em análise'
          : t.status === 'IGNORED' ? 'Alerta ignorado'
            : t.status === 'RELEASED' ? 'Liberado de volta para a fila' : 'Atualização';
      out.push({ at: t.created_at, label: t.observation ? `${label}: ${t.observation}` : label });
    }
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [alert, timeline, logs]);

  if (timeline === null) return <Loading label="Carregando histórico…" />;
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

/* ============================ Notification logs ============================ */

// Aceita o vocabulário novo (maiúsculas, 0010) e o legado (minúsculas).
const LOG_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pendente', cls: 'text-warning' },
  SENT: { label: 'Enviado', cls: 'text-primary' },
  DELIVERED: { label: 'Entregue', cls: 'text-stable' },
  READ: { label: 'Lido', cls: 'text-stable' },
  FAILED: { label: 'Falhou', cls: 'text-alert' },
  SKIPPED_TEST_MODE: { label: 'Bloqueado (teste)', cls: 'text-muted-foreground' },
  // Legado / simulado.
  logged: { label: 'Registrado', cls: 'text-primary' },
  sent: { label: 'Enviado', cls: 'text-primary' },
  delivered: { label: 'Entregue', cls: 'text-stable' },
  failed: { label: 'Falhou', cls: 'text-alert' },
  pending: { label: 'Pendente', cls: 'text-warning' },
};

export function AlertNotificationLogs({ logs }: { logs: NotificationLog[] | null }) {
  if (logs === null) return <Loading label="Carregando notificações…" />;
  if (logs.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma notificação registrada para este alerta.</p>;
  }
  return (
    <ul className="space-y-2">
      {logs.map((l) => {
        const meta = LOG_META[l.status] ?? { label: l.status, cls: 'text-muted-foreground' };
        return (
          <li key={l.id} className="flex items-center gap-3 text-xs border border-border rounded-lg p-2.5">
            <MessageCircle className={cn('size-4 shrink-0', meta.cls)} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{l.recipient_name ?? l.recipient_phone ?? 'Equipe médica'}</p>
              <p className="text-muted-foreground">{fmtDateTime(l.sent_at ?? l.created_at)}</p>
              {l.error_message && <p className="text-alert">{l.error_message}</p>}
            </div>
            <span className={cn('font-bold uppercase', meta.cls)}>{meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ============================ Action modals ============================ */

export function MarkAttendedModal({ alert, onConfirm, onCancel }: {
  alert: AlertRow;
  onConfirm: (professionalId: string | null, observation: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [pros, setPros] = useState<TeamProfessional[]>([]);
  const [professionalId, setProfessionalId] = useState('');
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert.team_id) alertService.getTeamProfessionals(alert.team_id).then(setPros).catch(() => setPros([]));
  }, [alert.team_id]);

  async function confirm() {
    if (!observation.trim()) { setError('Descreva brevemente a conduta ou observação do atendimento.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(professionalId || null, observation.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao registrar o atendimento.');
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Marcar como atendido" onCancel={onCancel}>
      <p className="text-sm text-muted-foreground">Confirme o atendimento clínico deste alerta. A data e a hora são registradas automaticamente.</p>
      <div className="mt-4 space-y-3">
        <Field label="Profissional responsável" hint="Quem realizou o atendimento.">
          <select className="input" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            <option value="">Eu mesmo (usuário atual)</option>
            {pros.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.role === 'MAIN_SURGEON' ? ' · Cirurgião' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Observação do atendimento" required error={error ?? undefined}>
          <textarea
            className="input min-h-24 resize-none"
            placeholder="Descreva brevemente a conduta ou observação do atendimento."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['Paciente orientado via WhatsApp.', 'Sinais revisados, sem necessidade de intervenção no momento.', 'Paciente orientado a procurar atendimento presencial.', 'Cirurgião responsável ciente.'].map((s) => (
            <button key={s} type="button" onClick={() => setObservation(s)} className="text-[11px] px-2 py-1 rounded-full bg-muted hover:bg-accent text-muted-foreground">
              {s}
            </button>
          ))}
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="success" onClick={confirm} loading={busy}><CheckCircle2 className="size-4" /> Confirmar atendimento</Button>
      </ModalFooter>
    </ModalShell>
  );
}

export function IgnoreAlertModal({ onConfirm, onCancel }: {
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!reason.trim()) { setError('A justificativa é obrigatória para ignorar o alerta.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao ignorar o alerta.');
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Ignorar alerta" onCancel={onCancel}>
      <p className="text-sm text-muted-foreground">Ignore apenas se o alerta não exige ação. A justificativa fica registrada no histórico.</p>
      <div className="mt-4">
        <Field label="Justificativa" required error={error ?? undefined}>
          <textarea
            className="input min-h-24 resize-none"
            placeholder="Ex.: valor reavaliado e dentro do esperado para o quadro do paciente."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="danger" onClick={confirm} loading={busy}>Ignorar alerta</Button>
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

export function AlertListSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 border-l-border animate-pulse">
          <div className="flex items-start gap-3">
            <span className="size-2.5 rounded-full bg-muted mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="h-4 w-40 max-w-[60%] bg-muted rounded" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} className="h-3 bg-muted rounded" />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex gap-2">
            <div className="h-7 w-24 bg-muted rounded-md" />
            <div className="h-7 w-20 bg-muted rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry">
      <Bell className="size-8 mx-auto mb-3 opacity-40" />
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-card border border-alert/30 rounded-xl p-12 text-center animate-entry">
      <AlertCircle className="size-8 mx-auto mb-3 text-alert" />
      <p className="font-semibold">Não foi possível carregar os alertas. Tente novamente.</p>
      <div className="mt-4 flex justify-center">
        <Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button>
      </div>
    </div>
  );
}
