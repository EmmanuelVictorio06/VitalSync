import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Users2, X } from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, PhoneInput, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { Team } from '../lib/dto';

interface MemberForm {
  name: string;
  email: string;
  password: string;
  whatsapp: string;
}
const emptyMember = (): MemberForm => ({ name: '', email: '', password: '', whatsapp: '' });

export function TeamsPage() {
  const toast = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulário de nova equipe
  const [number, setNumber] = useState('');
  const [surgeon, setSurgeon] = useState<MemberForm>(emptyMember());
  const [associates, setAssociates] = useState<MemberForm[]>([]);
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<Team | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [editing, setEditing] = useState<Team | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ items: Team[] }>('/teams');
      setTeams(res.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar equipes.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function setAssoc(i: number, patch: Partial<MemberForm>) {
    setAssociates((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function createTeam() {
    if (!number || !surgeon.name || !surgeon.email || surgeon.password.length < 6) {
      toast.error('Preencha o número da equipe e os dados do cirurgião (senha de 6+ caracteres).');
      return;
    }
    setSaving(true);
    try {
      await api.post('/teams', {
        number: Number(number),
        surgeon: { ...surgeon, whatsapp: onlyDigits(surgeon.whatsapp) },
        associates: associates.map((a) => ({ ...a, whatsapp: onlyDigits(a.whatsapp) })),
      });
      toast.success('Cadastro realizado com sucesso!');
      setNumber('');
      setSurgeon(emptyMember());
      setAssociates([]);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao cadastrar equipe.');
    } finally {
      setSaving(false);
    }
  }

  async function removeTeam() {
    if (!toDelete) return;
    try {
      await api.del(`/teams/${toDelete.id}`);
      toast.success('Equipe excluída.');
      setToDelete(null);
      setConfirmText('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir equipe.');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Cadastro de Equipes Médicas</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Defina as equipes sob liderança dos cirurgiões responsáveis e os médicos associados que monitoram os
          pacientes em recuperação domiciliar.
        </p>
      </div>

      {/* Nova equipe */}
      <form
        className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-6 animate-entry [animation-delay:100ms]"
        onSubmit={(e) => {
          e.preventDefault();
          void createTeam();
        }}
      >
        <div className="grid md:grid-cols-2 gap-4">
          <TextInput
            label="Número da equipe"
            type="number"
            inputMode="numeric"
            placeholder="Ex. 03"
            hint="Não pode repetir um número já utilizado."
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Cirurgião principal (responsável)
          </h3>
          <div className="grid md:grid-cols-2 gap-4 p-3 bg-muted/40 rounded-lg">
            <TextInput label="Nome do cirurgião" placeholder="Ex. Dr. João Silva" value={surgeon.name} onChange={(e) => setSurgeon({ ...surgeon, name: e.target.value })} required />
            <PhoneInput value={surgeon.whatsapp} onChange={(v) => setSurgeon({ ...surgeon, whatsapp: v })} />
            <TextInput label="E-mail (login)" type="email" placeholder="medico@email.com" value={surgeon.email} onChange={(e) => setSurgeon({ ...surgeon, email: e.target.value })} required />
            <TextInput label="Senha" type="password" placeholder="••••••••" hint="Mínimo 6 caracteres." value={surgeon.password} onChange={(e) => setSurgeon({ ...surgeon, password: e.target.value })} required />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Médicos associados</h3>
            <button
              type="button"
              onClick={() => setAssociates((p) => [...p, emptyMember()])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Adicionar médico associado
            </button>
          </div>
          {associates.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum associado adicionado ainda.</p>
          )}
          <div className="space-y-3">
            {associates.map((m, i) => (
              <div key={i} className="grid md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end p-3 bg-muted/40 rounded-lg">
                <TextInput label="Nome" placeholder="Nome do médico" value={m.name} onChange={(e) => setAssoc(i, { name: e.target.value })} />
                <PhoneInput hint="" value={m.whatsapp} onChange={(v) => setAssoc(i, { whatsapp: v })} />
                <TextInput label="E-mail" type="email" placeholder="medico@email.com" value={m.email} onChange={(e) => setAssoc(i, { email: e.target.value })} />
                <TextInput label="Senha" type="password" placeholder="••••••••" value={m.password} onChange={(e) => setAssoc(i, { password: e.target.value })} />
                <button
                  type="button"
                  onClick={() => setAssociates((p) => p.filter((_, idx) => idx !== i))}
                  className="size-10 rounded-md border border-border text-muted-foreground hover:text-alert hover:border-alert/40 flex items-center justify-center"
                  aria-label="Remover médico"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Cadastrar equipe
          </Button>
        </div>
      </form>

      {/* Equipes cadastradas */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Equipes cadastradas</h3>
        {loading ? (
          <p className="text-center text-muted-foreground py-8 animate-pulse">Carregando…</p>
        ) : teams.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
            <p className="font-semibold">Nenhuma equipe cadastrada ainda</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {teams.map((t) => (
              <TeamCard key={t.id} team={t} onDelete={() => setToDelete(t)} onEdit={() => setEditing(t)} />
            ))}
          </div>
        )}
      </section>

      {editing && (
        <EditTeamModal
          team={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {toDelete && (
        <ConfirmModal
          title={`Excluir equipe nº ${toDelete.number}?`}
          message="Esta ação desativa os logins dos médicos da equipe e não pode ser desfeita."
          confirmLabel="Excluir equipe"
          requireText="EXCLUIR"
          confirmInput={confirmText}
          onConfirmInputChange={setConfirmText}
          onCancel={() => {
            setToDelete(null);
            setConfirmText('');
          }}
          onConfirm={removeTeam}
        />
      )}
    </div>
  );
}

function TeamCard({ team, onEdit, onDelete }: { team: Team; onEdit: () => void; onDelete: () => void }) {
  const surgeon = team.members.find((m) => m.id === team.surgeonId);
  const associates = team.members.filter((m) => m.id !== team.surgeonId);
  return (
    <article className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Equipe nº {team.number}
          </p>
          <h4 className="font-bold text-lg mt-0.5">{surgeon?.name ?? '—'}</h4>
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1">
            <Users2 className="size-3.5" /> {associates.length} médico(s) associado(s)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="size-8 rounded-md border border-border hover:bg-muted flex items-center justify-center text-muted-foreground"
            aria-label="Editar equipe"
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={onDelete}
            className="size-8 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center"
            aria-label="Excluir equipe"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>
      <ul className="space-y-1.5 border-t border-border pt-3">
        {associates.length === 0 ? (
          <li className="text-xs text-muted-foreground">Sem associados.</li>
        ) : (
          associates.map((a) => (
            <li key={a.id} className="text-xs flex items-center justify-between gap-2">
              <span className="font-medium truncate">{a.name}</span>
              <span className="text-muted-foreground truncate">{a.email}</span>
            </li>
          ))
        )}
      </ul>
    </article>
  );
}

function EditTeamModal({ team, onClose, onSaved }: { team: Team; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [number, setNumber] = useState(String(team.number));
  const [newAssoc, setNewAssoc] = useState<MemberForm>(emptyMember());
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const associates = team.members.filter((m) => m.id !== team.surgeonId);

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (Number(number) !== team.number) payload.number = Number(number);
      if (newAssoc.name && newAssoc.email && newAssoc.password.length >= 6) {
        payload.addAssociates = [{ ...newAssoc, whatsapp: onlyDigits(newAssoc.whatsapp) }];
      }
      if (removeIds.length) payload.removeMemberIds = removeIds;
      await api.patch(`/teams/${team.id}`, payload);
      toast.success('Equipe atualizada.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md space-y-4 animate-entry my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold tracking-tight">Editar equipe {team.number}</h2>
        <TextInput label="Número da equipe" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Remover associados</h3>
          {associates.length === 0 && <span className="text-sm text-muted-foreground">Sem associados.</span>}
          <div className="space-y-1">
            {associates.map((a) => (
              <label
                key={a.id}
                className="flex items-center justify-between gap-2 text-xs font-medium bg-muted/40 rounded-md px-3 py-2 cursor-pointer"
              >
                <span className="truncate">
                  {a.name} · {a.email}
                </span>
                <input
                  type="checkbox"
                  className="accent-[#ef4444]"
                  checked={removeIds.includes(a.id)}
                  onChange={(e) =>
                    setRemoveIds((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))
                  }
                />
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Adicionar associado</h3>
          <TextInput label="Nome" value={newAssoc.name} onChange={(e) => setNewAssoc({ ...newAssoc, name: e.target.value })} />
          <TextInput label="E-mail (login)" type="email" value={newAssoc.email} onChange={(e) => setNewAssoc({ ...newAssoc, email: e.target.value })} />
          <TextInput label="Senha" type="password" value={newAssoc.password} onChange={(e) => setNewAssoc({ ...newAssoc, password: e.target.value })} />
          <PhoneInput value={newAssoc.whatsapp} onChange={(v) => setNewAssoc({ ...newAssoc, whatsapp: v })} />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy}>
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  );
}
