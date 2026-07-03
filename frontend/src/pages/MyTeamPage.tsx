/**
 * "Minhas Equipes" — Cirurgião Principal. Cria e gerencia a PRÓPRIA equipe
 * (autoatendimento), com limites garantidos no banco (1 equipe ativa por
 * cirurgião; 10 associados por equipe — ver migrations 0028/0033). A visão
 * rica (resumo, pacientes, alertas) continua no painel `TeamDashboard`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, PageContainer, PageHeader } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { TeamDashboard } from '../components/TeamDashboard';
import { ManageTeamDrawer } from '../components/ManageTeamDrawer';
import { teamService } from '../services/teamService';
import { teamViewService, type TeamDetail } from '../services/teamViewService';
import { TEAM_LIMITS } from '../lib/teamLimits';

const SUBTITLE = 'Crie e gerencie suas equipes médicas de acompanhamento pós-operatório.';

export function MyTeamPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTeams(null);
    setError(null);
    try {
      const mine = await teamViewService.getMyMainTeams();
      setTeams(mine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados das suas equipes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = (teams ?? []).filter((t) => t.summary.status === 'ACTIVE').length;
  const atLimit = activeCount >= TEAM_LIMITS.maxTeamsPerSurgeon;
  const manageTeam = manageId ? (teams ?? []).find((t) => t.summary.id === manageId) ?? null : null;

  async function createTeam() {
    if (atLimit) return;
    setBusy(true);
    try {
      await teamService.createMyTeam();
      toast.success('Equipe criada com sucesso.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar a equipe.');
    } finally {
      setBusy(false);
    }
  }

  const newTeamButton = (
    <Button
      onClick={createTeam}
      loading={busy}
      disabled={atLimit}
      title={atLimit ? 'Cada cirurgião pode ter apenas uma equipe.' : undefined}
    >
      <Plus className="size-4" /> Nova equipe
    </Button>
  );

  return (
    <PageContainer size="wide">
      <PageHeader title="Minhas Equipes" subtitle={SUBTITLE} action={newTeamButton} />

      {teams && !error && (
        <p className="text-sm text-muted-foreground">
          Equipes ativas:{' '}
          <strong className="text-foreground">
            {activeCount}/{TEAM_LIMITS.maxTeamsPerSurgeon}
          </strong>
          {atLimit && <span className="ml-2 text-warning">· cada cirurgião pode ter apenas uma equipe ativa.</span>}
        </p>
      )}

      {teams === null ? (
        <LoadingState label="Carregando dados das suas equipes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : teams.length === 0 ? (
        <EmptyState
          title="Nenhuma equipe criada"
          hint="Crie sua primeira equipe para começar a acompanhar pacientes."
        />
      ) : (
        <TeamDashboard
          teams={teams}
          roleLabel="Você é o Cirurgião Responsável"
          currentUserId={user?.id}
          onManageTeam={setManageId}
        />
      )}

      {manageTeam && (
        <ManageTeamDrawer
          team={manageTeam}
          onClose={() => setManageId(null)}
          onChanged={load}
        />
      )}
    </PageContainer>
  );
}
