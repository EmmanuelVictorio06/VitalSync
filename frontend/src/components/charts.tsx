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
  GREEN: '#16a34a',
  YELLOW: '#d97706',
  RED: '#dc2626',
};
const PRIMARY = '#0f766e';

export interface DayPoint {
  day: number;
  value: number | null;
  status?: ClinicalStatus;
}

/** Cartão padrão de gráfico, com título, unidade e badge de status geral. */
function ChartCard({
  title,
  unit,
  status,
  children,
  pending,
}: {
  title: string;
  unit?: string;
  status?: ClinicalStatus;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div className="card-title">{title}</div>
          {unit && <span className="muted" style={{ fontSize: '.85rem' }}>{unit}</span>}
        </div>
        <span className="spacer" />
        {pending && <span className="pending-flag" title="Valores pendentes de confirmação médica">⚠ a confirmar</span>}
        {status && <StatusBadge status={status} />}
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
}: {
  title: string;
  unit?: string;
  data: DayPoint[];
  domain: [number, number];
  status?: ClinicalStatus;
  pending?: boolean;
}) {
  return (
    <ChartCard title={title} unit={unit} status={status} pending={pending}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="day" tickFormatter={(d) => `${d}`} fontSize={12} />
          <YAxis domain={domain} fontSize={12} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} ${unit ?? ''}`, title]} labelFormatter={(d) => `Dia ${d}`} />
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
              return <circle key={key} cx={cx} cy={cy} r={5} fill={STATUS_COLOR[payload.status ?? ClinicalStatus.GREEN]} stroke="#fff" strokeWidth={1.5} />;
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
}: {
  data: Array<{ day: number; systolic: number | null; diastolic: number | null; status?: ClinicalStatus }>;
  status?: ClinicalStatus;
  pending?: boolean;
}) {
  const chartData = data.map((d) => ({
    day: d.day,
    diastolic: d.diastolic ?? 0,
    delta: d.systolic != null && d.diastolic != null ? Math.max(0, d.systolic - d.diastolic) : 0,
    systolic: d.systolic,
    status: d.status,
  }));
  return (
    <ChartCard title="Pressão arterial" unit="mmHg (sistólica/diastólica)" status={status} pending={pending}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="day" fontSize={12} />
          <YAxis domain={[40, 200]} ticks={[40, 60, 80, 100, 120, 140, 160, 180, 200]} fontSize={12} />
          <Tooltip
            formatter={(_v, _n, item) => {
              const p = item.payload as { systolic: number | null; diastolic: number };
              return [`${p.systolic ?? '-'} / ${p.diastolic} mmHg`, 'PA'];
            }}
            labelFormatter={(d) => `Dia ${d}`}
          />
          <Bar dataKey="diastolic" stackId="bp" fill="#94a3b8" radius={[0, 0, 4, 4]} />
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
export function StepsBarChart({ data, status }: { data: DayPoint[]; status?: ClinicalStatus }) {
  return (
    <ChartCard title="Número de passos" unit="passos/dia (noite)" status={status}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="day" fontSize={12} />
          <YAxis fontSize={12} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} passos`, 'Passos']} labelFormatter={(d) => `Dia ${d}`} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={STATUS_COLOR[d.status ?? ClinicalStatus.GREEN]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Mostrador simples (diurese, vômitos, sangramento, dor, dispneia). */
export function IndicatorCard({
  title,
  valueText,
  status,
  detail,
}: {
  title: string;
  valueText: string;
  status: ClinicalStatus;
  detail?: string;
}) {
  return (
    <div className="card">
      <div className="block-title">{title}</div>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong style={{ fontSize: '1.3rem' }}>{valueText}</strong>
        <span className="spacer" />
        <StatusBadge status={status} />
      </div>
      {detail && <div className="muted" style={{ fontSize: '.82rem', marginTop: 6 }}>{detail}</div>}
    </div>
  );
}
