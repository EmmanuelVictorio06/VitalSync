/**
 * "Minhas Equipes" — visão do profissional (Médico Associado / Cirurgião).
 *
 * Mostra SOMENTE as equipes em que o médico logado está vinculado (filtragem
 * revalidada no servidor — ver lib/teams-api.ts). Daqui ele acessa pacientes e
 * alertas de cada equipe, sem permissão para editar dados administrativos.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { TeamCard, TeamFilterBar, TeamStatusSummary, type TeamFilters } from '../components/teams';
import { myTeamsApi, TeamsApiError } from '../lib/teams-api';
import type { MyTeam, MyTeamsSummary } from '../lib/teams-types';

const EMPTY_FILTERS: TeamFilters = { number: '', surgeon: '', status: 'ALL', onlyUnattended: false };

/** Indica se a equipe tem ao menos um paciente no status filtrado. */
function teamHasStatus(team: MyTeam, status: TeamFilters['status']): boolean {
  if (status === 'ALL') return true;
  if (status === 'GREEN') return team.stats.stable > 0;
  if (status === 'YELLOW') return team.stats.attention > 0;
  return team.stats.alert > 0;
}

export function MyTeamsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [summary, setSummary] = useState<MyTeamsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TeamFilters>(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await myTeamsApi.list(user ? { id: user.id, role: user.role } : undefined);
      setTeams(res.teams);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof TeamsApiError ? err.message : 'Não foi possível carregar suas equipes. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const num = filters.number.trim();
    const surgeon = filters.surgeon.trim().toLowerCase();
    return teams.filter((t) => {
      if (num) {
        const raw = String(t.number);
        const padded = raw.padStart(2, '0');
        const q = num.replace(/^0+/, '') || num; // "01" e "1" equivalem
        if (!raw.includes(q) && !padded.includes(num)) return false;
      }
      if (surgeon && !t.surgeonName.toLowerCase().includes(surgeon)) return false;
      if (filters.onlyUnattended && t.stats.unattendedAlerts === 0) return false;
      if (!teamHasStatus(t, filters.status)) return false;
      return true;
    });
  }, [teams, filters]);

  function patchFilters(patch: Partial<TeamFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  // Navegação dos botões dos cards (somente leitura — sem ações administrativas).
  const viewPatients = (t: MyTeam) => navigate(`/monitoring?team=${t.number}`);
  const viewAlerts = (t: MyTeam) => navigate(`/alerts?team=${t.number}`);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Minhas Equipes</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Visualize as equipes médicas em que você está associado e acompanhe os pacientes vinculados a cada uma.
        </p>
      </div>

      {summary && !loading && !error && <TeamStatusSummary summary={summary} />}

      {!loading && !error && teams.length > 0 && (
        <TeamFilterBar filters={filters} onChange={patchFilters} />
      )}

      {loading ? (
        <LoadingState label="Carregando suas equipes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : teams.length === 0 ? (
        <EmptyState
          title="Você ainda não está associado a nenhuma equipe médica."
          hint="Quando um administrador vincular você a uma equipe, ela aparecerá aqui."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhuma equipe corresponde aos filtros." hint="Ajuste a busca para ver mais resultados." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 animate-entry [animation-delay:150ms]">
          {filtered.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              onViewPatients={() => viewPatients(t)}
              onViewAlerts={() => viewAlerts(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
