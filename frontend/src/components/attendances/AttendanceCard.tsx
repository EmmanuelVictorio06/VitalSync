import { Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AttendanceRow } from '../../services/attendanceService';
import { cn } from '../ui';
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

/** Cor base (CSS var) para o brilho lateral, conforme o status clínico. */
function clinicalGlowVar(row: AttendanceRow): string {
  if (row.clinical_status === 'RED') return 'var(--color-alert)';
  if (row.clinical_status === 'YELLOW') return 'var(--color-warning)';
  return 'var(--color-stable)';
}

export function AttendanceCard({ row, onDetails }: { row: AttendanceRow; onDetails: () => void }) {
  const patientId = row.patient?.id;
  const to = patientId ? `/patients/${patientId}` : '#';

  return (
    <li>
      <div
        className={cn(
          'relative overflow-hidden bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 animate-entry cursor-pointer',
          'transition-shadow duration-200',
          'hover:shadow-md',
          'active:shadow-sm',
          clinicalBorder(row),
        )}
      >
        {/* Brilho suave concentrado na lateral esquerda — sempre visível */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-24"
          style={{ background: `linear-gradient(to right, ${clinicalGlowVar(row)}26, transparent)` }}
          aria-hidden="true"
        />

        <div className="relative flex items-start gap-3">
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

        {/* Botão "Ver detalhes" — abre o drawer; z-10 acima do link esticado */}
        <div className="relative mt-3 pt-3 border-t border-border flex sm:justify-end">
          <button
            type="button"
            onClick={onDetails}
            className={cn(
              'relative z-10',
              'flex items-center justify-center gap-1.5 w-full sm:w-auto',
              'text-sm font-semibold rounded-lg px-4 py-2.5',
              'bg-primary/10 text-primary border border-primary/20',
              'hover:bg-primary/15 active:bg-primary/20 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            )}
          >
            <Eye className="size-3.5" /> Ver detalhes
          </button>
        </div>

        {/* Link esticado sobre o card: clicar em qualquer lugar navega para o paciente */}
        <Link
          to={to}
          className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl"
          aria-label={`Abrir acompanhamento de ${row.patient?.name ?? 'paciente'}`}
        />
      </div>
    </li>
  );
}
