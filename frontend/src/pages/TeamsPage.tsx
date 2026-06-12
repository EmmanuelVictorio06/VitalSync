import { useEffect, useState } from 'react';
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
    <div className="stack">
      <div>
        <h1>Cadastro de Equipes Médicas</h1>
        <p className="subtext">
          Defina as equipes sob liderança dos cirurgiões responsáveis e os médicos associados que monitoram os
          pacientes em recuperação domiciliar.
        </p>
      </div>

      {/* Nova equipe */}
      <div className="card stack">
        <div className="block-title">Nova equipe de saúde</div>
        <div className="grid grid-2">
          <TextInput
            label="Número da equipe"
            type="number"
            inputMode="numeric"
            placeholder="Ex.: 1"
            hint="Não pode repetir um número já utilizado."
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
        </div>

        <div className="block-title">Cirurgião principal (responsável)</div>
        <div className="grid grid-2">
          <TextInput label="Nome do cirurgião" value={surgeon.name} onChange={(e) => setSurgeon({ ...surgeon, name: e.target.value })} required />
          <PhoneInput value={surgeon.whatsapp} onChange={(v) => setSurgeon({ ...surgeon, whatsapp: v })} />
          <TextInput label="E-mail (login)" type="email" value={surgeon.email} onChange={(e) => setSurgeon({ ...surgeon, email: e.target.value })} required />
          <TextInput label="Senha" type="password" hint="Mínimo 6 caracteres." value={surgeon.password} onChange={(e) => setSurgeon({ ...surgeon, password: e.target.value })} required />
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          <div className="block-title" style={{ margin: 0 }}>Médicos associados</div>
          <span className="spacer" />
          <Button variant="secondary" size="sm" onClick={() => setAssociates((p) => [...p, emptyMember()])}>
            + Adicionar associado
          </Button>
        </div>
        {associates.length === 0 && <p className="muted" style={{ fontSize: '.85rem' }}>Nenhum associado adicionado ainda.</p>}
        {associates.map((m, i) => (
          <div key={i} className="card" style={{ background: 'var(--bg)' }}>
            <div className="grid grid-2">
              <TextInput label="Nome do médico" value={m.name} onChange={(e) => setAssoc(i, { name: e.target.value })} />
              <PhoneInput value={m.whatsapp} onChange={(v) => setAssoc(i, { whatsapp: v })} />
              <TextInput label="E-mail (login)" type="email" value={m.email} onChange={(e) => setAssoc(i, { email: e.target.value })} />
              <TextInput label="Senha" type="password" value={m.password} onChange={(e) => setAssoc(i, { password: e.target.value })} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAssociates((p) => p.filter((_, idx) => idx !== i))}>
              Remover associado
            </Button>
          </div>
        ))}

        <Button size="lg" onClick={createTeam} loading={saving}>
          Cadastrar equipe
        </Button>
      </div>

      {/* Equipes cadastradas */}
      <div>
        <div className="block-title">Equipes cadastradas</div>
        {loading ? (
          <p className="loading">Carregando…</p>
        ) : teams.length === 0 ? (
          <p className="empty">Nenhuma equipe cadastrada ainda.</p>
        ) : (
          <div className="grid grid-2">
            {teams.map((t) => (
              <TeamCard key={t.id} team={t} onDelete={() => setToDelete(t)} onEdit={() => setEditing(t)} />
            ))}
          </div>
        )}
      </div>

      {editing && <EditTeamModal team={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}

      {toDelete && (
        <ConfirmModal
          title={`Excluir equipe ${toDelete.number}?`}
          message="Esta ação desativa os logins dos médicos da equipe e não pode ser desfeita."
          confirmLabel="Excluir equipe"
          requireText="EXCLUIR"
          confirmInput={confirmText}
          onConfirmInputChange={setConfirmText}
          onCancel={() => { setToDelete(null); setConfirmText(''); }}
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
    <div className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="pill-day">Equipe {team.number}</div>
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">✏️ Editar</Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Excluir">🗑️</Button>
      </div>
      <div className="kv"><span>Cirurgião principal</span><span>{surgeon?.name ?? '—'}</span></div>
      <div className="kv"><span>Total de médicos</span><span>{team.members.length}</span></div>
      <div className="divider" />
      <div className="block-title">Médicos associados ({associates.length})</div>
      {associates.length === 0 ? (
        <span className="muted" style={{ fontSize: '.85rem' }}>Sem associados.</span>
      ) : (
        associates.map((a) => (
          <div key={a.id} className="kv"><span>{a.name}</span><span>{a.email}</span></div>
        ))
      )}
    </div>
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>Editar equipe {team.number}</h2>
        <TextInput label="Número da equipe" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />

        <div className="block-title">Remover associados</div>
        {associates.length === 0 && <span className="muted" style={{ fontSize: '.85rem' }}>Sem associados.</span>}
        {associates.map((a) => (
          <label key={a.id} className="kv" style={{ cursor: 'pointer' }}>
            <span>{a.name} · {a.email}</span>
            <input
              type="checkbox"
              style={{ width: 'auto', minHeight: 'auto' }}
              checked={removeIds.includes(a.id)}
              onChange={(e) => setRemoveIds((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
            />
          </label>
        ))}

        <div className="block-title">Adicionar associado</div>
        <TextInput label="Nome" value={newAssoc.name} onChange={(e) => setNewAssoc({ ...newAssoc, name: e.target.value })} />
        <TextInput label="E-mail (login)" type="email" value={newAssoc.email} onChange={(e) => setNewAssoc({ ...newAssoc, email: e.target.value })} />
        <TextInput label="Senha" type="password" value={newAssoc.password} onChange={(e) => setNewAssoc({ ...newAssoc, password: e.target.value })} />
        <PhoneInput value={newAssoc.whatsapp} onChange={(v) => setNewAssoc({ ...newAssoc, whatsapp: v })} />

        <div className="row">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <span className="spacer" />
          <Button onClick={save} loading={busy}>Salvar alterações</Button>
        </div>
      </div>
    </div>
  );
}
