import { Bell, CalendarCheck, ClipboardList, ListChecks } from 'lucide-react';
import type { AttendanceSummary } from '../../services/attendanceService';
import { cn } from '../ui';
import type { QuickKey } from './types';

type QuickColor = 'primary' | 'stable' | 'warning' | 'alert';

const QUICK_COLOR: Record<QuickColor, { icon: string; active: string; num: string }> = {
  primary: {
    icon: 'bg-primary/10 text-primary',
    active: 'border-primary ring-1 ring-primary bg-primary/5',
    num: 'text-primary',
  },
  stable: {
    icon: 'bg-stable/10 text-stable',
    active: 'border-stable ring-1 ring-stable bg-stable/5',
    num: 'text-stable',
  },
  warning: {
    icon: 'bg-warning/10 text-warning',
    active: 'border-warning ring-1 ring-warning bg-warning/5',
    num: 'text-warning',
  },
  alert: {
    icon: 'bg-alert/10 text-alert',
    active: 'border-alert ring-1 ring-alert bg-alert/5',
    num: 'text-alert',
  },
};

const QUICK_CARDS: Array<{
  key: QuickKey;
  label: string;
  shortLabel: string;
  icon: typeof Bell;
  color: QuickColor;
}> = [
  { key: 'ALL', label: 'Todos', shortLabel: 'Todos', icon: ClipboardList, color: 'primary' },
  { key: 'TODAY', label: 'Hoje', shortLabel: 'Hoje', icon: CalendarCheck, color: 'stable' },
  { key: 'RED', label: 'Alertas vermelhos', shortLabel: 'Vermelhos', icon: Bell, color: 'alert' },
  { key: 'YELLOW', label: 'Alertas amarelos', shortLabel: 'Amarelos', icon: ListChecks, color: 'warning' },
];

function SummaryCard({
  label,
  shortLabel,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  shortLabel: string;
  value: number;
  icon: typeof Bell;
  color: QuickColor;
  active: boolean;
  onClick: () => void;
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
        <p
          className={cn(
            'text-xl sm:text-2xl font-extrabold tracking-tight leading-none',
            active && c.num,
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground font-semibold mt-1 truncate">
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </p>
      </div>
    </button>
  );
}

export function AttendanceSummaryCards({
  summary,
  active,
  onSelect,
}: {
  summary: AttendanceSummary;
  active: QuickKey;
  onSelect: (key: QuickKey) => void;
}) {
  const counts: Record<QuickKey, number> = {
    ALL: summary.total,
    TODAY: summary.today,
    RED: summary.red,
    YELLOW: summary.yellow,
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-entry">
      {QUICK_CARDS.map((c) => (
        <SummaryCard
          key={c.key}
          label={c.label}
          shortLabel={c.shortLabel}
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
