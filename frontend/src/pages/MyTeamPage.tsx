/**
 * "Minhas Equipes" — Cirurgião Principal. Cria e gerencia a PRÓPRIA equipe
 * (autoatendimento), com limites garantidos no banco (1 equipe ativa por
 * cirurgião; 10 associados por equipe — ver migrations 0028/0033). A visão
 * rica (resumo, pacientes, alertas) continua no painel `TeamDashboard`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, PageContainer, PageHeader, ProfessionalCombobox } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { Drawer } from '../components/users-admin';
import { TeamDashboard } from '../components/TeamDashboard';
import { teamService } from '../services/teamService';
import { teamViewService, type TeamDetail, type TeamMemberView } from '../services/teamViewService';
import { profileService } from '../services/profileService';
import { professionalInviteService } from '../services/professionalInviteService';
import { TEAM_LIMITS } from '../lib/teamLimits';
import type { Profile } from '../services/types';

const SUBTITLE = 'Crie e gerencie suas equipes médicas de acompanhamento pós-operatório.';
const pad = (n: number) => String(n).padStart(2, '0');

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

/* ============================ Drawer: gerenciar equipe ============================ */
function ManageTeamDrawer({
  team,
  onClose,
  onChanged,
}: {
  team: TeamDetail;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { summary, members, patients } = team;
  const teamAssociates = members.filter((m) => !m.isSurgeon);
  const memberIds = new Set(members.map((m) => m.id));
  const atDoctorLimit = teamAssociates.length >= TEAM_LIMITS.maxAssociatedDoctorsPerTeam;

  const [eligible, setEligible] = useState<Profile[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  // Busca elegíveis para esta equipe específica ao abrir o drawer.
  useEffect(() => {
    profileService.getEligibleAssociates(summary.id).then(setEligible).catch(() => {});
  }, [summary.id]);

  const available = eligible.filter((a) => !memberIds.has(a.id));
  const [toRemove, setToRemove] = useState<TeamMemberView | null>(null);
  const [toArchive, setToArchive] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function addAssociate() {
    if (!pick) return;
    setBusy(true);
    try {
      await teamService.addMember({ team_id: summary.id, doctor_id: pick });
      toast.success('Médico associado vinculado.');
      setPick('');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível vincular o médico.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAssociate() {
    if (!toRemove?.membershipId) return;
    setBusy(true);
    try {
      await teamService.removeMember(toRemove.membershipId);
      toast.success('Médico associado removido.');
      setToRemove(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível remover o médico.');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    try {
      await teamService.inactivateTeam(summary.id);
      toast.success('Equipe arquivada.');
      setToArchive(false);
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível arquivar a equipe.');
    } finally {
      setBusy(false);
    }
  }

  async function generateInvite() {
    setBusy(true);
    try {
      const { link } = await professionalInviteService.generate({ role: 'ASSOCIATED_DOCTOR', teamId: summary.id });
      setInviteLink(link);
      toast.success('Convite gerado. Copie o link e envie ao médico.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível gerar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar. Copie manualmente.');
    }
  }

  return (
    <Drawer title={`Equipe nº ${pad(summary.number)}`} onClose={onClose}>
      {/* Médicos associados */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Médicos associados</h3>
          <span className="text-xs font-semibold text-muted-foreground">
            {teamAssociates.length}/{TEAM_LIMITS.maxAssociatedDoctorsPerTeam}
          </span>
        </div>

        {teamAssociates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum médico associado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {teamAssociates.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>
                <button
                  onClick={() => setToRemove(m)}
                  aria-label={`Remover ${m.name}`}
                  className="size-9 shrink-0 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Adicionar associado */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
          <span className="text-xs font-bold text-muted-foreground inline-flex items-center gap-1.5">
            <UserPlus className="size-3.5" /> Adicionar médico associado
          </span>
          {atDoctorLimit ? (
            <p className="text-sm text-warning">Limite de {TEAM_LIMITS.maxAssociatedDoctorsPerTeam} médicos associados atingido.</p>
          ) : (
            <div className="space-y-2">
              <ProfessionalCombobox
                label="Médico"
                value={pick}
                onChange={setPick}
                options={available.map((a) => ({ id: a.id, name: a.name, tag: a.professional_tag, email: a.email, roleLabel: 'Médico Associado' }))}
                placeholder={available.length ? 'Buscar por nome, tag ou e-mail…' : 'Nenhum associado disponível'}
              />
              <Button onClick={addAssociate} loading={busy} disabled={!pick} block>
                <Plus className="size-4" /> Vincular médico
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Convite por link */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold">Convidar por link</h3>
        <p className="text-xs text-muted-foreground">
          Gere um link para o médico se cadastrar e entrar nesta equipe automaticamente.
        </p>
        {inviteLink ? (
          <div className="flex items-center gap-2">
            <input readOnly value={inviteLink} className="input flex-1 text-xs" />
            <Button variant="ghost" onClick={copyInvite} aria-label="Copiar link">
              <Copy className="size-4" />
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={generateInvite} loading={busy} block>
            <Send className="size-4" /> Gerar convite de médico associado
          </Button>
        )}
      </section>

      {/* Resumo + arquivar */}
      <section className="space-y-2 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          Pacientes vinculados: <strong className="text-foreground">{patients.length}</strong> · Em alerta:{' '}
          <strong className="text-foreground">{summary.stats.alert}</strong>
        </p>
        <Button variant="ghost" onClick={() => setToArchive(true)} block>
          Arquivar equipe
        </Button>
      </section>

      {toRemove && (
        <ConfirmModal
          title={`Remover ${toRemove.name}?`}
          message="O médico deixará de ter acesso a esta equipe. Os registros clínicos são preservados."
          confirmLabel="Remover médico"
          busy={busy}
          onCancel={() => setToRemove(null)}
          onConfirm={removeAssociate}
        />
      )}
      {toArchive && (
        <ConfirmModal
          title={`Arquivar a equipe nº ${pad(summary.number)}?`}
          message="A equipe ficará inativa e não receberá novos pacientes. Os dados históricos são preservados e ela libera uma vaga no seu limite de equipes."
          confirmLabel="Arquivar equipe"
          busy={busy}
          onCancel={() => setToArchive(false)}
          onConfirm={archive}
        />
      )}
    </Drawer>
  );
}
