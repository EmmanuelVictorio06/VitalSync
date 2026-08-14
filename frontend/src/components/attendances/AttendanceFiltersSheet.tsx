import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, ModalOverlay, cn } from '../ui';
import type { AttendanceFiltersState } from './types';
import { SIGNAL_OPTIONS } from './types';
import { countAdvancedFilters } from './utils';

function Sel({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </span>
      <select className="input py-2 text-sm w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AttendanceFiltersSheet({
  value,
  onApply,
  onClose,
  teamOptions,
  patientOptions,
  surgeryTypeOptions,
}: {
  value: AttendanceFiltersState;
  onApply: (next: AttendanceFiltersState) => void;
  onClose: () => void;
  teamOptions: Array<{ value: string; label: string }>;
  patientOptions: Array<{ value: string; label: string }>;
  surgeryTypeOptions: Array<{ value: string; label: string }>;
}) {
  const [draft, setDraft] = useState<AttendanceFiltersState>(value);
  const set = <K extends keyof AttendanceFiltersState>(k: K, v: AttendanceFiltersState[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const activeCount = countAdvancedFilters(draft);

  // ESC e trava de scroll são do ModalOverlay.

  function clear() {
    setDraft((d) => ({
      ...d,
      period: 'ALL',
      status: 'ALL',
      origin: 'ALL',
      level: 'ALL',
      signal: 'ALL',
      team: 'ALL',
      patient: 'ALL',
      surgeryType: 'ALL',
    }));
  }

  return (
    <ModalOverlay
      onClose={onClose}
      className="z-50 bg-foreground/50 backdrop-blur-sm items-end sm:items-center justify-center sm:p-4"
      ariaLabel="Filtros avançados"
    >
      <div
        className={cn(
          'bg-card border border-border w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col',
          'animate-entry',
        )}
      >
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-extrabold tracking-tight flex-1">
            Filtros avançados{activeCount > 0 ? ` · ${activeCount}` : ''}
          </h2>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Sel
            label="Período"
            value={draft.period}
            onChange={(v) => set('period', v as AttendanceFiltersState['period'])}
            options={[
              { value: 'ALL', label: 'Todos' },
              { value: 'TODAY', label: 'Hoje' },
              { value: 'YESTERDAY', label: 'Ontem' },
              { value: '7D', label: 'Últimos 7 dias' },
              { value: '30D', label: 'Últimos 30 dias' },
            ]}
          />
          <Sel
            label="Status do atendimento"
            value={draft.status}
            onChange={(v) => set('status', v as AttendanceFiltersState['status'])}
            options={[
              { value: 'ALL', label: 'Todos' },
              { value: 'ATTENDED', label: 'Atendido' },
              { value: 'IGNORED', label: 'Finalizado com justificativa' },
            ]}
          />
          <Sel
            label="Origem do atendimento"
            value={draft.origin}
            onChange={(v) => set('origin', v as AttendanceFiltersState['origin'])}
            options={[
              { value: 'ALL', label: 'Todas' },
              { value: 'ALERT', label: 'Alerta clínico' },
              { value: 'MANUAL_REVIEW', label: 'Acompanhamento manual' },
            ]}
          />
          <Sel
            label="Nível do alerta"
            value={draft.level}
            onChange={(v) => set('level', v as AttendanceFiltersState['level'])}
            options={[
              { value: 'ALL', label: 'Todos' },
              { value: 'RED', label: 'Vermelho' },
              { value: 'YELLOW', label: 'Amarelo' },
              { value: 'NONE', label: 'Sem alerta' },
            ]}
          />
          <Sel
            label="Sinal vital relacionado"
            value={draft.signal}
            onChange={(v) => set('signal', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...SIGNAL_OPTIONS.map((s) => ({ value: s, label: s }))]}
          />
          <Sel
            label="Equipe"
            value={draft.team}
            onChange={(v) => set('team', v)}
            options={[{ value: 'ALL', label: 'Todas' }, ...teamOptions]}
          />
          <Sel
            label="Paciente"
            value={draft.patient}
            onChange={(v) => set('patient', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...patientOptions]}
          />
          <Sel
            label="Tipo de cirurgia"
            value={draft.surgeryType}
            onChange={(v) => set('surgeryType', v)}
            options={[{ value: 'ALL', label: 'Todos' }, ...surgeryTypeOptions]}
          />
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={clear}>
            Limpar filtros
          </Button>
          <Button onClick={() => { onApply(draft); onClose(); }}>Aplicar filtros</Button>
        </footer>
      </div>
    </ModalOverlay>
  );
}
