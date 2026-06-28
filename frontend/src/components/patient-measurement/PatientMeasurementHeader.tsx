/**
 * Cabeçalho do card de medição — ícone em círculo azul, saudação, dia de
 * monitoramento, data e badge do período. Mantém pouca informação no topo.
 */
import { HeartPulse, Moon, Sun } from 'lucide-react';
import { Period } from '@vitalsync/shared';
import { periodLabel } from './types';

export function PatientMeasurementHeader({
  name,
  monitoringDay,
  period,
}: {
  name: string;
  monitoringDay: number | null;
  period: Period;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const isMorning = period === Period.MORNING;
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="text-center">
      <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
        <HeartPulse className="size-8" />
      </div>
      <p className="text-sm text-muted-foreground">Olá, {firstName}</p>
      <h1 className="text-xl font-extrabold tracking-tight">Registro de medição</h1>
      <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
        {monitoringDay != null && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Dia {monitoringDay} de monitoramento
          </span>
        )}
        <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase">
          {isMorning ? <Sun className="size-3" /> : <Moon className="size-3" />}
          {periodLabel(period)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{today}</p>
    </div>
  );
}
