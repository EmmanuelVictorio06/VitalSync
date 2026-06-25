import { Bell, Stethoscope } from 'lucide-react';
import type { AttendanceOrigin } from '../../services/attendanceService';
import { cn } from '../ui';

const ORIGIN_META: Record<
  AttendanceOrigin,
  { label: string; icon: typeof Bell; cls: string }
> = {
  ALERT: {
    label: 'Alerta clínico',
    icon: Bell,
    cls: 'bg-warning/10 text-warning border border-warning/20',
  },
  MANUAL_REVIEW: {
    label: 'Acompanhamento manual',
    icon: Stethoscope,
    cls: 'bg-primary/10 text-primary border border-primary/20',
  },
};

export function AttendanceOriginBadge({ origin }: { origin: AttendanceOrigin }) {
  const meta = ORIGIN_META[origin];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        meta.cls,
      )}
    >
      <Icon className="size-3" /> {meta.label}
    </span>
  );
}
