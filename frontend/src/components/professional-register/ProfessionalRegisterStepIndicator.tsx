/**
 * Indicador de progresso do wizard de cadastro de profissional.
 *
 * - Desktop (sm+): bolinhas numeradas + labels + conectores, em linha.
 * - Mobile: versão compacta — "Etapa X de 3" + label da etapa atual + bolinhas.
 *
 * Estados da bolinha:
 *   • concluída (etapa < atual): verde com ícone de check.
 *   • atual (etapa === atual): azul (primary), com anel suave.
 *   • futura (etapa > atual): cinza (muted).
 */
import { Check } from 'lucide-react';
import { cn } from '../ui';
import { STEP_COUNT, STEP_LABELS, type Step } from './types';

export function ProfessionalRegisterStepIndicator({ current }: { current: Step }) {
  const steps: Step[] = [1, 2, 3];

  return (
    <div className="select-none" aria-label="Progresso do cadastro">
      {/* Versão completa (desktop) */}
      <div className="hidden sm:flex items-center justify-center gap-2">
        {steps.map((n, i) => (
          <div key={n} className="flex items-center gap-2">
            <Dot n={n} current={current} withLabel />
            {i < STEP_COUNT - 1 && <Connector done={n < current} />}
          </div>
        ))}
      </div>

      {/* Versão compacta (mobile) */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Etapa {current} de {STEP_COUNT}
            </p>
            <p className="text-sm font-extrabold tracking-tight text-foreground">
              {STEP_LABELS[current]}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((n) => (
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
  n: Step;
  current: Step;
  withLabel?: boolean;
  compact?: boolean;
}) {
  const done = n < current;
  const active = n === current;
  return (
    <div className={cn('flex items-center gap-2', compact && 'gap-0')}>
      <span
        className={cn(
          'size-8 rounded-full grid place-items-center text-sm font-bold transition-colors',
          done && 'bg-stable text-white',
          active && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
          !done && !active && 'bg-muted text-muted-foreground',
        )}
        aria-current={active ? 'step' : undefined}
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      {withLabel && (
        <span
          className={cn(
            'text-xs font-bold tracking-tight',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {STEP_LABELS[n]}
        </span>
      )}
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        'h-px w-6 sm:w-8 transition-colors',
        done ? 'bg-stable' : 'bg-border',
      )}
      aria-hidden="true"
    />
  );
}
