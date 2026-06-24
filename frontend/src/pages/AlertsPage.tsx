/**
 * Aba "Alertas" — central de acompanhamento clínico.
 *
 * O escopo por perfil vem do Supabase (RLS): Admin vê todos; Cirurgião/Associado
 * só das suas equipes. Aqui adaptamos o resumo, os filtros e as ações conforme o
 * papel (permissionService). As mudanças de status passam por RPCs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Role, useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Loading } from '../components/ui';
import {
  AlertCard,
  AlertDetailsDrawer,
  AlertFilters,
  AlertSummaryCards,
  EMPTY_FILTERS,
  EmptyState,
  ErrorState,
  IgnoreAlertModal,
  MarkAttendedModal,
  applyAlertFilters,
  sortAlerts,
  type AlertFiltersState,
} from '../components/alerts';
import { useAlertCount } from '../components/AlertCount';
import { alertService, type AlertRow } from '../services/alertService';
import { permissionService } from '../services/permissionService';

export function AlertsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { refresh: refreshCount } = useAlertCount();
  const [searchParams] = useSearchParams();

  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [filters, setFilters] = useState<AlertFiltersState>({
    ...EMPTY_FILTERS,
    team: searchParams.get('team') ?? 'ALL',
  });
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [attendTarget, setAttendTarget] = useState<AlertRow | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<AlertRow | null>(null);

  const isAdmin = permissionService.isAdmin(user);
  const canAttend = permissionService.canAttendAlerts(user);
  const canResend = permissionService.canResendAlertNotification(user);
  const roleKey: 'ADM' | 'SURGEON' | 'ASSOCIATE' =
    user?.role === Role.ADM ? 'ADM' : user?.role === Role.SURGEON ? 'SURGEON' : 'ASSOCIATE';

  const load = useCallback(async () => {
    setError(false);
    setAlerts(null);
    try {
      const data = await alertService.getAlerts();
      setAlerts(data);
      refreshCount(); // atualiza o badge da sidebar (não atendidos restantes)
      if (permissionService.isAdmin(user)) {
        setFailedCount(await alertService.getFailedNotificationCount());
      }
    } catch {
      setError(true);
      setAlerts([]);
    }
  }, [user, refreshCount]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mantém o alerta aberto no drawer sincronizado após recarregar.
  useEffect(() => {
    if (selected && alerts) {
      const fresh = alerts.find((a) => a.id === selected.id) ?? null;
      if (fresh !== selected) setSelected(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  const summary = useMemo(() => {
    const base = alertService.summarize(alerts ?? []);
    return { ...base, failedNotifications: failedCount };
  }, [alerts, failedCount]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of alerts ?? []) {
      if (a.team?.team_number != null) {
        const v = String(a.team.team_number);
        map.set(v, `Equipe ${v.padStart(2, '0')}`);
      }
    }
    return [...map.entries()].sort().map(([value, label]) => ({ value, label }));
  }, [alerts]);

  const filtered = useMemo(() => sortAlerts(applyAlertFilters(alerts ?? [], filters)), [alerts, filters]);

  async function handleInAnalysis(alert: AlertRow) {
    try {
      await alertService.markInAnalysis(alert.id);
      toast.success('Alerta marcado como em análise.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar o alerta.');
    }
  }

  async function handleAttendConfirm(alert: AlertRow, professionalId: string | null, observation: string) {
    await alertService.markAttended(alert.id, professionalId, observation);
    toast.success('Atendimento registrado.');
    setAttendTarget(null);
    await load();
  }

  async function handleIgnoreConfirm(alert: AlertRow, reason: string) {
    await alertService.ignore(alert.id, reason);
    toast.info('Alerta ignorado com justificativa.');
    setIgnoreTarget(null);
    await load();
  }

  if (!permissionService.canViewAlerts(user)) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <EmptyState title="Você não tem permissão para visualizar estes alertas." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Alertas</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Acompanhe alterações clínicas geradas pelos registros de sinais vitais dos pacientes em monitoramento.
        </p>
      </div>

      {alerts && !error && <AlertSummaryCards summary={summary} role={roleKey} />}

      <AlertFilters value={filters} onChange={setFilters} isAdmin={isAdmin} teamOptions={teamOptions} />

      {error ? (
        <ErrorState onRetry={load} />
      ) : alerts === null ? (
        <Loading label="Carregando alertas…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={(alerts.length === 0) ? 'Nenhum alerta no momento.' : 'Nenhum alerta encontrado.'}
          hint={(alerts.length > 0) ? 'Ajuste os filtros para ver outros alertas.' : 'Novos alertas aparecem quando um paciente registra sinais alterados.'}
        />
      ) : (
        <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
          <span><b className="text-foreground">{filtered.length}</b> alerta(s)</span>
          {filters.attendance === 'ACTIVE' && !filters.search.trim() && (
            <span>Atendidos e ignorados ficam ocultos — filtre por “Atendido” ou busque por nome para vê-los.</span>
          )}
        </div>
        <ul className="space-y-3">
          {filtered.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              canAttend={canAttend}
              onDetails={() => setSelected(a)}
              onInAnalysis={() => handleInAnalysis(a)}
              onAttend={() => setAttendTarget(a)}
            />
          ))}
        </ul>
        </>
      )}

      {selected && (
        <AlertDetailsDrawer
          alert={selected}
          perms={{ canAttend, canResend }}
          onClose={() => setSelected(null)}
          onAction={load}
          onAttend={() => setAttendTarget(selected)}
          onIgnore={() => setIgnoreTarget(selected)}
        />
      )}

      {attendTarget && (
        <MarkAttendedModal
          alert={attendTarget}
          onCancel={() => setAttendTarget(null)}
          onConfirm={(professionalId, observation) => handleAttendConfirm(attendTarget, professionalId, observation)}
        />
      )}

      {ignoreTarget && (
        <IgnoreAlertModal
          onCancel={() => setIgnoreTarget(null)}
          onConfirm={(reason) => handleIgnoreConfirm(ignoreTarget, reason)}
        />
      )}
    </div>
  );
}
