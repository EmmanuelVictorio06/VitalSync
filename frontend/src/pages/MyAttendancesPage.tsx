/**
 * Aba "Meus Atendimentos" — histórico de alertas já atendidos/finalizados.
 *
 * O escopo por perfil vem do Supabase (RLS sobre attendance_confirmations):
 * Admin vê todos; Cirurgião Principal e Médico Associado só os atendimentos dos
 * pacientes das suas equipes. Esta tela lista apenas registros finalizados
 * (ATTENDED ou IGNORED), sem ações de resolução.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, PageContainer, PageHeader } from '../components/ui';
import {
  AttendanceActiveFilterChips,
  AttendanceCard,
  AttendanceDetailsDrawer,
  AttendanceEmptyState,
  AttendanceErrorState,
  AttendanceFiltersSheet,
  AttendanceListSkeleton,
  AttendanceSearchBar,
  AttendanceSummaryCards,
  EditAttendanceObservationModal,
  EMPTY_FILTERS,
  applyAttendanceFilters,
  applyQuickCard,
  countAdvancedFilters,
  sortAttendances,
  type AttendanceFiltersState,
} from '../components/attendances';
import { attendanceService, type AttendanceRow } from '../services/attendanceService';
import { permissionService } from '../services/permissionService';

export function MyAttendancesPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<AttendanceFiltersState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<AttendanceRow | null>(null);
  const [editTarget, setEditTarget] = useState<AttendanceRow | null>(null);

  // Só profissionais clínicos editam observação; o Admin tem visão de leitura.
  const canEdit = permissionService.canAttendAlerts(user);

  const load = useCallback(async () => {
    setError(false);
    setRows(null);
    try {
      const data = await attendanceService.getMyAttendances();
      setRows(data);
    } catch {
      setError(true);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Mantém o item aberto no drawer sincronizado após recarregar.
  useEffect(() => {
    if (selected && rows) {
      const fresh = rows.find((r) => r.id === selected.id) ?? null;
      if (fresh !== selected) setSelected(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const summary = useMemo(() => attendanceService.summarize(rows ?? []), [rows]);
  const advancedCount = useMemo(() => countAdvancedFilters(filters), [filters]);
  const filtered = useMemo(
    () => sortAttendances(applyAttendanceFilters(rows ?? [], filters)),
    [rows, filters],
  );

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      if (r.team?.team_number != null) {
        const v = String(r.team.team_number);
        map.set(v, `Equipe ${v.padStart(2, '0')}`);
      }
    }
    return [...map.entries()].sort().map(([value, label]) => ({ value, label }));
  }, [rows]);

  const patientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      if (r.patient) map.set(r.patient.id, r.patient.name);
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const surgeryTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      if (r.patient?.surgery_type?.name) set.add(r.patient.surgery_type.name);
    }
    return [...set].sort().map((name) => ({ value: name, label: name }));
  }, [rows]);

  async function handleEditConfirm(row: AttendanceRow, observation: string) {
    await attendanceService.updateObservation(row.id, observation);
    toast.success('Observação atualizada.');
    setEditTarget(null);
    await load();
  }

  if (!permissionService.canViewAlerts(user)) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <AttendanceEmptyState title="Você não tem permissão para visualizar atendimentos." />
      </div>
    );
  }

  const hasAdvancedOrSearch =
    advancedCount > 0 || filters.search.trim().length > 0 || filters.quick !== 'ALL';

  return (
    <PageContainer>
      <PageHeader
        title="Meus Atendimentos"
        subtitle="Histórico de alertas já atendidos ou finalizados pela equipe médica."
      />

      {rows && !error && (
        <AttendanceSummaryCards
          summary={summary}
          active={filters.quick}
          onSelect={(key) => setFilters((f) => applyQuickCard(f, key))}
        />
      )}

      <AttendanceSearchBar
        search={filters.search}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        onOpenFilters={() => setFiltersOpen(true)}
        activeFilterCount={advancedCount}
      />

      <AttendanceActiveFilterChips
        filters={filters}
        onChange={setFilters}
        teamOptions={teamOptions}
        patientOptions={patientOptions}
      />

      {error ? (
        <AttendanceErrorState onRetry={load} />
      ) : rows === null ? (
        <AttendanceListSkeleton />
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <AttendanceEmptyState
            title="Nenhum atendimento finalizado"
            hint="Quando um alerta for atendido pela equipe médica, ele aparecerá neste histórico."
          />
        ) : (
          <AttendanceEmptyState
            title="Nenhum atendimento encontrado"
            hint="Tente ajustar a busca ou limpar os filtros aplicados."
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                Limpar filtros
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
            <span>
              <b className="text-foreground">{filtered.length}</b>{' '}
              {filtered.length === 1 ? 'atendimento encontrado' : 'atendimentos encontrados'}
              {hasAdvancedOrSearch ? ' com os filtros selecionados' : ''}
            </span>
          </div>
          <ul className="space-y-3">
            {filtered.map((row) => (
              <AttendanceCard key={row.id} row={row} onDetails={() => setSelected(row)} />
            ))}
          </ul>
        </>
      )}

      {selected && (
        <AttendanceDetailsDrawer
          row={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onEditObservation={() => setEditTarget(selected)}
        />
      )}

      {editTarget && (
        <EditAttendanceObservationModal
          row={editTarget}
          onCancel={() => setEditTarget(null)}
          onConfirm={(observation) => handleEditConfirm(editTarget, observation)}
        />
      )}

      {filtersOpen && (
        <AttendanceFiltersSheet
          value={filters}
          onApply={setFilters}
          onClose={() => setFiltersOpen(false)}
          teamOptions={teamOptions}
          patientOptions={patientOptions}
          surgeryTypeOptions={surgeryTypeOptions}
        />
      )}
    </PageContainer>
  );
}
