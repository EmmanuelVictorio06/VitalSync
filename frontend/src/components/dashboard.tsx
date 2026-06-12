/** Componentes reutilizáveis do Painel de Monitoramento. */
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ClinicalStatus } from '@vitalsync/shared';
import type { CriticalPatient, RecentAlert, WeeklyPoint } from '../lib/dashboard-data';
import { StatusBadge, cn, statusBorder } from './ui';

type IconType = React.ComponentType<{ className?: string }>;

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 12,
};

const STATUS_TEXT: Record<ClinicalStatus, string> = {
  GREEN: 'text-stable',
  YELLOW: 'text-warning',
  RED: 'text-alert',
};

/* ---------------- KPI / metric card ---------------- */
export function DashboardMetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: IconType;
  tone: 'primary' | 'stable' | 'warning' | 'alert';
}) {
  const accent = {
    primary: 'border-l-primary',
    stable: 'border-l-stable',
    warning: 'border-l-warning',
    alert: 'border-l-alert',
  }[tone];
  const color = {
    primary: 'text-primary',
    stable: 'text-stable',
    warning: 'text-warning',
    alert: 'text-alert',
  }[tone];
  return (
    <div
      className={cn(
        'bg-card p-4 rounded-xl border border-border shadow-sm border-l-4 transition-shadow hover:shadow-md',
        accent,
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('size-3.5', color)} />
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className={cn('text-2xl md:text-3xl font-extrabold mt-1', color)}>{value}</p>
    </div>
  );
}

/* ---------------- Gráfico de barras semanal ---------------- */
export function WeeklyBarChart({ data, growth }: { data: WeeklyPoint[]; growth: string }) {
  return (
    <section className="bg-card rounded-xl border border-border shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Registros Recebidos
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias</p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-stable font-semibold">
          <TrendingUp className="size-3.5" /> {growth}
        </span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v, 'Registros']} />
            <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ---------------- Donut de status clínico ---------------- */
export function StatusDonutCard({
  stable,
  attention,
  alert,
}: {
  stable: number;
  attention: number;
  alert: number;
}) {
  const data = [
    { name: 'Estáveis', value: stable, color: '#22c55e' },
    { name: 'Atenção', value: attention, color: '#eab308' },
    { name: 'Alerta', value: alert, color: '#ef4444' },
  ];
  return (
    <section className="bg-card rounded-xl border border-border shadow-sm p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
        Status Clínico
      </h2>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-2 mt-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="font-bold font-mono">{d.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Card horizontal da lista crítica ---------------- */
export function PatientCriticalCard({ patient }: { patient: CriticalPatient }) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-4 flex items-center gap-4 border-l-4 shadow-sm transition-shadow hover:shadow-md',
        statusBorder(patient.status),
      )}
    >
      <div className="flex-1 min-w-0">
        <h3 className="font-bold truncate">{patient.name}</h3>
        <p className="text-xs text-muted-foreground truncate">
          {patient.surgeryType} · D+{patient.postOpDay} pós-op
        </p>
      </div>
      <div className="text-right hidden sm:block">
        <p className={cn('font-mono font-bold text-sm', STATUS_TEXT[patient.status])}>
          {patient.vitalValue}
        </p>
        <p className="text-[10px] font-bold text-muted-foreground uppercase">{patient.vitalLabel}</p>
      </div>
      <StatusBadge status={patient.status} />
      {/* Dados mock — quando integrado, apontar para /patients/{id} */}
      <Link
        to="/monitoring"
        className="px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-muted hidden md:inline-block"
      >
        Acompanhar
      </Link>
    </div>
  );
}

/* ---------------- Card de alertas recentes ---------------- */
export function AlertListCard({ alerts }: { alerts: RecentAlert[] }) {
  return (
    <section className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Alertas Recentes
        </h2>
        <Link to="/alerts" className="text-xs font-semibold text-primary hover:underline">
          Ver
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {alerts.map((a) => (
          <li key={a.id} className={cn('p-4 flex gap-3', a.severity === 'RED' && 'bg-alert/5')}>
            <span
              className={cn(
                'size-2 mt-1.5 rounded-full shrink-0',
                a.severity === 'RED' ? 'bg-alert pulse-alert' : 'bg-warning',
              )}
            />
            <div className="min-w-0">
              <p className={cn('text-xs truncate', a.severity === 'RED' ? 'font-extrabold' : 'font-bold')}>
                {a.patientName}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{a.datetime}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Atalho rápido ---------------- */
export function QuickActionCard({ to, label, icon: Icon }: { to: string; label: string; icon: IconType }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 text-sm font-medium hover:border-primary hover:bg-accent transition-colors"
    >
      <Icon className="size-4 text-primary" />
      {label}
      <ArrowRight className="size-4 ml-auto text-muted-foreground" />
    </Link>
  );
}
