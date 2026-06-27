/**
 * "Minha Equipe" — Cirurgião Principal. Carrega as equipes em que ele é o
 * responsável e delega a renderização ao painel compartilhado `TeamDashboard`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PageContainer, PageHeader } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { TeamDashboard } from '../components/TeamDashboard';
import { teamViewService, type TeamDetail } from '../services/teamViewService';

const SUBTITLE = 'Visualize sua equipe médica e acompanhe os pacientes vinculados ao seu monitoramento pós-operatório.';

export function MyTeamPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTeams(null);
    setError(null);
    try {
      setTeams(await teamViewService.getMyMainTeams());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados da equipe.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (teams === null) return <PageContainer size="wide"><LoadingState label="Carregando dados da sua equipe…" /></PageContainer>;
  if (error) return <PageContainer size="wide"><ErrorState message={error} onRetry={() => void load()} /></PageContainer>;

  return (
    <PageContainer size="wide">
      <PageHeader title="Minhas Equipes" subtitle={SUBTITLE} />
      {teams.length === 0 ? (
        <EmptyState title="Nenhuma equipe encontrada" hint="Você ainda não está vinculado como cirurgião responsável por uma equipe." />
      ) : (
        <TeamDashboard teams={teams} roleLabel="Você é o Cirurgião Responsável" currentUserId={user?.id} />
      )}
    </PageContainer>
  );
}
