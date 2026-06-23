/**
 * "Minha Equipe" — exclusiva do CIRURGIÃO PRINCIPAL.
 *
 * Consome a API REAL — os MESMOS dados da tela "Gerenciar Equipes" do
 * Administrador, evitando divergência:
 *   - `GET /teams`        → o backend devolve apenas a equipe do cirurgião.
 *   - `PATCH /teams/:id`  → adiciona / edita / remove médicos associados
 *                           (o backend revalida a posse e protege o responsável).
 *   - `GET /patients`     → já é restrito à equipe do usuário (teamScope).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, BellRing, Plus, Stethoscope, Users } from 'lucide-react';
import { ClinicalStatus, onlyDigits } from '@vitalsync/shared';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { TeamMemberList } from '../components/teams';
import { Button, ConfirmModal, PhoneInput, TextInput, cn } from '../components/ui';
import { canManageTeamMembers } from '../lib/permissions';
import { api, ApiError } from '../lib/api';
import type { Paginated, PatientCardData, Team, TeamMember } from '../lib/dto';
import type { TeamDoctor } from '../lib/teams-types';

interface TeamStats {
  monitoring: number;
  stable: number;
  attention: number;
  alert: number;
}

interface MemberForm {
  name: string;
  email: string;
  whatsapp: string;
  password: string;
}
const emptyForm = (): MemberForm => ({ name: '', email: '', whatsapp: '', password: '' });

/** Converte os membros reais (DTO) para a forma exibida na lista. */
function toDoctors(team: Team): TeamDoctor[] {
  return team.members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    whatsapp: m.whatsapp,
    roleInTeam: m.id === team.surgeonId ? 'MAIN_SURGEON' : 'ASSOCIATED_DOCTOR',
  }));
}

export function MyTeamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canManage = canManageTeamMembers(user?.role);

  const [team, setTeam] = useState<Team | null>(null);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [toRemove, setToRemove] = useState<TeamDoctor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Conta cada status pelo `total` (pageSize=1) — números reais e precisos.
      const count = (status?: ClinicalStatus) =>
        api.get<Paginated<PatientCardData>>(`/patients?pageSize=1${status ? `&status=${status}` : ''}`);
      const [teamsRes, all, green, yellow, red] = await Promise.all([
        api.get<{ items: Team[] }>('/teams'),
        count(),
        count(ClinicalStatus.GREEN),
        count(ClinicalStatus.YELLOW),
        count(ClinicalStatus.RED),
      ]);
      setTeam(teamsRes.items[0] ?? null);
      setStats({ monitoring: all.total, stable: green.total, attention: yellow.total, alert: red.total });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar sua equipe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeMember() {
    if (!toRemove || !team) return;
    try {
      const res = await api.patch<{ team: Team }>(`/teams/${team.id}`, { removeMemberIds: [toRemove.id] });
      setTeam(res.team);
      toast.success('Médico removido da equipe.');
      setToRemove(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao remover médico.');
    }
  }

  if (loading)
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto w-full">
        <LoadingState label="Carregando dados da sua equipe…" />
      </div>
    );
  if (error)
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto w-full">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  if (!team)
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto w-full">
        <EmptyState title="Nenhuma equipe vinculada ao seu usuário." />
      </div>
    );

  const doctors = toDoctors(team);
  const surgeon = team.members.find((m) => m.id === team.surgeonId);
  const associates = team.members.filter((m) => m.id !== team.surgeonId);
  const cards: Array<{ label: string; value: number; tone?: string }> = [
    { label: 'Médicos associados', value: associates.length },
    { label: 'Em monitoramento', value: stats?.monitoring ?? 0 },
    { label: 'Estáveis', value: stats?.stable ?? 0, tone: 'text-stable' },
    { label: 'Em atenção', value: stats?.attention ?? 0, tone: 'text-warning' },
    { label: 'Em alerta', value: stats?.alert ?? 0, tone: 'text-alert' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Minha Equipe</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Visualize os médicos associados à sua equipe e acompanhe os pacientes vinculados.
        </p>
      </div>

      {/* Cabeçalho da equipe + resumo clínico */}
      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:100ms]">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Equipe nº {String(team.number).padStart(2, '0')}
            </p>
            <h3 className="font-bold text-lg mt-0.5 inline-flex items-center gap-1.5">
              <Stethoscope className="size-4 text-primary" /> {surgeon?.name ?? '—'}
            </h3>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/monitoring?team=${team.number}`)}>
              <Activity className="size-3.5" /> Ver pacientes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/alerts?team=${team.number}`)}>
              <BellRing className="size-3.5" /> Ver alertas
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 border-t border-border pt-4">
          {cards.map((c) => (
            <div key={c.label}>
              <p className={cn('text-2xl font-extrabold leading-none', c.tone ?? 'text-foreground')}>{c.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{c.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Médicos Associados */}
      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:150ms]">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold tracking-tight inline-flex items-center gap-2">
            <Users className="size-4 text-primary" /> Médicos Associados
          </h3>
          {canManage && (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" /> Adicionar médico
            </button>
          )}
        </div>
        <TeamMemberList
          members={doctors}
          canManage={canManage}
          onEdit={(d) => setEditing(team.members.find((m) => m.id === d.id) ?? null)}
          onRemove={(d) => setToRemove(d)}
        />
      </section>

      {(creating || editing) && (
        <MemberFormModal
          teamId={team.id}
          member={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(updated) => {
            setTeam(updated);
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {toRemove && (
        <ConfirmModal
          title={`Remover ${toRemove.name}?`}
          message="O médico perderá o acesso aos pacientes desta equipe. Esta ação desativa o login dele."
          confirmLabel="Remover médico"
          onCancel={() => setToRemove(null)}
          onConfirm={removeMember}
        />
      )}
    </div>
  );
}

/** Modal de cadastro (sem `member`) ou edição (com `member`) de associado. */
function MemberFormModal({
  teamId,
  member,
  onClose,
  onSaved,
}: {
  teamId: string;
  member: TeamMember | null;
  onClose: () => void;
  onSaved: (team: Team) => void;
}) {
  const toast = useToast();
  const isEdit = !!member;
  const [form, setForm] = useState<MemberForm>(
    member ? { name: member.name, email: member.email, whatsapp: member.whatsapp ?? '', password: '' } : emptyForm(),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim() || (!isEdit && (!form.email.trim() || form.password.length < 6))) {
      toast.error('Preencha nome, e-mail e senha (mínimo 6 caracteres).');
      return;
    }
    setBusy(true);
    try {
      const whatsapp = onlyDigits(form.whatsapp);
      const payload = isEdit
        ? { updateMembers: [{ id: member!.id, name: form.name.trim(), whatsapp, ...(form.password ? { password: form.password } : {}) }] }
        : { addAssociates: [{ name: form.name.trim(), email: form.email.trim(), password: form.password, whatsapp }] };
      const res = await api.patch<{ team: Team }>(`/teams/${teamId}`, payload);
      toast.success(isEdit ? 'Médico atualizado.' : 'Médico associado adicionado.');
      onSaved(res.team);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar médico.');
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
        <h2 className="text-lg font-extrabold tracking-tight">
          {isEdit ? 'Editar médico associado' : 'Adicionar médico associado'}
        </h2>
        <TextInput label="Nome" placeholder="Ex. Dr. João Silva" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextInput
          label="E-mail (login)"
          type="email"
          placeholder="medico@email.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          disabled={isEdit}
          hint={isEdit ? 'O e-mail de login não pode ser alterado aqui.' : undefined}
          required={!isEdit}
        />
        <PhoneInput value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} />
        <TextInput
          label={isEdit ? 'Nova senha (opcional)' : 'Senha'}
          type="password"
          placeholder="••••••••"
          hint="Mínimo 6 caracteres."
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required={!isEdit}
        />
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy}>
            {isEdit ? 'Salvar alterações' : 'Adicionar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
