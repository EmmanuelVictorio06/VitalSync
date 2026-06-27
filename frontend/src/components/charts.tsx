import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ClinicalStatus } from '@vitalsync/shared';
import { StatusBadge } from './ui';

const STATUS_COLOR: Record<ClinicalStatus, string> = {
  GREEN: '#22c55e',
  YELLOW: '#eab308',
  RED: '#ef4444',
};
const PRIMARY = '#2563eb';

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 12,
};

export interface DayPoint {
  day: number;
  value: number | null;
  status?: ClinicalStatus;
}

type IconType = React.ComponentType<{ className?: string }>;

/** Cartão padrão de gráfico, com ícone, título, unidade e badge de status geral. */
function ChartCard({
  title,
  unit,
  status,
  icon: Icon,
  children,
  pending,
}: {
  title: string;
  unit?: string;
  status?: ClinicalStatus;
  icon?: IconType;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold leading-none truncate">{title}</h3>
            {unit && <p className="text-[10px] text-muted-foreground mt-1 truncate">{unit}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pending && (
            <span
              className="text-[10px] font-bold uppercase text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-full"
              title="Valores pendentes de confirmação médica"
            >
              ⚠ a confirmar
            </span>
          )}
          {status && <StatusBadge status={status} showDot={false} />}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Gráfico de linha (temperatura, saturação, frequência cardíaca). */
export function VitalLineChart({
  title,
  unit,
  data,
  domain,
  status,
  pending,
  icon,
}: {
  title: string;
  unit?: string;
  data: DayPoint[];
  domain: [number, number];
  status?: ClinicalStatus;
  pending?: boolean;
  icon?: IconType;
}) {
  return (
    <ChartCard title={title} unit={unit} status={status} pending={pending} icon={icon}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d) => `${d}`} fontSize={10} stroke="#94a3b8" tickLine={false} axisLine={false} />
          <YAxis domain={domain} fontSize={10} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} ${unit ?? ''}`, title]} labelFormatter={(d) => `Dia ${d}`} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2.5}
            connectNulls
            dot={(props: { cx?: number; cy?: number; payload?: DayPoint; index?: number }) => {
              const { cx, cy, payload, index } = props;
              const key = `dot-${payload?.day ?? index}`;
              if (cx == null || cy == null || payload?.value == null) return <g key={key} />;
              return <circle key={key} cx={cx} cy={cy} r={4} fill={STATUS_COLOR[payload.status ?? ClinicalStatus.GREEN]} stroke="#fff" strokeWidth={1.5} />;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Pressão arterial — barras empilhadas (diastólica embaixo, sistólica em cima). */
export function BloodPressureChart({
  data,
  status,
  pending,
  icon,
}: {
  data: Array<{ day: number; systolic: number | null; diastolic: number | null; status?: ClinicalStatus }>;
  status?: ClinicalStatus;
  pending?: boolean;
  icon?: IconType;
}) {
  const chartData = data.map((d) => ({
    day: d.day,
    diastolic: d.diastolic ?? 0,
    delta: d.systolic != null && d.diastolic != null ? Math.max(0, d.systolic - d.diastolic) : 0,
    systolic: d.systolic,
    status: d.status,
  }));
  return (
    <ChartCard title="Pressão arterial" unit="mmHg (sistólica/diastólica)" status={status} pending={pending} icon={icon}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" fontSize={10} stroke="#94a3b8" tickLine={false} axisLine={false} />
          <YAxis domain={[40, 200]} ticks={[40, 80, 120, 160, 200]} fontSize={10} stroke="#94a3b8" tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(_v, _n, item) => {
              const p = item.payload as { systolic: number | null; diastolic: number };
              return [`${p.systolic ?? '-'} / ${p.diastolic} mmHg`, 'PA'];
            }}
            labelFormatter={(d) => `Dia ${d}`}
          />
          <Bar dataKey="diastolic" stackId="bp" fill="#93c5fd" radius={[0, 0, 4, 4]} />
          <Bar dataKey="delta" stackId="bp" radius={[4, 4, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={STATUS_COLOR[d.status ?? ClinicalStatus.GREEN]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Número de passos — gráfico de barras. */
export function StepsBarChart({ data, status, icon }: { data: DayPoint[]; status?: ClinicalStatus; icon?: IconType }) {
  return (
    <ChartCard title="Número de passos" unit="passos/dia (noite)" status={status} icon={icon}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" fontSize={10} stroke="#94a3b8" tickLine={false} axisLine={false} />
          <YAxis fontSize={10} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} passos`, 'Passos']} labelFormatter={(d) => `Dia ${d}`} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={STATUS_COLOR[d.status ?? ClinicalStatus.GREEN]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Mostrador simples (diurese, vômitos, sangramento). */
export function IndicatorCard({
  title,
  valueText,
  status,
  detail,
  icon: Icon,
}: {
  title: string;
  valueText: string;
  status: ClinicalStatus;
  detail?: string;
  icon?: IconType;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="size-4" />
            </span>
          )}
          <h3 className="text-sm font-bold truncate">{title}</h3>
        </div>
        <StatusBadge status={status} showDot={false} />
      </div>
      <p className="text-2xl font-bold mt-2">{valueText}</p>
      {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
    </div>
  );
}

/** Escala 0–10 (dor / dispneia) com barra de progresso colorida. */
export function ScaleIndicatorCard({
  title,
  value,
  status,
  icon: Icon,
}: {
  title: string;
  value: number;
  status: ClinicalStatus;
  icon?: IconType;
}) {
  const pct = (value / 10) * 100;
  const color =
    status === ClinicalStatus.RED ? 'bg-alert' : status === ClinicalStatus.YELLOW ? 'bg-warning' : 'bg-stable';
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="size-4" />
            </span>
          )}
          <h3 className="text-sm font-bold truncate">{title}</h3>
        </div>
        <StatusBadge status={status} showDot={false} />
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-3xl font-extrabold font-mono">{value}</span>
        <span className="text-xs text-muted-foreground">/ 10</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground font-semibold">
        <span>SEM</span>
        <span>INTENSO</span>
      </div>
    </div>
  );
}
