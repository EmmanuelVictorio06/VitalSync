/**
 * Drawer de gestão de equipe — adicionar/remover médico associado e
 * profissional de enfermagem, gerar convite por link e (opcionalmente)
 * arquivar. Compartilhado entre o Cirurgião Responsável ("Minhas Equipes") e o
 * Gerente de Equipe ("Equipes Vinculadas"): mesma UI/ações para os dois perfis,
 * já que o banco (RLS/RPC) autoriza ambos a gerenciar a equipe (ver migration
 * 0035 — a policy `members_admin` cobre admin, cirurgião responsável e gerente
 * vinculado, e vale igual para o vínculo de enfermagem liberado na 0076).
 */
import { useEffect, useState } from 'react';
import { Copy, Plus, Send, Stethoscope, Trash2, UserPlus } from 'lucide-react';
import { useToast } from './Toast';
import { Button, ConfirmModal, ProfessionalCombobox } from './ui';
import { Drawer } from './users-admin';
import { teamService } from '../services/teamService';
import type { TeamDetail, TeamMemberView } from '../services/teamViewService';
import { profileService } from '../services/profileService';
import { professionalInviteService } from '../services/professionalInviteService';
import { TEAM_LIMITS } from '../lib/teamLimits';
import type { Profile } from '../services/types';

const pad = (n: number) => String(n).padStart(2, '0');

type NurseOption = { id: string; name: string; professional_tag: string | null };

export function ManageTeamDrawer({
  team,
  canArchive = true,
  onClose,
  onChanged,
}: {
  team: TeamDetail;
  /** Ação destrutiva/de posse — só o cirurgião responsável (ou admin) arquiva. */
  canArchive?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { summary, members, patients } = team;
  // A enfermagem vive na mesma tabela desde a 0076 — "associado" exige excluir
  // os dois (`isSurgeon` e `isNurse`), senão o enfermeiro conta no limite de 10.
  const teamAssociates = members.filter((m) => !m.isSurgeon && !m.isNurse);
  const teamNurses = members.filter((m) => m.isNurse);
  const memberIds = new Set(members.map((m) => m.id));
  const atDoctorLimit = teamAssociates.length >= TEAM_LIMITS.maxAssociatedDoctorsPerTeam;

  const [eligible, setEligible] = useState<Profile[]>([]);
  const [eligibleNurses, setEligibleNurses] = useState<NurseOption[]>([]);
  const [pick, setPick] = useState('');
  const [nursePick, setNursePick] = useState('');
  const [busy, setBusy] = useState(false);

  // Busca elegíveis para esta equipe específica ao abrir o drawer.
  useEffect(() => {
    profileService.getEligibleAssociates(summary.id).then(setEligible).catch(() => {});
    profileService.getEligibleNurses().then(setEligibleNurses).catch(() => {});
  }, [summary.id]);

  const available = eligible.filter((a) => !memberIds.has(a.id));
  const availableNurses = eligibleNurses.filter((n) => !memberIds.has(n.id));
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

  async function addNurse() {
    if (!nursePick) return;
    setBusy(true);
    try {
      await teamService.addMember({
        team_id: summary.id,
        doctor_id: nursePick,
        role_in_team: 'NURSING_PROFESSIONAL',
      });
      toast.success('Profissional de enfermagem vinculado.');
      setNursePick('');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível vincular o profissional de enfermagem.');
    } finally {
      setBusy(false);
    }
  }

  /** Remove o vínculo — serve para médico associado e para enfermagem. */
  async function removeMember() {
    if (!toRemove?.membershipId) return;
    const ehEnfermeiro = Boolean(toRemove.isNurse);
    setBusy(true);
    try {
      await teamService.removeMember(toRemove.membershipId);
      toast.success(ehEnfermeiro ? 'Profissional de enfermagem removido.' : 'Médico associado removido.');
      setToRemove(null);
      await onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : ehEnfermeiro
            ? 'Não foi possível remover o profissional de enfermagem.'
            : 'Não foi possível remover o médico.',
      );
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
                // Elegíveis incluem cirurgiões (podem ser associados de outra
                // equipe) — o rótulo reflete o papel global de cada um.
                options={available.map((a) => ({
                  id: a.id,
                  name: a.name,
                  tag: a.professional_tag,
                  email: a.email,
                  roleLabel: a.role === 'MEDICAL_SURGEON' ? 'Médico Cirurgião' : 'Médico Associado',
                }))}
                placeholder={available.length ? 'Buscar por nome, tag ou e-mail…' : 'Nenhum médico disponível'}
              />
              <Button onClick={addAssociate} loading={busy} disabled={!pick} block>
                <Plus className="size-4" /> Vincular médico
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Enfermagem da equipe — recebe os alertas AMARELOS dos pacientes desta
          equipe (migration 0077). Sem teto: "um ou mais". */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Enfermagem da equipe</h3>
          <span className="text-xs font-semibold text-muted-foreground">{teamNurses.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Profissionais de enfermagem vinculados recebem e triam os alertas de atenção (amarelos) dos pacientes desta
          equipe. Os casos que precisam de médico são escalados por eles.
        </p>

        {teamNurses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum profissional de enfermagem ainda.</p>
        ) : (
          <ul className="space-y-2">
            {teamNurses.map((m) => (
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

        <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
          <span className="text-xs font-bold text-muted-foreground inline-flex items-center gap-1.5">
            <Stethoscope className="size-3.5" /> Adicionar profissional de enfermagem
          </span>
          <div className="space-y-2">
            <ProfessionalCombobox
              label="Profissional de enfermagem"
              value={nursePick}
              onChange={setNursePick}
              options={availableNurses.map((n) => ({
                id: n.id,
                name: n.name,
                tag: n.professional_tag,
                roleLabel: 'Profissional de Enfermagem',
              }))}
              placeholder={
                availableNurses.length ? 'Buscar por nome ou tag…' : 'Nenhum profissional de enfermagem disponível'
              }
            />
            <Button onClick={addNurse} loading={busy} disabled={!nursePick} block>
              <Plus className="size-4" /> Vincular enfermagem
            </Button>
          </div>
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
        {canArchive && (
          <Button variant="ghost" onClick={() => setToArchive(true)} block>
            Arquivar equipe
          </Button>
        )}
      </section>

      {toRemove && (
        <ConfirmModal
          title={`Remover ${toRemove.name}?`}
          message={
            toRemove.isNurse
              ? 'O profissional de enfermagem deixará de ter acesso a esta equipe e de receber os alertas de atenção dos pacientes dela. Os registros clínicos são preservados.'
              : 'O médico deixará de ter acesso a esta equipe. Os registros clínicos são preservados.'
          }
          confirmLabel={toRemove.isNurse ? 'Remover enfermagem' : 'Remover médico'}
          busy={busy}
          onCancel={() => setToRemove(null)}
          onConfirm={removeMember}
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
