/**
 * MonitoringStreak — faixa dos 10 dias de monitoramento, no topo da aba
 * "Visão geral" do Acompanhamento Individual.
 *
 * Cada dia traz a sigla do dia da semana, a data e DOIS sub-indicadores
 * independentes: manhã (sol) e noite (lua). A cor de cada um é a severidade da
 * medição daquele período — o mesmo `overallStatus` que os cards exibem, com o
 * mesmo `statusFill`/`statusLabel` de `ui.tsx`. Não há régua de cor nova aqui.
 *
 * Toda a regra (datas, estado de cada período, adesão) vem de
 * `lib/monitoringCalendar.ts`; este arquivo é só apresentação, no mesmo
 * invólucro de card do resto da tela (`bg-card border border-border rounded-xl
 * shadow-sm p-4`).
 */
import { Lock, Moon, Sun } from 'lucide-react';
import { ClinicalStatus, formatCivilDate } from '@vitalsync/shared';
import {
  adherenceFromCalendar,
  dayMonth,
  weekdayAbbr,
  type CalendarDay,
  type CalendarSlot,
} from '../lib/monitoringCalendar';
import { cn, statusFill, statusLabel, statusSolid } from './ui';

export function MonitoringStreak({ days }: { days: CalendarDay[] }) {
  if (days.length === 0) return null;
  const { done, due, percent } = adherenceFromCalendar(days);

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-4 min-w-0">
      <header className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-none">Adesão ao monitoramento</h3>
          <p className="text-[10px] text-muted-foreground mt-1">10 dias · manhã e noite</p>
        </div>
        <p className="text-sm font-extrabold tabular-nums shrink-0">
          {due === 0 ? (
            <span className="text-muted-foreground">Nenhuma medição vencida ainda</span>
          ) : (
            <>
              {done} de {due} medições{' '}
              <span className="text-muted-foreground font-bold">({percent}%)</span>
            </>
          )}
        </p>
      </header>

      {/* Rola no mobile em vez de espremer as 10 células. */}
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <DayCell key={d.day} day={d} />
        ))}
      </ol>

      <Legend />
    </section>
  );
}

function DayCell({ day }: { day: CalendarDay }) {
  const dataCompleta = formatCivilDate(day.date);
  return (
    <li
      title={`Dia ${day.day} de monitoramento · ${dataCompleta}`}
      className={cn(
        'flex-1 min-w-16 rounded-lg border p-1.5 text-center',
        day.isToday ? 'border-primary bg-primary/5' : 'border-border',
        day.isFuture && 'opacity-50',
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {weekdayAbbr(day.date)}
      </p>
      <p className="text-[11px] font-bold tabular-nums leading-tight">{dayMonth(day.date)}</p>
      <div className="flex items-center justify-center gap-1 mt-1.5">
        <SlotDot slot={day.morning} />
        <SlotDot slot={day.night} />
      </div>
      <p className="text-[9px] text-muted-foreground mt-1 tabular-nums">D{day.day}</p>
    </li>
  );
}

/** Rótulo de acessibilidade/tooltip de um sub-indicador. */
function slotTitle(slot: CalendarSlot): string {
  const turno = slot.period === 'MORNING' ? 'Manhã' : 'Noite';
  if (slot.state === 'REGISTERED') return `${turno}: ${statusLabel(slot.status ?? ClinicalStatus.GREEN)}`;
  if (slot.state === 'MISSED') return `${turno}: sem registro`;
  if (slot.state === 'WAITING') return `${turno}: aguardando`;
  return `${turno}: ainda não liberada`;
}

function SlotDot({ slot }: { slot: CalendarSlot }) {
  const Icon = slot.period === 'MORNING' ? Sun : Moon;
  const titulo = slotTitle(slot);

  const base = 'size-6 rounded-md flex items-center justify-center shrink-0';
  const porEstado: Record<CalendarSlot['state'], string> = {
    // Registrado: preenchimento do semáforo + a cor de ícone que combina com
    // ele (no escuro, o texto sobre o amarelo é escuro, não branco).
    REGISTERED: statusSolid(slot.status ?? ClinicalStatus.GREEN),
    // Vencido sem medição: cinza cheio.
    MISSED: 'bg-muted text-muted-foreground border border-border',
    // Hoje, ainda dentro da janela: contorno tracejado.
    WAITING: 'border border-dashed border-muted-foreground/60 text-muted-foreground',
    // Futuro: bloqueado.
    LOCKED: 'border border-border text-muted-foreground/60',
  };

  return (
    <span className={cn(base, porEstado[slot.state])} title={titulo} aria-label={titulo} role="img">
      {slot.state === 'LOCKED' ? <Lock className="size-3" /> : <Icon className="size-3.5" />}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Sun className="size-3" /> manhã
      </span>
      <span className="inline-flex items-center gap-1">
        <Moon className="size-3" /> noite
      </span>
      <span aria-hidden className="text-border">
        |
      </span>
      <LegendItem className={statusFill(ClinicalStatus.GREEN)} label={statusLabel(ClinicalStatus.GREEN)} />
      <LegendItem className={statusFill(ClinicalStatus.YELLOW)} label={statusLabel(ClinicalStatus.YELLOW)} />
      <LegendItem className={statusFill(ClinicalStatus.RED)} label={statusLabel(ClinicalStatus.RED)} />
      <LegendItem className="bg-muted border border-border" label="Sem registro" />
      <LegendItem className="border border-dashed border-muted-foreground/60" label="Aguardando" />
      <LegendItem className="border border-border" label="Não liberada" icon={<Lock className="size-2.5" />} />
    </div>
  );
}

function LegendItem({ className, label, icon }: { className: string; label: string; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('size-3 rounded-sm flex items-center justify-center', className)} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  );
}
