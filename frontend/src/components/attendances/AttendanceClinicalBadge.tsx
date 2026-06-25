import type { ClinicalStatus } from '../../services/types';
import { cn } from '../ui';

const CLINICAL_META: Record<ClinicalStatus, { label: string; cls: string; dot: string }> = {
  GREEN: {
    label: 'Estável',
    cls: 'bg-stable/10 text-stable border border-stable/20',
    dot: 'bg-stable',
  },
  YELLOW: {
    label: 'Atenção',
    cls: 'bg-warning/10 text-warning border border-warning/20',
    dot: 'bg-warning',
  },
  RED: {
    label: 'Alerta',
    cls: 'bg-alert/10 text-alert border border-alert/20',
    dot: 'bg-alert',
  },
};

export function AttendanceClinicalBadge({ status }: { status: ClinicalStatus }) {
  const meta = CLINICAL_META[status] ?? CLINICAL_META.GREEN;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        meta.cls,
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}
