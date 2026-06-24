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
  Stethoscope,
  Thermometer,
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

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const meta = ATT_META[status] ?? ATT_META.PENDING;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider', meta.cls)}>
      {meta.label}
    </span>
  );
}

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

/* ============================ Summary cards ============================ */

type Tone = 'info' | 'pending' | 'red' | 'yellow' | 'green';
const TONE: Record<Tone, string> = {
  info: 'bg-primary/10 text-primary',
  pending: 'bg-warning/10 text-warning',
  red: 'bg-alert/10 text-alert',
  yellow: 'bg-warning/10 text-warning',
  green: 'bg-stable/10 text-stable',
};

function SummaryCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone: Tone; icon: typeof Bell }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
      <span className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', TONE[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold tracking-tight leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground font-semibold mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

export function AlertSummaryCards({ summary, role }: { summary: AlertSummary; role: 'ADM' | 'SURGEON' | 'ASSOCIATE' }) {
  const cards: Array<{ label: string; value: number; tone: Tone; icon: typeof Bell }> =
    role === 'ADM'
      ? [
          { label: 'Total de alertas', value: summary.total, tone: 'info', icon: Bell },
          { label: 'Pendentes', value: summary.pending, tone: 'pending', icon: Clock },
          { label: 'Vermelhos', value: summary.red, tone: 'red', icon: AlertCircle },
          { label: 'Amarelos', value: summary.yellow, tone: 'yellow', icon: AlertTriangle },
          { label: 'Atendidos hoje', value: summary.attendedToday, tone: 'green', icon: CheckCircle2 },
          { label: 'Falhas no WhatsApp', value: summary.failedNotifications, tone: 'red', icon: MessageCircle },
        ]
      : role === 'SURGEON'
        ? [
            { label: 'Alertas da minha equipe', value: summary.total, tone: 'info', icon: Bell },
            { label: 'Pendentes', value: summary.pending, tone: 'pending', icon: Clock },
            { label: 'Vermelhos', value: summary.red, tone: 'red', icon: AlertCircle },
            { label: 'Amarelos', value: summary.yellow, tone: 'yellow', icon: AlertTriangle },
            { label: 'Atendidos hoje', value: summary.attendedToday, tone: 'green', icon: CheckCircle2 },
            { label: 'Pacientes com alerta ativo', value: summary.patientsWithActiveAlert, tone: 'info', icon: Users },
          ]
        : [
            { label: 'Alertas das minhas equipes', value: summary.total, tone: 'info', icon: Bell },
            { label: 'Pendentes', value: summary.pending, tone: 'pending', icon: Clock },
            { label: 'Vermelhos', value: summary.red, tone: 'red', icon: AlertCircle },
            { label: 'Amarelos', value: summary.yellow, tone: 'yellow', icon: AlertTriangle },
            { label: 'Em análise', value: summary.inAnalysis, tone: 'info', icon: Activity },
            { label: 'Atendidos hoje', value: summary.attendedToday, tone: 'green', icon: CheckCircle2 },
          ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 animate-entry">
      {cards.map((c) => (
        <SummaryCard key={c.label} {...c} />
      ))}
    </div>
  );
}

/* ============================ Filters ============================ */

export interface AlertFiltersState {
  search: string;
  severity: 'ALL' | 'RED' | 'YELLOW';
  attendance: 'ALL' | AttendanceStatus;
  period: 'ALL' | 'TODAY' | '7D' | '30D';
  signal: string; // 'ALL' | label
  measurement: 'ALL' | 'MORNING' | 'NIGHT';
  team: string; // 'ALL' | teamNumber as string (só Admin)
}

export const EMPTY_FILTERS: AlertFiltersState = {
  search: '', severity: 'ALL', attendance: 'ALL', period: 'ALL', signal: 'ALL', measurement: 'ALL', team: 'ALL',
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

export function AlertFilters({ value, onChange, isAdmin, teamOptions }: {
  value: AlertFiltersState;
  onChange: (next: AlertFiltersState) => void;
  isAdmin: boolean;
  teamOptions: Array<{ value: string; label: string }>;
}) {
  const set = <K extends keyof AlertFiltersState>(k: K, v: AlertFiltersState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3 animate-entry">
      <div className="relative">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input pl-9"
          placeholder="Buscar por nome do paciente…"
          value={value.search}
          onChange={(e) => set('search', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Sel label="Status do alerta" value={value.severity} onChange={(v) => set('severity', v as AlertFiltersState['severity'])}
          options={[{ value: 'ALL', label: 'Todos' }, { value: 'RED', label: 'Alerta' }, { value: 'YELLOW', label: 'Atenção' }]} />
        <Sel label="Atendimento" value={value.attendance} onChange={(v) => set('attendance', v as AlertFiltersState['attendance'])}
          options={[{ value: 'ALL', label: 'Todos' }, { value: 'PENDING', label: 'Pendente' }, { value: 'IN_ANALYSIS', label: 'Em análise' }, { value: 'ATTENDED', label: 'Atendido' }, { value: 'IGNORED', label: 'Ignorado' }]} />
        <Sel label="Período" value={value.period} onChange={(v) => set('period', v as AlertFiltersState['period'])}
          options={[{ value: 'ALL', label: 'Todos' }, { value: 'TODAY', label: 'Hoje' }, { value: '7D', label: 'Últimos 7 dias' }, { value: '30D', label: 'Últimos 30 dias' }]} />
        <Sel label="Sinal vital" value={value.signal} onChange={(v) => set('signal', v)}
          options={[{ value: 'ALL', label: 'Todos' }, ...SIGNAL_OPTIONS.map((s) => ({ value: s, label: s }))]} />
        <Sel label="Medição" value={value.measurement} onChange={(v) => set('measurement', v as AlertFiltersState['measurement'])}
          options={[{ value: 'ALL', label: 'Ambos' }, { value: 'MORNING', label: 'Manhã' }, { value: 'NIGHT', label: 'Noite' }]} />
        {isAdmin && (
          <Sel label="Equipe" value={value.team} onChange={(v) => set('team', v)}
            options={[{ value: 'ALL', label: 'Todas' }, ...teamOptions]} />
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>Limpar filtros</Button>
      </div>
    </div>
  );
}

/** Aplica os filtros sobre a lista carregada (RLS já limitou o escopo). */
export function applyAlertFilters(alerts: AlertRow[], f: AlertFiltersState): AlertRow[] {
  const now = Date.now();
  const within: Record<string, number> = { TODAY: 1, '7D': 7, '30D': 30 };
  return alerts.filter((a) => {
    if (f.search && !(a.patient?.name ?? '').toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.severity !== 'ALL' && a.status !== f.severity) return false;
    if (f.attendance !== 'ALL' && a.attendance_status !== f.attendance) return false;
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

/* ============================ Alert card ============================ */

export function AlertCard({ alert, canAttend, onDetails, onInAnalysis, onAttend }: {
  alert: AlertRow;
  canAttend: boolean;
  onDetails: () => void;
  onInAnalysis: () => void;
  onAttend: () => void;
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
            <AttendanceStatusBadge status={alert.attendance_status} />
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
            <Button size="sm" variant="success" onClick={onAttend}><CheckCircle2 className="size-3.5" /> Atender</Button>
          </>
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

export function AlertDetailsDrawer({ alert, perms, onClose, onAction, onAttend, onIgnore }: {
  alert: AlertRow;
  perms: { canAttend: boolean; canResend: boolean };
  onClose: () => void;
  onAction: () => void; // recarrega a lista após uma ação
  onAttend: () => void;
  onIgnore: () => void;
}) {
  const [timeline, setTimeline] = useState<AttendanceConfirmation[] | null>(null);
  const [logs, setLogs] = useState<NotificationLog[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
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
    return () => { active = false; };
  }, [alert.id, r?.wound_photo_path]);

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
            {photoUrl && (
              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Foto da ferida/dreno</p>
                <img src={photoUrl} alt="Foto enviada pelo paciente" className="rounded-lg border border-border max-h-56 object-cover" />
              </div>
            )}
          </DSection>

          {/* 3. Alerta */}
          <DSection title="Informações do alerta" icon={TypeIcon}>
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={alert.status} />
              <AttendanceStatusBadge status={alert.attendance_status} />
            </div>
            <DGrid items={[
              ['Tipo', alert.type ?? '—'],
              ['Valor que disparou', triggerValue(alert)],
              ['Regra clínica', clinicalRule(alert)],
              ['Criado em', fmtDateTime(alert.created_at)],
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
          {perms.canAttend && !resolved && (
            <>
              <Button size="sm" variant="ghost" onClick={onIgnore}>Ignorar</Button>
              <Button size="sm" variant="success" onClick={onAttend}><CheckCircle2 className="size-3.5" /> Atender</Button>
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
    const sent = (logs ?? []).filter((l) => l.sent_at).length;
    if (sent > 0) out.push({ at: (logs ?? []).find((l) => l.sent_at)?.sent_at ?? alert.created_at, label: `WhatsApp enviado para a equipe (${sent})` });
    for (const t of timeline ?? []) {
      const label = t.status === 'ATTENDED' ? 'Marcado como atendido'
        : t.status === 'IN_ANALYSIS' ? 'Marcado como em análise'
          : t.status === 'IGNORED' ? 'Alerta ignorado' : 'Atualização';
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

const LOG_META: Record<string, { label: string; cls: string }> = {
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
              <p className="font-semibold">{l.recipient_phone ?? 'Equipe médica'}</p>
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
            className="input min-h-24 resize-y"
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
            className="input min-h-24 resize-y"
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
