/**
 * "Gerenciar Equipes" — Administrador. Dados reais do Supabase.
 *
 * Cria equipes (escolhendo um cirurgião responsável já cadastrado) e vincula
 * médicos associados (perfis existentes). Criar CONTAS de médico (auth.users)
 * exige privilégio de admin e será feito por Edge Function — por ora, os
 * profissionais devem existir (criados no painel Authentication do Supabase).
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Users2 } from 'lucide-react';
import { useToast } from '../components/Toast';
import { Button, SelectField, TextInput } from '../components/ui';
import { EmptyState, LoadingState } from '../components/admin';
import { profileService } from '../services/profileService';
import { teamService } from '../services/teamService';
import { teamViewService, type TeamDetail } from '../services/teamViewService';
import type { Profile } from '../services/types';

export function TeamsPage() {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [surgeons, setSurgeons] = useState<Profile[]>([]);
  const [associates, setAssociates] = useState<Profile[]>([]);

  const [number, setNumber] = useState('');
  const [surgeonId, setSurgeonId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setTeams(null);
    try {
      const [summaries, mains, assocs] = await Promise.all([
        teamViewService.listMyTeams(),
        profileService.listByRole('MAIN_SURGEON'),
        profileService.listByRole('ASSOCIATED_DOCTOR'),
      ]);
      setSurgeons(mains);
      setAssociates(assocs);
      setTeams(await Promise.all(summaries.map((s) => teamViewService.getTeamDetail(s.id))));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar equipes.');
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTeam() {
    if (!number || !surgeonId) {
      toast.error('Informe o número da equipe e o cirurgião responsável.');
      return;
    }
    setSaving(true);
    try {
      await teamService.create({ team_number: Number(number), main_surgeon_id: surgeonId });
      toast.success('Equipe criada.');
      setNumber('');
      setSurgeonId('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar equipe.');
    } finally {
      setSaving(false);
    }
  }

  async function addAssociate(teamId: string, doctorId: string) {
    if (!doctorId) return;
    try {
      await teamService.addMember({ team_id: teamId, doctor_id: doctorId });
      toast.success('Médico vinculado à equipe.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao vincular médico.');
    }
  }

  async function removeMember(membershipId: string) {
    try {
      await teamService.removeMember(membershipId);
      toast.success('Médico removido da equipe.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover médico.');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Gerenciar Equipes</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Crie equipes sob um cirurgião responsável e vincule médicos associados. Os profissionais devem já estar
          cadastrados (Authentication do Supabase).
        </p>
      </div>

      {/* Nova equipe */}
      <form
        className="bg-card rounded-xl border border-border shadow-sm p-6 grid md:grid-cols-[160px_1fr_auto] gap-4 items-end animate-entry [animation-delay:100ms]"
        onSubmit={(e) => {
          e.preventDefault();
          void createTeam();
        }}
      >
        <TextInput label="Número da equipe" type="number" inputMode="numeric" placeholder="Ex. 02" value={number} onChange={(e) => setNumber(e.target.value)} required />
        <SelectField
          label="Cirurgião responsável"
          value={surgeonId}
          onChange={(e) => setSurgeonId(e.target.value)}
          options={surgeons.map((s) => ({ value: s.id, label: s.name }))}
          placeholder={surgeons.length ? 'Selecione…' : 'Nenhum cirurgião cadastrado'}
          required
        />
        <Button type="submit" loading={saving}>
          <Plus className="size-4" /> Criar equipe
        </Button>
      </form>

      {/* Equipes cadastradas */}
      {teams === null ? (
        <LoadingState label="Carregando equipes cadastradas…" />
      ) : teams.length === 0 ? (
        <EmptyState title="Nenhuma equipe cadastrada ainda." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {teams.map((t) => (
            <TeamAdminCard
              key={t.summary.id}
              detail={t}
              associates={associates}
              onAdd={(docId) => addAssociate(t.summary.id, docId)}
              onRemove={removeMember}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamAdminCard({
  detail, associates, onAdd, onRemove,
}: {
  detail: TeamDetail;
  associates: Profile[];
  onAdd: (doctorId: string) => void;
  onRemove: (membershipId: string) => void;
}) {
  const [pick, setPick] = useState('');
  const memberIds = new Set(detail.members.map((m) => m.id));
  const available = associates.filter((a) => !memberIds.has(a.id));

  return (
    <article className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Equipe nº {String(detail.summary.number).padStart(2, '0')}
        </p>
        <h4 className="font-bold text-lg mt-0.5">{detail.summary.surgeonName}</h4>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1">
          <Users2 className="size-3.5" /> {detail.members.length} médico(s) · {detail.summary.stats.monitoring} paciente(s)
        </p>
      </header>

      <ul className="space-y-1.5 border-t border-border pt-3">
        {detail.members.map((m) => (
          <li key={m.id} className="text-xs flex items-center justify-between gap-2">
            <span className="truncate">
              <span className="font-medium">{m.name}</span>
              {m.isSurgeon && <span className="ml-1.5 text-[9px] font-bold uppercase text-primary">resp.</span>}
              <span className="text-muted-foreground"> · {m.email}</span>
            </span>
            {!m.isSurgeon && m.membershipId && (
              <button onClick={() => onRemove(m.membershipId!)} className="size-7 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center shrink-0" aria-label={`Remover ${m.name}`}>
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2 border-t border-border pt-3">
        <select className="input !py-2 flex-1 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{available.length ? 'Vincular médico associado…' : 'Nenhum associado disponível'}</option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={!pick}
          onClick={() => {
            onAdd(pick);
            setPick('');
          }}
        >
          <Plus className="size-3.5" /> Vincular
        </Button>
      </div>
    </article>
  );
}
