import { X } from 'lucide-react';
import type { AttendanceFiltersState } from './types';
import { EMPTY_FILTERS } from './types';

const PERIOD_LABEL: Record<AttendanceFiltersState['period'], string> = {
  ALL: '',
  TODAY: 'Hoje',
  YESTERDAY: 'Ontem',
  '7D': 'Últimos 7 dias',
  '30D': 'Últimos 30 dias',
};

const LEVEL_LABEL: Record<AttendanceFiltersState['level'], string> = {
  ALL: '',
  RED: 'Vermelho',
  YELLOW: 'Amarelo',
  NONE: 'Sem alerta',
};

const STATUS_LABEL: Record<AttendanceFiltersState['status'], string> = {
  ALL: '',
  ATTENDED: 'Atendido',
  IGNORED: 'Finalizado',
};

const ORIGIN_LABEL: Record<AttendanceFiltersState['origin'], string> = {
  ALL: '',
  ALERT: 'Alerta clínico',
  MANUAL_REVIEW: 'Acompanhamento manual',
};

export function AttendanceActiveFilterChips({
  filters,
  onChange,
  teamOptions,
  patientOptions,
}: {
  filters: AttendanceFiltersState;
  onChange: (next: AttendanceFiltersState) => void;
  teamOptions: Array<{ value: string; label: string }>;
  patientOptions: Array<{ value: string; label: string }>;
}) {
  const chips: Array<{ key: keyof AttendanceFiltersState; label: string }> = [];
  if (filters.period !== 'ALL') chips.push({ key: 'period', label: `Período: ${PERIOD_LABEL[filters.period]}` });
  if (filters.status !== 'ALL') chips.push({ key: 'status', label: `Status: ${STATUS_LABEL[filters.status]}` });
  if (filters.origin !== 'ALL') chips.push({ key: 'origin', label: `Origem: ${ORIGIN_LABEL[filters.origin]}` });
  if (filters.level !== 'ALL') chips.push({ key: 'level', label: `Alerta: ${LEVEL_LABEL[filters.level]}` });
  if (filters.signal !== 'ALL') chips.push({ key: 'signal', label: `Sinal: ${filters.signal}` });
  if (filters.team !== 'ALL')
    chips.push({
      key: 'team',
      label: teamOptions.find((t) => t.value === filters.team)?.label ?? `Equipe ${filters.team}`,
    });
  if (filters.patient !== 'ALL')
    chips.push({
      key: 'patient',
      label: `Paciente: ${patientOptions.find((p) => p.value === filters.patient)?.label ?? '—'}`,
    });
  if (filters.surgeryType !== 'ALL') chips.push({ key: 'surgeryType', label: `Cirurgia: ${filters.surgeryType}` });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 animate-entry">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-muted text-xs font-semibold pl-2.5 pr-1 py-1"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onChange({ ...filters, [chip.key]: 'ALL' })}
            className="size-4 rounded-full hover:bg-foreground/10 flex items-center justify-center"
            aria-label={`Remover filtro ${chip.label}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search, quick: filters.quick })}
        className="text-xs font-semibold text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        Limpar todos
      </button>
    </div>
  );
}
