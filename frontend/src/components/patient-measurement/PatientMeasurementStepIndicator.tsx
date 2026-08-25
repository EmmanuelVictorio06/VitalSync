/**
 * Indicador de progresso do wizard de medição (4 etapas).
 *
 * - Desktop (sm+): bolinhas numeradas + labels + conectores, em linha.
 * - Mobile: versão compacta — "Etapa X de 4" + label da etapa atual + bolinhas.
 *
 * Estados: concluída (verde com check), atual (azul com anel), futura (cinza).
 */
import { Check } from 'lucide-react';
import { cn } from '../ui';
import { STEP_COUNT, STEP_LABELS, type MeasurementStep } from './types';

const STEPS: MeasurementStep[] = [1, 2, 3, 4];

export function PatientMeasurementStepIndicator({ current }: { current: MeasurementStep }) {
  return (
    <div className="select-none" aria-label="Progresso da medição">
      {/* Versão completa (desktop) */}
      <div className="hidden sm:flex items-center justify-center gap-1.5">
        {STEPS.map((n, i) => (
          <div key={n} className="flex items-center gap-1.5">
            <Dot n={n} current={current} withLabel />
            {i < STEP_COUNT - 1 && <Connector done={n < current} />}
          </div>
        ))}
      </div>

      {/* Versão compacta (mobile) */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Etapa {current} de {STEP_COUNT}
            </p>
            <p className="text-sm font-extrabold tracking-tight text-foreground truncate">
              {STEP_LABELS[current]}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {STEPS.map((n) => (
              <Dot key={n} n={n} current={current} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({
  n,
  current,
  withLabel = false,
  compact = false,
}: {
  n: MeasurementStep;
  current: MeasurementStep;
  withLabel?: boolean;
  compact?: boolean;
}) {
  const done = n < current;
  const active = n === current;
  return (
    <div className={cn('flex items-center gap-1.5', compact && 'gap-0')}>
      <span
        className={cn(
          compact ? 'size-7' : 'size-8',
          'rounded-full grid place-items-center text-sm font-bold transition-colors',
          done && 'bg-stable text-stable-foreground',
          active && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
          !done && !active && 'bg-muted text-muted-foreground',
        )}
        aria-current={active ? 'step' : undefined}
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      {withLabel && (
        <span className={cn('text-xs font-bold tracking-tight', active ? 'text-foreground' : 'text-muted-foreground')}>
          {STEP_LABELS[n]}
        </span>
      )}
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return <span className={cn('h-px w-5 transition-colors', done ? 'bg-stable' : 'bg-border')} aria-hidden="true" />;
}
