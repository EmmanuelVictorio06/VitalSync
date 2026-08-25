/**
 * NurseReassessmentQueue — bloco "Recontatos de enfermagem" da central.
 *
 * É o que faz o recontato NÃO depender de abrir paciente por paciente: lista
 * todos os recontatos pendentes visíveis ao usuário (0078), com prazo,
 * contagem regressiva e destaque de atraso, com link direto para a aba de
 * enfermagem do paciente.
 *
 * O escopo vem do banco (`nurse_reassessments_due` repete a guarda da RLS), não
 * de filtro no cliente.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ClockAlert, RefreshCw } from 'lucide-react';
import { Button, cn } from './ui';
import {
  dueLabel,
  nurseReassessmentService,
  type DueReassessment,
} from '../services/nurseReassessmentService';

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
}

export function NurseReassessmentQueue() {
  const [rows, setRows] = useState<DueReassessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await nurseReassessmentService.listDue());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Nada pendente: não ocupa espaço na central.
  if (!loading && rows.length === 0) return null;

  const atrasadas = rows.filter((r) => r.overdue).length;

  return (
    <section
      className={cn(
        'bg-card border rounded-xl shadow-sm overflow-hidden animate-entry',
        atrasadas > 0 ? 'border-alert/40' : 'border-border',
      )}
    >
      <header className="flex items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock className={cn('size-4', atrasadas > 0 ? 'text-alert' : 'text-warning')} />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recontatos de enfermagem ({rows.length})
          </h3>
          {atrasadas > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-alert/10 border border-alert/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-alert">
              <ClockAlert className="size-3" /> {atrasadas} em atraso
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} loading={refreshing}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
      </header>

      <p className="px-4 sm:px-5 pt-3 text-xs text-muted-foreground">
        Agendados após você atender um alerta amarelo. Abra o paciente para registrar o desfecho.
      </p>

      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{r.patient_name}</p>
              <p className="text-[11px] text-muted-foreground">
                previsto para <span className="font-mono">{fmtHora(r.due_at)}</span>
                {r.scheduled_by_name ? ` · agendado por ${r.scheduled_by_name}` : ''}
              </p>
            </div>
            <span
              className={cn(
                'text-xs font-bold shrink-0',
                r.overdue ? 'text-alert' : 'text-muted-foreground',
              )}
            >
              {dueLabel(r.due_at, now)}
            </span>
            <Link
              to={`/patients/${r.patient_id}?tab=enfermagem`}
              className="shrink-0 inline-flex items-center min-h-10 px-3 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Recontatar
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
