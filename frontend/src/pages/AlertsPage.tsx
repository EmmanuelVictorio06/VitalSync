/**
 * Aba "Alertas" — central de acompanhamento clínico.
 *
 * O escopo por perfil vem do Supabase (RLS): Admin vê todos; Cirurgião/Associado
 * só das suas equipes. Aqui adaptamos o resumo, os filtros e as ações conforme o
 * papel (permissionService). As mudanças de status passam por RPCs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { PageContainer, PageHeader } from '../components/ui';
import {
  AlertCard,
  AlertDetailsDrawer,
  AlertFiltersSheet,
  AlertListSkeleton,
  AlertQuickFilters,
  AlertSearchBar,
  EMPTY_FILTERS,
  EmptyState,
  ErrorState,
  IgnoreAlertModal,
  MarkAttendedModal,
  activeQuickCard,
  applyAlertFilters,
  applyQuickCard,
  countAdvancedFilters,
  sortAlerts,
  type AlertFiltersState,
} from '../components/alerts';
import { useAlertCount } from '../components/AlertCount';
import { MissingMeasurementsCard } from '../components/MissingMeasurementsCard';
import { Role } from '@vitalsync/shared';
import { isWithNursing, ownsDoctorQueue } from '../lib/alertSeverity';
import { alertService, type AlertRow } from '../services/alertService';
import { permissionService } from '../services/permissionService';

export function AlertsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { refresh: refreshCount } = useAlertCount();
  const [searchParams] = useSearchParams();

  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<AlertFiltersState>({
    ...EMPTY_FILTERS,
    team: searchParams.get('team') ?? 'ALL',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [attendTarget, setAttendTarget] = useState<AlertRow | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<AlertRow | null>(null);

  const isAdmin = permissionService.isAdmin(user);
  const canAttend = permissionService.canAttendAlerts(user);
  const canResend = permissionService.canResendAlertNotification(user);
  const isReadOnlyManager = user?.role === Role.MANAGER;

  /** Trava de atendimento: alerta em análise por OUTRO profissional → Atender/
   *  Ignorar bloqueados para todos, exceto o dono do lock e o Admin. O Cirurgião
   *  Principal NÃO atropela o lock: para assumir, primeiro usa "Liberar". */
  const isLockedByOther = useCallback(
    (a: AlertRow): boolean => {
      if (a.attendance_status !== 'IN_ANALYSIS' || !a.in_analysis_by) return false;
      if (isAdmin) return false;
      return !user || a.in_analysis_by !== user.id;
    },
    [isAdmin, user],
  );

  /**
   * Amarelo não escalado é evento da ENFERMAGEM (0077): para cirurgião e
   * associado ele continua VISÍVEL — a equipe é deles — mas sem botão de ação,
   * porque a triagem é da enfermagem e a escalada é que o traz de volta.
   */
  const withNursing = useCallback(
    (a: AlertRow): boolean => isWithNursing(a, user?.role, user?.id ?? null),
    [user],
  );

  /** "Liberar" (devolver à fila): dono do lock, Admin ou Cirurgião Principal da equipe. */
  const canReleaseAlert = useCallback(
    (a: AlertRow): boolean => {
      if (a.attendance_status !== 'IN_ANALYSIS' || !a.in_analysis_by) return false;
      if (isAdmin) return true;
      if (!user) return false;
      return a.in_analysis_by === user.id || a.team?.main_surgeon_id === user.id;
    },
    [isAdmin, user],
  );

  const load = useCallback(async () => {
    setError(false);
    setAlerts(null);
    try {
      const data = await alertService.getAlerts();
      setAlerts(data);
      refreshCount(); // atualiza o badge da sidebar (não atendidos restantes)
    } catch {
      setError(true);
      setAlerts([]);
    }
  }, [refreshCount]);

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

  const summary = useMemo(() => alertService.summarize(alerts ?? []), [alerts]);
  const activeQuick = useMemo(() => activeQuickCard(filters), [filters]);
  const advancedCount = useMemo(() => countAdvancedFilters(filters), [filters]);

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

  async function handleRelease(alert: AlertRow) {
    try {
      await alertService.releaseAnalysis(alert.id);
      toast.info('Alerta liberado de volta para a fila.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao liberar o alerta.');
    }
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
    <PageContainer>
      <PageHeader
        title="Alertas"
        subtitle="Acompanhe alterações clínicas geradas pelos registros de sinais vitais dos pacientes em monitoramento."
      />

      {isReadOnlyManager && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Visualização somente-leitura — como Gerente de Equipe, você acompanha os alertas, mas o atendimento clínico é feito pelo médico responsável.
        </div>
      )}

      <MissingMeasurementsCard />

      {alerts && !error && (
        <AlertQuickFilters
          summary={summary}
          active={activeQuick}
          onSelect={(key) => setFilters((f) => applyQuickCard(f, key))}
          yellowIsNursing={ownsDoctorQueue(user?.role)}
        />
      )}

      <AlertSearchBar
        search={filters.search}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        onOpenFilters={() => setFiltersOpen(true)}
        activeFilterCount={advancedCount}
      />

      {error ? (
        <ErrorState onRetry={load} />
      ) : alerts === null ? (
        <AlertListSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={(alerts.length === 0) ? 'Nenhum alerta no momento.' : 'Nenhum alerta encontrado para os filtros selecionados.'}
          hint={(alerts.length > 0) ? 'Ajuste a busca ou os filtros para ver outros alertas.' : 'Novos alertas aparecem quando um paciente registra sinais alterados.'}
        />
      ) : (
        <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
          <span><b className="text-foreground">{filtered.length}</b> alerta(s)</span>
          {activeQuick === null && filters.attendance === 'ACTIVE' && !filters.search.trim() && (
            <span>Atendidos e ignorados ficam ocultos — use o card “Atendidos” ou busque por nome para vê-los.</span>
          )}
        </div>
        <ul className="space-y-3">
          {filtered.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              canAttend={canAttend}
              lockedByOther={isLockedByOther(a)}
              canRelease={canReleaseAlert(a)}
              withNursing={withNursing(a)}
              onDetails={() => setSelected(a)}
              onInAnalysis={() => handleInAnalysis(a)}
              onAttend={() => setAttendTarget(a)}
              onRelease={() => handleRelease(a)}
            />
          ))}
        </ul>
        </>
      )}

      {selected && (
        <AlertDetailsDrawer
          alert={selected}
          perms={{
            // O drawer é a outra porta para Atender/Ignorar: fechar só o card
            // deixaria a ação acessível por dentro dos detalhes.
            canAttend: canAttend && !withNursing(selected),
            canResend,
            lockedByOther: isLockedByOther(selected),
            canRelease: canReleaseAlert(selected) && !withNursing(selected),
          }}
          onClose={() => setSelected(null)}
          onAction={load}
          onAttend={() => setAttendTarget(selected)}
          onIgnore={() => setIgnoreTarget(selected)}
          onRelease={() => handleRelease(selected)}
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

      {filtersOpen && (
        <AlertFiltersSheet
          value={filters}
          onApply={setFilters}
          onClose={() => setFiltersOpen(false)}
          isAdmin={isAdmin}
          teamOptions={teamOptions}
        />
      )}
    </PageContainer>
  );
}
