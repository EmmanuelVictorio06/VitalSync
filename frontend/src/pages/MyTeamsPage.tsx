/**
 * "Minhas Equipes" — Médico Associado (somente leitura). Carrega as equipes em
 * que ele participa como associado e delega a renderização ao painel
 * compartilhado `TeamDashboard` (RLS restringe ao escopo do médico).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PageContainer, PageHeader } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { TeamDashboard } from '../components/TeamDashboard';
import { teamViewService, type TeamDetail } from '../services/teamViewService';

const SUBTITLE = 'Visualize as equipes médicas em que você é associado e acompanhe os pacientes vinculados a cada uma.';

export function MyTeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTeams(null);
    setError(null);
    try {
      setTeams(await teamViewService.getMyAssociatedTeams());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar suas equipes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (teams === null) return <PageContainer size="wide"><LoadingState label="Carregando suas equipes…" /></PageContainer>;
  if (error) return <PageContainer size="wide"><ErrorState message={error} onRetry={() => void load()} /></PageContainer>;

  return (
    <PageContainer size="wide">
      <PageHeader title="Minhas Equipes" subtitle={SUBTITLE} />
      {teams.length === 0 ? (
        <EmptyState title="Nenhuma equipe encontrada" hint="Você ainda não está associado a nenhuma equipe médica." />
      ) : (
        <TeamDashboard teams={teams} roleLabel="Você é Médico Associado" currentUserId={user?.id} />
      )}
    </PageContainer>
  );
}
