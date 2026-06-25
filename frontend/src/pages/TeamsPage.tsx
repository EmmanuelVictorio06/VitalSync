/**
 * "Gerenciar Equipes Médicas" — exclusivo do Administrador.
 *
 * Cadastra, edita, ativa/inativa e exclui equipes; define o cirurgião principal
 * e os médicos associados (escolhendo perfis existentes ou criando contas de
 * login na hora). Tudo com dados reais do Supabase; o RLS/RPC revalida no
 * servidor. As ações administrativas são auditadas por triggers (audit_logs).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Power,
  Stethoscope,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  Users2,
  X,
} from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, PageContainer, PageHeader, SelectField, StatusBadge, TextInput } from '../components/ui';
import { EmptyState, ErrorState, LoadingState, SearchBox, SegmentedFilter } from '../components/admin';
import {
  AccessDenied,
  ContactLine,
  EMPTY_DOCTOR,
  ModeTabs,
  NewDoctorFields,
  StatusTeamBadge,
  SummaryCard,
  monitoringDayFrom,
  validateNewDoctor,
  type NewDoctorDraft,
} from '../components/teams-admin';
import { permissionService } from '../services/permissionService';
import { profileService } from '../services/profileService';
import { teamService, type AdminTeamSummary } from '../services/teamService';
import { teamViewService, type TeamDetail } from '../services/teamViewService';
import type { Profile } from '../services/types';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export function TeamsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { teamId: deepLinkTeamId } = useParams<{ teamId?: string }>();

  const [summary, setSummary] = useState<AdminTeamSummary | null>(null);
  const [teams, setTeams] = useState<TeamDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surgeons, setSurgeons] = useState<Profile[]>([]);
  const [associates, setAssociates] = useState<Profile[]>([]);

  // Filtros
  const [fNumber, setFNumber] = useState('');
  const [fSurgeon, setFSurgeon] = useState('');
  const [fAssociate, setFAssociate] = useState('');
  const [fStatus, setFStatus] = useState<StatusFilter>('ALL');
  const [fOnlyAlerts, setFOnlyAlerts] = useState(false);

  // Modais
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toToggle, setToToggle] = useState<TeamDetail | null>(null);
  const [toDelete, setToDelete] = useState<TeamDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setTeams(null);
    try {
      const [sum, summaries, mains, assocs] = await Promise.all([
        teamService.getAdminTeamSummary(),
        teamViewService.listMyTeams(),
        profileService.getMainSurgeons(),
        profileService.getAssociatedDoctors(),
      ]);
      setSummary(sum);
      setSurgeons(mains);
      setAssociates(assocs);
      setTeams(await Promise.all(summaries.map((s) => teamViewService.getTeamDetail(s.id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as equipes. Tente novamente.');
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    if (permissionService.canManageTeams(user)) void load();
  }, [load, user]);

  // Deep-link a partir de "Gerenciar Usuários": /admin/teams/:teamId abre os detalhes.
  useEffect(() => {
    if (deepLinkTeamId && teams?.some((t) => t.summary.id === deepLinkTeamId)) setOpenId(deepLinkTeamId);
  }, [deepLinkTeamId, teams]);

  const filtered = useMemo(() => {
    if (!teams) return [];
    const num = fNumber.trim();
    const sur = fSurgeon.trim().toLowerCase();
    const ass = fAssociate.trim().toLowerCase();
    return teams.filter((t) => {
      if (num && !String(t.summary.number).includes(onlyDigits(num))) return false;
      if (sur && !t.summary.surgeonName.toLowerCase().includes(sur)) return false;
      if (ass && !t.members.some((m) => !m.isSurgeon && m.name.toLowerCase().includes(ass))) return false;
      if (fStatus !== 'ALL' && t.summary.status !== fStatus) return false;
      if (fOnlyAlerts && t.summary.stats.unattendedAlerts === 0 && t.summary.stats.alert === 0) return false;
      return true;
    });
  }, [teams, fNumber, fSurgeon, fAssociate, fStatus, fOnlyAlerts]);

  const hasFilters = !!(fNumber || fSurgeon || fAssociate || fStatus !== 'ALL' || fOnlyAlerts);
  function clearFilters() {
    setFNumber('');
    setFSurgeon('');
    setFAssociate('');
    setFStatus('ALL');
    setFOnlyAlerts(false);
  }

  const openTeam = openId ? (teams ?? []).find((t) => t.summary.id === openId) ?? null : null;

  async function toggleStatus() {
    if (!toToggle) return;
    const active = toToggle.summary.status === 'ACTIVE';
    setBusy(true);
    try {
      if (active) await teamService.inactivateTeam(toToggle.summary.id);
      else await teamService.activateTeam(toToggle.summary.id);
      toast.success(active ? 'Equipe inativada.' : 'Equipe ativada com sucesso.');
      setToToggle(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar o status da equipe.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await teamService.deleteTeam(toDelete.summary.id);
      if (res.kind === 'deleted') toast.success('Equipe excluída.');
      else toast.info(res.reason);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível excluir a equipe.');
    } finally {
      setBusy(false);
    }
  }

  if (!permissionService.canManageTeams(user)) return <AccessDenied />;

  return (
    <PageContainer>
      <PageHeader
        title="Gerenciar Equipes Médicas"
        subtitle="Cadastre, edite e acompanhe as equipes responsáveis pelo monitoramento pós-operatório dos pacientes."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nova Equipe
          </Button>
        }
      />

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 animate-entry [animation-delay:80ms]">
        <SummaryCard label="Total de equipes" value={summary?.totalTeams ?? 0} icon={<Users className="size-5" />} />
        <SummaryCard label="Equipes ativas" value={summary?.activeTeams ?? 0} icon={<CheckCircle2 className="size-5" />} tone="stable" />
        <SummaryCard label="Cirurgiões principais" value={summary?.mainSurgeons ?? 0} icon={<Stethoscope className="size-5" />} />
        <SummaryCard label="Médicos associados" value={summary?.associatedDoctors ?? 0} icon={<UserCog className="size-5" />} tone="muted" />
        <SummaryCard label="Pacientes vinculados" value={summary?.linkedPatients ?? 0} icon={<Activity className="size-5" />} />
        <SummaryCard label="Equipes com alertas" value={summary?.teamsWithAlerts ?? 0} icon={<BellRing className="size-5" />} tone="alert" />
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 space-y-3 animate-entry [animation-delay:120ms]">
        <div className="flex flex-col md:flex-row gap-3">
          <SearchBox value={fNumber} onChange={setFNumber} placeholder="Buscar por número da equipe..." />
          <SearchBox value={fSurgeon} onChange={setFSurgeon} placeholder="Buscar por cirurgião principal..." />
          <SearchBox value={fAssociate} onChange={setFAssociate} placeholder="Buscar por médico associado..." />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedFilter
              value={fStatus}
              onChange={setFStatus}
              options={[
                { value: 'ALL', label: 'Todas' },
                { value: 'ACTIVE', label: 'Ativas' },
                { value: 'INACTIVE', label: 'Inativas' },
              ]}
            />
            <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
              <input type="checkbox" className="size-4 accent-alert" checked={fOnlyAlerts} onChange={(e) => setFOnlyAlerts(e.target.checked)} />
              Com pacientes em alerta
            </label>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm font-semibold text-primary hover:underline self-start">
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Listagem */}
      <section className="space-y-3">
        <h3 className="font-bold tracking-tight">Equipes Cadastradas</h3>
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : teams === null ? (
          <LoadingState label="Carregando equipes médicas..." />
        ) : teams.length === 0 ? (
          <EmptyState title="Nenhuma equipe cadastrada ainda." hint="Clique em “Nova Equipe” para começar." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhuma equipe encontrada para os filtros selecionados." />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((t) => (
              <TeamCard
                key={t.summary.id}
                detail={t}
                onView={() => setOpenId(t.summary.id)}
                onToggle={() => setToToggle(t)}
                onDelete={() => setToDelete(t)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Modais */}
      {creating && (
        <TeamFormModal
          surgeons={surgeons}
          associates={associates}
          existingNumbers={(teams ?? []).map((t) => t.summary.number)}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            toast.success('Equipe cadastrada com sucesso.');
            await load();
          }}
        />
      )}

      {openTeam && (
        <TeamDetailsModal
          detail={openTeam}
          surgeons={surgeons}
          associates={associates}
          existingNumbers={(teams ?? []).map((t) => t.summary.number)}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}

      {toToggle && (
        <ConfirmModal
          title={toToggle.summary.status === 'ACTIVE' ? `Inativar a equipe nº ${pad(toToggle.summary.number)}?` : `Ativar a equipe nº ${pad(toToggle.summary.number)}?`}
          message={
            toToggle.summary.status === 'ACTIVE'
              ? 'Tem certeza que deseja inativar esta equipe? Ela não poderá receber novos pacientes, mas os dados históricos serão preservados.'
              : 'A equipe voltará a ficar disponível para o cadastro de novos pacientes.'
          }
          confirmLabel={toToggle.summary.status === 'ACTIVE' ? 'Inativar equipe' : 'Ativar equipe'}
          busy={busy}
          onCancel={() => setToToggle(null)}
          onConfirm={toggleStatus}
        />
      )}

      {toDelete && (
        <ConfirmModal
          title={`Excluir a equipe nº ${pad(toDelete.summary.number)}?`}
          message="Esta ação não poderá ser desfeita. Se a equipe possuir pacientes ou registros vinculados, por segurança ela será apenas inativada. Deseja realmente excluir esta equipe?"
          confirmLabel="Excluir equipe"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </PageContainer>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/* ============================ Card da equipe ============================ */
function TeamCard({
  detail,
  onView,
  onToggle,
  onDelete,
}: {
  detail: TeamDetail;
  onView: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { summary, members, patients } = detail;
  const surgeon = members.find((m) => m.isSurgeon);
  const associatesCount = members.filter((m) => !m.isSurgeon).length;
  const active = summary.status === 'ACTIVE';

  return (
    <article className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Equipe nº {pad(summary.number)}</p>
          <h4 className="font-bold text-lg mt-0.5 truncate">{summary.surgeonName}</h4>
          <ContactLine email={surgeon?.email} whatsapp={surgeon?.whatsapp} />
        </div>
        <StatusTeamBadge active={active} />
      </header>

      <div className="grid grid-cols-3 gap-2 text-center border-y border-border py-3">
        <Metric label="Associados" value={associatesCount} />
        <Metric label="Pacientes" value={patients.length} />
        <Metric label="Em alerta" value={summary.stats.alert} tone={summary.stats.alert > 0 ? 'alert' : 'muted'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-stable" /> {summary.stats.stable} estável(is)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-warning" /> {summary.stats.attention} em atenção
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-alert" /> {summary.stats.alert} em alerta
        </span>
      </div>

      <footer className="flex items-center gap-2 border-t border-border pt-3 mt-auto">
        <Button variant="secondary" size="sm" onClick={onView}>
          <Eye className="size-3.5" /> Ver detalhes
        </Button>
        <Button variant="ghost" size="sm" onClick={onView}>
          <Pencil className="size-3.5" /> Editar
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onToggle} title={active ? 'Inativar' : 'Ativar'} aria-label={active ? 'Inativar' : 'Ativar'} className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center">
            <Power className="size-4" />
          </button>
          <button onClick={onDelete} title="Excluir" aria-label="Excluir" className="size-8 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center">
            <Trash2 className="size-4" />
          </button>
        </div>
      </footer>
    </article>
  );
}

function Metric({ label, value, tone = 'primary' }: { label: string; value: number; tone?: 'primary' | 'alert' | 'muted' }) {
  const color = tone === 'alert' ? 'text-alert' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div>
      <p className={`text-xl font-extrabold leading-none ${color}`}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

/* ======================= Modal: nova equipe ======================= */
function TeamFormModal({
  surgeons,
  associates,
  existingNumbers,
  onClose,
  onSaved,
}: {
  surgeons: Profile[];
  associates: Profile[];
  existingNumbers: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [surgeonMode, setSurgeonMode] = useState<'existing' | 'new'>(surgeons.length ? 'existing' : 'new');
  const [surgeonId, setSurgeonId] = useState('');
  const [surgeonDraft, setSurgeonDraft] = useState<NewDoctorDraft>(EMPTY_DOCTOR);
  const [assocEntries, setAssocEntries] = useState<AssocEntry[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(onlyDigits(number));
    if (!num) return toast.error('Informe o número da equipe.');
    if (existingNumbers.includes(num)) return toast.error('Número de equipe já utilizado.');

    if (surgeonMode === 'existing' && !surgeonId) return toast.error('Informe o nome do cirurgião principal.');
    if (surgeonMode === 'new') {
      const err = validateNewDoctor(surgeonDraft);
      if (err) return toast.error(err);
    }
    for (const a of assocEntries) {
      if (a.mode === 'existing' && !a.id) return toast.error('Selecione o médico associado ou remova a linha.');
      if (a.mode === 'new') {
        const err = validateNewDoctor(a.draft);
        if (err) return toast.error(err);
      }
    }

    setBusy(true);
    try {
      // 1) cirurgião principal (existente ou novo)
      const mainSurgeonId =
        surgeonMode === 'existing'
          ? surgeonId
          : await profileService.createDoctorProfile({
              name: surgeonDraft.name.trim(),
              email: surgeonDraft.email.trim(),
              password: surgeonDraft.password,
              whatsapp: onlyDigits(surgeonDraft.whatsapp),
              role: 'MAIN_SURGEON',
            });

      // 2) cria a equipe
      const team = await teamService.create({ team_number: num, main_surgeon_id: mainSurgeonId });

      // 3) vincula os médicos associados (existentes ou novos)
      const seen = new Set<string>();
      for (const a of assocEntries) {
        const docId =
          a.mode === 'existing'
            ? a.id
            : await profileService.createDoctorProfile({
                name: a.draft.name.trim(),
                email: a.draft.email.trim(),
                password: a.draft.password,
                whatsapp: onlyDigits(a.draft.whatsapp),
                role: 'ASSOCIATED_DOCTOR',
              });
        if (seen.has(docId)) continue; // evita duplicidade na mesma equipe
        seen.add(docId);
        await teamService.addMember({ team_id: team.id, doctor_id: docId });
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível cadastrar a equipe. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Nova Equipe Médica" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <TextInput
          label="Número da equipe"
          required
          type="number"
          inputMode="numeric"
          placeholder="Ex. 03"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />

        {/* Cirurgião principal */}
        <fieldset className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">Cirurgião Principal</span>
            <ModeTabs
              value={surgeonMode}
              onChange={setSurgeonMode}
              options={[
                { value: 'existing', label: 'Selecionar existente' },
                { value: 'new', label: 'Cadastrar novo' },
              ]}
            />
          </div>
          {surgeonMode === 'existing' ? (
            <SelectField
              label="Cirurgião"
              value={surgeonId}
              onChange={(e) => setSurgeonId(e.target.value)}
              options={surgeons.map((s) => ({ value: s.id, label: s.name }))}
              placeholder={surgeons.length ? 'Selecione…' : 'Nenhum cirurgião cadastrado'}
              required
            />
          ) : (
            <NewDoctorFields value={surgeonDraft} onChange={setSurgeonDraft} />
          )}
        </fieldset>

        {/* Médicos associados */}
        <fieldset className="space-y-3">
          <span className="text-sm font-bold">Médicos Associados</span>
          {assocEntries.map((a, i) => (
            <AssocEntryFields
              key={a.key}
              entry={a}
              associates={associates}
              onChange={(next) => setAssocEntries((list) => list.map((x) => (x.key === a.key ? next : x)))}
              onRemove={() => setAssocEntries((list) => list.filter((x) => x.key !== a.key))}
              index={i}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAssocEntries((list) => [...list, newAssocEntry(associates.length > 0)])}
          >
            <Plus className="size-3.5" /> Adicionar médico associado
          </Button>
        </fieldset>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Cadastrar equipe
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

interface AssocEntry {
  key: string;
  mode: 'existing' | 'new';
  id: string;
  draft: NewDoctorDraft;
}
function newAssocEntry(canExisting: boolean): AssocEntry {
  return { key: Math.random().toString(36).slice(2), mode: canExisting ? 'existing' : 'new', id: '', draft: EMPTY_DOCTOR };
}

function AssocEntryFields({
  entry,
  associates,
  onChange,
  onRemove,
  index,
}: {
  entry: AssocEntry;
  associates: Profile[];
  onChange: (next: AssocEntry) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted-foreground">Médico associado {index + 1}</span>
        <div className="flex items-center gap-2">
          <ModeTabs
            value={entry.mode}
            onChange={(mode) => onChange({ ...entry, mode })}
            options={[
              { value: 'existing', label: 'Existente' },
              { value: 'new', label: 'Novo' },
            ]}
          />
          <button type="button" onClick={onRemove} className="size-7 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center" aria-label="Remover">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {entry.mode === 'existing' ? (
        <SelectField
          label="Médico"
          value={entry.id}
          onChange={(e) => onChange({ ...entry, id: e.target.value })}
          options={associates.map((a) => ({ value: a.id, label: a.name }))}
          placeholder={associates.length ? 'Selecione…' : 'Nenhum médico associado cadastrado'}
        />
      ) : (
        <NewDoctorFields value={entry.draft} onChange={(draft) => onChange({ ...entry, draft })} />
      )}
    </div>
  );
}

/* ===================== Modal: detalhes + edição ===================== */
function TeamDetailsModal({
  detail,
  surgeons,
  associates,
  existingNumbers,
  onClose,
  onChanged,
}: {
  detail: TeamDetail;
  surgeons: Profile[];
  associates: Profile[];
  existingNumbers: number[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { summary, members, patients } = detail;
  const surgeon = members.find((m) => m.isSurgeon);
  const active = summary.status === 'ACTIVE';

  const [number, setNumber] = useState(String(summary.number));
  const [surgeonId, setSurgeonId] = useState(surgeon?.id ?? '');
  const [savingTeam, setSavingTeam] = useState(false);

  // Adicionar associado
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing');
  const [pick, setPick] = useState('');
  const [draft, setDraft] = useState<NewDoctorDraft>(EMPTY_DOCTOR);
  const [adding, setAdding] = useState(false);

  const memberIds = new Set(members.map((m) => m.id));
  const available = associates.filter((a) => !memberIds.has(a.id));

  async function saveTeam() {
    const num = Number(onlyDigits(number));
    if (!num) return toast.error('Informe o número da equipe.');
    if (num !== summary.number && existingNumbers.includes(num)) return toast.error('Número de equipe já utilizado.');
    if (!surgeonId) return toast.error('Não é possível deixar a equipe sem cirurgião principal.');

    const patch: Record<string, unknown> = {};
    if (num !== summary.number) patch.team_number = num;
    if (surgeonId !== (surgeon?.id ?? '')) patch.main_surgeon_id = surgeonId;
    if (Object.keys(patch).length === 0) return toast.info('Nenhuma alteração para salvar.');

    setSavingTeam(true);
    try {
      await teamService.updateTeam(summary.id, patch);
      toast.success('Equipe atualizada com sucesso.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSavingTeam(false);
    }
  }

  async function toggleStatus() {
    setSavingTeam(true);
    try {
      if (active) await teamService.inactivateTeam(summary.id);
      else await teamService.activateTeam(summary.id);
      toast.success(active ? 'Equipe inativada.' : 'Equipe ativada com sucesso.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar o status.');
    } finally {
      setSavingTeam(false);
    }
  }

  async function addAssociate() {
    setAdding(true);
    try {
      let docId = pick;
      if (addMode === 'new') {
        const err = validateNewDoctor(draft);
        if (err) {
          toast.error(err);
          setAdding(false);
          return;
        }
        docId = await profileService.createDoctorProfile({
          name: draft.name.trim(),
          email: draft.email.trim(),
          password: draft.password,
          whatsapp: onlyDigits(draft.whatsapp),
          role: 'ASSOCIATED_DOCTOR',
        });
      }
      if (!docId) {
        toast.error('Selecione um médico para vincular.');
        setAdding(false);
        return;
      }
      if (memberIds.has(docId)) {
        toast.error('Este médico já está vinculado à equipe.');
        setAdding(false);
        return;
      }
      await teamService.addMember({ team_id: summary.id, doctor_id: docId });
      toast.success('Médico associado adicionado.');
      setPick('');
      setDraft(EMPTY_DOCTOR);
      setAddMode('existing');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível vincular o médico.');
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(membershipId: string) {
    try {
      await teamService.removeMember(membershipId);
      toast.success('Médico associado removido.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível remover o médico.');
    }
  }

  return (
    <ModalShell title={`Detalhes da Equipe nº ${pad(summary.number)}`} onClose={onClose} wide>
      <div className="space-y-6">
        {/* Status + número + ações de equipe */}
        <section className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex items-end gap-3">
            <div className="w-32">
              <TextInput label="Número da equipe" type="number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <StatusTeamBadge active={active} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleStatus} loading={savingTeam}>
              <Power className="size-3.5" /> {active ? 'Inativar' : 'Ativar'}
            </Button>
            <Button size="sm" onClick={saveTeam} loading={savingTeam}>
              Salvar alterações
            </Button>
          </div>
        </section>

        {/* Cirurgião principal */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold">Cirurgião Principal</h3>
          <div className="rounded-lg border border-border p-3 space-y-3">
            {surgeon && (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{surgeon.name}</p>
                  <ContactLine email={surgeon.email} whatsapp={surgeon.whatsapp} />
                </div>
              </div>
            )}
            <SelectField
              label="Trocar cirurgião principal"
              value={surgeonId}
              onChange={(e) => setSurgeonId(e.target.value)}
              options={surgeons.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Selecione…"
              hint="Ao salvar, o novo cirurgião passa a ser o responsável pela equipe."
            />
          </div>
        </section>

        {/* Médicos associados */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold">
            Médicos Associados <span className="text-muted-foreground font-normal">({members.filter((m) => !m.isSurgeon).length})</span>
          </h3>
          <ul className="space-y-2">
            {members.filter((m) => !m.isSurgeon).length === 0 && (
              <li className="text-sm text-muted-foreground">Nenhum médico associado vinculado.</li>
            )}
            {members
              .filter((m) => !m.isSurgeon)
              .map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{m.name}</p>
                    <ContactLine email={m.email} whatsapp={m.whatsapp} />
                  </div>
                  {m.membershipId && (
                    <button onClick={() => removeMember(m.membershipId!)} className="size-8 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center shrink-0" aria-label={`Remover ${m.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
          </ul>

          {/* Adicionar associado */}
          <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground inline-flex items-center gap-1.5">
                <UserPlus className="size-3.5" /> Adicionar médico associado
              </span>
              <ModeTabs
                value={addMode}
                onChange={setAddMode}
                options={[
                  { value: 'existing', label: 'Existente' },
                  { value: 'new', label: 'Novo' },
                ]}
              />
            </div>
            {addMode === 'existing' ? (
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1">
                  <SelectField
                    label="Médico"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    options={available.map((a) => ({ value: a.id, label: a.name }))}
                    placeholder={available.length ? 'Selecione…' : 'Nenhum associado disponível'}
                  />
                </div>
                <Button onClick={addAssociate} loading={adding} disabled={!pick}>
                  <Plus className="size-4" /> Vincular
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <NewDoctorFields value={draft} onChange={setDraft} />
                <div className="flex justify-end">
                  <Button onClick={addAssociate} loading={adding}>
                    <Plus className="size-4" /> Cadastrar e vincular
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Pacientes vinculados */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold">
            Pacientes vinculados <span className="text-muted-foreground font-normal">({patients.length})</span>
          </h3>
          {patients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum paciente vinculado a esta equipe.</p>
          ) : (
            <ul className="space-y-2">
              {patients.map((p) => {
                const day = monitoringDayFrom(p.dischargeDate);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.surgeryType}
                        {p.dischargeDate && ` · alta ${p.dischargeDate.slice(0, 10)}`}
                        {day != null && ` · dia ${day} de monitoramento`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={p.status} />
                      <Link to={`/patients/${p.id}`} className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                        <Users2 className="size-3.5" /> Acompanhar
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ModalShell>
  );
}

/* ============================ Shell de modal ============================ */
function ModalShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`bg-card border border-border rounded-xl shadow-lg p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} space-y-4 animate-entry my-8`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button onClick={onClose} className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center shrink-0" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
