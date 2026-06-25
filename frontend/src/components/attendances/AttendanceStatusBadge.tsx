import type { AttendanceStatus } from '../../services/attendanceService';
import { cn } from '../ui';

const STATE_META: Record<AttendanceStatus, { label: string; cls: string }> = {
  ATTENDED: {
    label: 'Atendido',
    cls: 'bg-stable/10 text-stable border border-stable/20',
  },
  IGNORED: {
    label: 'Finalizado',
    cls: 'bg-muted text-muted-foreground border border-border',
  },
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const meta = STATE_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}
