import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Check, X } from 'lucide-react';
import { Loading, cn } from '../components/ui';
import { useToast } from '../components/Toast';
import { alertService, type AlertWithPatient } from '../services/alertService';

type SeverityFilter = 'ALL' | 'RED' | 'YELLOW';
const FILTERS: Array<{ value: SeverityFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'RED', label: 'Alerta' },
  { value: 'YELLOW', label: 'Atenção' },
];

/** Central de alertas — dados reais do Supabase (escopo por equipe via RLS). */
export function AlertsPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<SeverityFilter>('ALL');
  const [alerts, setAlerts] = useState<AlertWithPatient[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const team = searchParams.get('team') ?? '';

  const load = useCallback(async () => {
    setAlerts(null);
    try {
      setAlerts(await alertService.list());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar alertas.');
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function clearTeam() {
    const next = new URLSearchParams(searchParams);
    next.delete('team');
    setSearchParams(next, { replace: true });
  }

  async function markAttended(id: string) {
    try {
      await alertService.markAttended(id);
      toast.success('Alerta marcado como atendido.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar o alerta.');
    }
  }

  const filtered = (alerts ?? []).filter((a) => filter === 'ALL' || a.status === filter);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 animate-entry">
        <div className="flex-1">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Alertas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Eventos clínicos que exigem atenção da equipe, do mais recente ao mais antigo.
          </p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1 self-start">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                filter === f.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {team && (
        <div className="flex items-center gap-2 animate-entry">
          <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-full pl-3 pr-1.5 py-1">
            Alertas da Equipe nº {team.padStart(2, '0')}
            <button onClick={clearTeam} className="size-5 rounded-full hover:bg-primary/20 flex items-center justify-center" aria-label="Remover filtro de equipe">
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}

      {alerts === null ? (
        <Loading label="Carregando alertas…" />
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry">
          <Bell className="size-8 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">Nenhum alerta no momento</p>
        </div>
      ) : (
        <ul className="space-y-3 animate-entry [animation-delay:100ms]">
          {filtered.map((a) => (
            <li
              key={a.id}
              className={cn(
                'bg-card border border-border rounded-xl p-4 flex items-center gap-4 border-l-4 shadow-sm',
                a.status === 'RED' ? 'border-l-alert' : 'border-l-warning',
                a.attended && 'opacity-60',
              )}
            >
              <span className={cn('size-2.5 rounded-full shrink-0', a.status === 'RED' ? 'bg-alert pulse-alert' : 'bg-warning')} />
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm truncate', a.status === 'RED' ? 'font-extrabold' : 'font-bold')}>
                  {a.patient?.name ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono hidden sm:block">
                {new Date(a.created_at).toLocaleString('pt-BR')}
              </span>
              {a.attended ? (
                <span className="text-[10px] font-bold uppercase text-stable shrink-0">Atendido</span>
              ) : (
                <button
                  onClick={() => markAttended(a.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 shrink-0"
                >
                  <Check className="size-3.5" /> Atender
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
