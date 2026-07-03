/**
 * Equipes Vinculadas — Gerente de Equipe.
 * Lista as equipes dos cirurgiões vinculados ao gerente logado.
 * Leitura via RLS (teams_select já filtra por is_team_manager_of).
 */
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { PageContainer, PageHeader } from '../components/ui';
import { teamManagerService, type ManagerSurgeonLink } from '../services/teamManagerService';
import { TeamDashboard } from '../components/TeamDashboard';
import { ManageTeamDrawer } from '../components/ManageTeamDrawer';
import type { TeamDetail } from '../services/teamViewService';
import { teamViewService } from '../services/teamViewService';

export function ManagerTeamsPage() {
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [links, setLinks] = useState<ManagerSurgeonLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTeams(null);
    setError(null);
    try {
      // Equipes dos cirurgiões vinculados ao gerente (não getMyMainTeams, que
      // filtra por main_surgeon_id = usuário logado e sempre retorna vazio).
      const [allTeams, myLinks] = await Promise.all([
        teamViewService.getManagerTeams().catch(() => [] as TeamDetail[]),
        teamManagerService.getMyLinks().catch(() => [] as ManagerSurgeonLink[]),
      ]);
      setTeams(allTeams);
      setLinks(myLinks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as equipes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const surgeonNames = links.map((l) => l.surgeon?.name).filter(Boolean).join(', ');
  const manageTeam = manageId ? (teams ?? []).find((t) => t.summary.id === manageId) ?? null : null;

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Equipes Vinculadas"
        subtitle={
          links.length > 0
            ? `Cirurgiões sob sua gestão: ${surgeonNames}`
            : 'Sem cirurgiões vinculados. Solicite ao Administrador.'
        }
      />

      {teams === null ? (
        <LoadingState label="Carregando equipes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : teams.length === 0 ? (
        <EmptyState
          title="Nenhuma equipe vinculada"
          hint="Você ainda não gerencia nenhuma equipe. Solicite ao Administrador vincular você a um Médico Cirurgião."
        />
      ) : (
        <TeamDashboard teams={teams} roleLabel="Você é o Gerente desta Equipe" onManageTeam={setManageId} />
      )}

      {manageTeam && (
        <ManageTeamDrawer
          team={manageTeam}
          canArchive={false}
          onClose={() => setManageId(null)}
          onChanged={load}
        />
      )}
    </PageContainer>
  );
}
