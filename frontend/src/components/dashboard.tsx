import { Link } from 'react-router-dom';
import { AlertCircle, TrendingUp } from 'lucide-react';
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
import type { CriticalPatient, RecentAlert, WeeklyPoint } from '../lib/dashboard-data';
import { StatusBadge, cn, statusBorder } from './ui';

type IconType = React.ComponentType<{ className?: string }>;

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 12,
};

/* ======================= KPI / metric card ======================= */

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

/* ======================= Gráfico de barras semanal ======================= */

export function WeeklyBarChart({ data, growth }: { data: WeeklyPoint[]; growth: string }) {
  const allZero = data.every((d) => d.count === 0);

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
      {allZero ? (
        <div className="h-56 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <AlertCircle className="size-6 opacity-40" />
          <p className="text-sm">Nenhum registro recebido no período.</p>
          <p className="text-xs">Os registros enviados pelos pacientes aparecerão neste gráfico.</p>
        </div>
      ) : (
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
      )}
    </section>
  );
}

/* ======================= Donut de status clínico (clicável) ======================= */

const DONUT_DATA = (
  stable: number,
  attention: number,
  alert: number,
) => [
  { name: 'Estáveis', value: stable, color: '#22c55e', param: 'stable' },
  { name: 'Atenção', value: attention, color: '#eab308', param: 'attention' },
  { name: 'Alerta', value: alert, color: '#ef4444', param: 'alert' },
];

export function StatusDonutCard({
  stable,
  attention,
  alert,
  onSegmentClick,
}: {
  stable: number;
  attention: number;
  alert: number;
  onSegmentClick?: (param: string) => void;
}) {
  const data = DONUT_DATA(stable, attention, alert);
  const total = stable + attention + alert;

  return (
    <section className="bg-card rounded-xl border border-border shadow-sm p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
        Status Clínico
      </h2>
      {total === 0 ? (
        <div className="h-44 flex flex-col items-center justify-center text-muted-foreground gap-1">
          <p className="text-sm">Sem pacientes em monitoramento.</p>
          <p className="text-xs">Pacientes cadastrados aparecerão aqui.</p>
        </div>
      ) : (
        <>
          <div
            className={cn('h-44', onSegmentClick && 'cursor-pointer')}
            title={onSegmentClick ? 'Clique para ver pacientes desta categoria' : undefined}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                  onClick={onSegmentClick ? (entry) => onSegmentClick?.(entry.param ?? '') : undefined}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {onSegmentClick && (
            <p className="text-[10px] text-center text-muted-foreground mt-1">
              Clique nas fatias para ver os pacientes da categoria.
            </p>
          )}
          <ul className="space-y-2 mt-2">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between text-xs">
                {onSegmentClick ? (
                  <button
                    type="button"
                    onClick={() => onSegmentClick(d.param)}
                    className="flex items-center gap-2 hover:text-foreground transition-colors cursor-pointer"
                    title={`Ver pacientes ${d.name.toLowerCase()}`}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ background: d.color }} />
                    {d.name}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </span>
                )}
                <span className="font-bold font-mono">{d.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ======================= Card horizontal da lista crítica ======================= */

export function PatientCriticalCard({ patient }: { patient: CriticalPatient }) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-l-4 shadow-sm transition-shadow hover:shadow-md',
        statusBorder(patient.status),
      )}
    >
      <div className="flex-1 min-w-0">
        <h3 className="font-bold truncate">{patient.name}</h3>
        <p className="text-xs text-muted-foreground truncate">
          {patient.surgeryType} · D+{patient.postOpDay} pós-op
        </p>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <div className="text-right">
          <p
            className={cn(
              'font-mono font-bold text-sm',
              patient.status === 'RED' ? 'text-alert' : patient.status === 'YELLOW' ? 'text-warning' : 'text-stable',
            )}
          >
            {patient.vitalValue}
          </p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase">{patient.vitalLabel}</p>
        </div>

        <StatusBadge status={patient.status} />

        <Link
          to={`/patients/${patient.id}`}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
          title="Abrir acompanhamento deste paciente"
        >
          Acompanhar
        </Link>
      </div>
    </div>
  );
}

/* ======================= Card de alertas recentes ======================= */

export function AlertListCard({ alerts }: { alerts: RecentAlert[] }) {
  return (
    <section className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Alertas Recentes
        </h2>
        <Link to="/alerts" className="text-xs font-semibold text-primary hover:underline">
          Ver todos
        </Link>
      </div>
      {alerts.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          <p className="text-sm font-medium">Nenhum alerta não atendido.</p>
          <p className="text-xs mt-1">
            Alertas atendidos deixam esta lista e ficam registrados em Meus Atendimentos.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((a) => (
            <li key={a.id} className={cn('px-4 py-3 flex gap-3', a.severity === 'RED' && 'bg-alert/5')}>
              <span
                className={cn(
                  'size-2 mt-1.5 rounded-full shrink-0',
                  a.severity === 'RED' ? 'bg-alert pulse-alert' : 'bg-warning',
                )}
                aria-hidden
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
      )}
    </section>
  );
}
