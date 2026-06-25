import { Eye } from 'lucide-react';
import type { AttendanceRow } from '../../services/attendanceService';
import { Button, cn } from '../ui';
import { AttendanceActionsMenu } from './AttendanceActionsMenu';
import { AttendanceClinicalBadge } from './AttendanceClinicalBadge';
import { AttendanceOriginBadge } from './AttendanceOriginBadge';
import { AttendanceStatusBadge } from './AttendanceStatusBadge';
import { fmtWhen, observationPreview, teamLabel } from './utils';

function Initials({ name }: { name: string }) {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <span className="size-10 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">
      {initials}
    </span>
  );
}

/** Borda lateral pelo nível clínico original do alerta atendido. */
function clinicalBorder(row: AttendanceRow): string {
  if (row.clinical_status === 'RED') return 'border-l-alert';
  if (row.clinical_status === 'YELLOW') return 'border-l-warning';
  return 'border-l-stable';
}

export function AttendanceCard({
  row,
  canEdit,
  onDetails,
  onFollow,
  onViewMeasurement,
  onViewAlert,
  onEditObservation,
}: {
  row: AttendanceRow;
  canEdit: boolean;
  onDetails: () => void;
  onFollow: () => void;
  onViewMeasurement: () => void;
  onViewAlert: () => void;
  onEditObservation: () => void;
}) {
  return (
    <li
      className={cn(
        'bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 animate-entry',
        clinicalBorder(row),
      )}
    >
      <div className="flex items-start gap-3">
        <Initials name={row.patient?.name ?? '—'} />
        <div className="flex-1 min-w-0">
          {/* Linha principal: paciente + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold truncate">{row.patient?.name ?? '—'}</p>
            <AttendanceClinicalBadge status={row.clinical_status} />
            <AttendanceStatusBadge status={row.status} />
          </div>
          {/* Linha secundária: quando · profissional */}
          <p className="mt-1 text-xs text-muted-foreground truncate">
            {fmtWhen(row.created_at)} · {row.professional_name ?? '—'}
          </p>
          {/* Linha de contexto: equipe · origem */}
          <p className="text-xs text-muted-foreground truncate">
            {teamLabel(row.team?.team_number)} · <span className="inline sm:hidden">{row.origin === 'ALERT' ? 'Alerta clínico' : 'Acompanhamento manual'}</span>
            <span className="hidden sm:inline"><AttendanceOriginBadge origin={row.origin} /></span>
          </p>
          {/* Observação resumida */}
          <p className="mt-2 text-sm text-foreground/80 line-clamp-2">{observationPreview(row)}</p>
        </div>
      </div>

      {/* Ações: mobile first */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 pt-3 border-t border-border">
        <Button
          size="sm"
          variant="secondary"
          onClick={onDetails}
          className="w-full sm:w-auto"
        >
          <Eye className="size-3.5" /> Ver detalhes
        </Button>
        <div className="flex justify-end sm:ml-auto">
          <AttendanceActionsMenu
            row={row}
            canEdit={canEdit}
            onFollow={onFollow}
            onViewMeasurement={onViewMeasurement}
            onViewAlert={onViewAlert}
            onEditObservation={onEditObservation}
          />
        </div>
      </div>
    </li>
  );
}
