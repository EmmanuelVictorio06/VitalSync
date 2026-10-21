import { User, Users } from 'lucide-react';
import type { AttendanceScope } from '../../services/attendanceService';
import { cn } from '../ui';

/**
 * Recorte da aba "Meus Atendimentos": só os meus (padrão) ou os da equipe.
 *
 * Não é um filtro da lista já carregada — trocar aqui refaz a busca com outro
 * escopo, para os cards do topo contarem o mesmo conjunto que a lista mostra.
 * `teamLabel` muda porque, para o Admin, "da equipe" é na prática "todos".
 */
export function AttendanceScopeToggle({
  value,
  onChange,
  teamLabel = 'Da equipe',
  disabled,
}: {
  value: AttendanceScope;
  onChange: (scope: AttendanceScope) => void;
  teamLabel?: string;
  disabled?: boolean;
}) {
  const options: Array<{ key: AttendanceScope; label: string; icon: typeof User }> = [
    { key: 'MINE', label: 'Meus', icon: User },
    { key: 'TEAM', label: teamLabel, icon: Users },
  ];

  return (
    <div
      role="group"
      aria-label="Escopo dos atendimentos"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              disabled && 'opacity-55 cursor-not-allowed',
            )}
          >
            <Icon className="size-4" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
