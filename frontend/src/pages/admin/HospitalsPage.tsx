import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import {
  AdminPageHeader,
  AdminTable,
  EmptyState,
  ErrorState,
  LoadingState,
  RowIconButton,
  SearchBox,
  SegmentedFilter,
  StatusPill,
  ToggleSwitch,
} from '../../components/admin';
import { Button, ConfirmModal, Field, ModalOverlay, PageContainer, TextInput } from '../../components/ui';
import { hospitalService } from '../../services/hospitalService';
import type { EntityStatus, Hospital } from '../../services/types';

type StatusFilter = 'ALL' | EntityStatus;
interface HospitalForm { name: string; city: string; state: string; status: EntityStatus }
const EMPTY_FORM: HospitalForm = { name: '', city: '', state: '', status: 'ACTIVE' };

export function HospitalsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Hospital[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const [editing, setEditing] = useState<Hospital | 'new' | null>(null);
  const [toToggle, setToToggle] = useState<Hospital | null>(null);
  const [toDelete, setToDelete] = useState<Hospital | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setItems(null);
    try {
      setItems(await hospitalService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar hospitais.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (h) => (statusFilter === 'ALL' || h.status === statusFilter) && h.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search, statusFilter],
  );

  async function toggle() {
    if (!toToggle) return;
    setBusy(true);
    try {
      await hospitalService.update(toToggle.id, { status: toToggle.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      toast.success(toToggle.status === 'ACTIVE' ? 'Hospital inativado.' : 'Hospital reativado.');
      setToToggle(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar status do hospital.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await hospitalService.remove(toDelete.id);
      toast.success('Hospital excluído.');
    } catch {
      // Provável vínculo com pacientes (FK) → inativa em vez de excluir.
      try {
        await hospitalService.update(toDelete.id, { status: 'INACTIVE' });
        toast.success('Hospital vinculado a pacientes — foi inativado em vez de excluído.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir hospital.');
      }
    } finally {
      setToDelete(null);
      setBusy(false);
      await load();
    }
  }

  return (
    <PageContainer>
      <AdminPageHeader
        title="Hospitais"
        subtitle="Gerencie os hospitais disponíveis no cadastro de pacientes. Hospitais inativos não aparecem em novos cadastros."
        actionLabel="Novo Hospital"
        onAction={() => setEditing('new')}
      />

      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col md:flex-row gap-3 animate-entry [animation-delay:100ms]">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome do hospital..." />
        <SegmentedFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'ALL', label: 'Todos' },
            { value: 'ACTIVE', label: 'Ativos' },
            { value: 'INACTIVE', label: 'Inativos' },
          ]}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items === null ? (
        <LoadingState label="Carregando hospitais…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum hospital encontrado" hint="Ajuste a busca ou cadastre um novo hospital." />
      ) : (
        <div className="animate-entry [animation-delay:150ms]">
          <AdminTable
            rows={filtered}
            keyFor={(h) => h.id}
            columns={[
              { header: 'Hospital', render: (h) => <p className="font-semibold truncate">{h.name}</p> },
              { header: 'Cidade', render: (h) => h.city || '—' },
              { header: 'Estado', render: (h) => h.state || '—' },
              { header: 'Status', render: (h) => <StatusPill status={h.status} /> },
              { header: 'Cadastro', hideOnMobile: true, render: (h) => <span className="text-muted-foreground font-mono text-xs">{h.created_at.slice(0, 10)}</span> },
            ]}
            actions={(h) => (
              <>
                <RowIconButton label="Editar" onClick={() => setEditing(h)}>
                  <Pencil className="size-4" />
                </RowIconButton>
                <RowIconButton label={h.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} onClick={() => setToToggle(h)}>
                  <Power className="size-4" />
                </RowIconButton>
                <RowIconButton label="Excluir" danger onClick={() => setToDelete(h)}>
                  <Trash2 className="size-4" />
                </RowIconButton>
              </>
            )}
          />
        </div>
      )}

      {editing && (
        <HospitalFormModal
          hospital={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            toast.success(msg);
            setEditing(null);
            await load();
          }}
        />
      )}

      {toToggle && (
        <ConfirmModal
          title={toToggle.status === 'ACTIVE' ? `Inativar ${toToggle.name}?` : `Reativar ${toToggle.name}?`}
          message={
            toToggle.status === 'ACTIVE'
              ? 'Hospitais inativos deixam de aparecer no cadastro de novos pacientes.'
              : 'O hospital voltará a aparecer no cadastro de novos pacientes.'
          }
          confirmLabel={toToggle.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}
          busy={busy}
          onCancel={() => setToToggle(null)}
          onConfirm={toggle}
        />
      )}

      {toDelete && (
        <ConfirmModal
          title={`Excluir ${toDelete.name}?`}
          message="Se estiver vinculado a pacientes, será inativado em vez de excluído."
          confirmLabel="Excluir hospital"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </PageContainer>
  );
}

function HospitalFormModal({
  hospital,
  onClose,
  onSaved,
}: {
  hospital: Hospital | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<HospitalForm>(
    hospital ? { name: hospital.name, city: hospital.city ?? '', state: hospital.state ?? '', status: hospital.status } : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState('');

  function set<K extends keyof HospitalForm>(k: K, v: HospitalForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError('Informe o nome do hospital.');
      return;
    }
    setBusy(true);
    try {
      if (hospital) {
        await hospitalService.update(hospital.id, { name: form.name, city: form.city, state: form.state, status: form.status });
        onSaved('Hospital atualizado com sucesso.');
      } else {
        await hospitalService.create({ name: form.name, city: form.city, state: form.state });
        onSaved('Hospital cadastrado com sucesso.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar hospital.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} className="z-50 bg-foreground/50 backdrop-blur-sm items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={save} className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-lg space-y-4 animate-entry my-8">
        <h2 className="text-lg font-extrabold tracking-tight">{hospital ? `Editar ${hospital.name}` : 'Novo Hospital'}</h2>
        <TextInput
          label="Nome do hospital"
          required
          placeholder="Ex. Hospital Santa Casa"
          value={form.name}
          error={nameError}
          onChange={(e) => {
            set('name', e.target.value);
            setNameError('');
          }}
        />
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <TextInput label="Cidade" placeholder="Ex. Curitiba" value={form.city} onChange={(e) => set('city', e.target.value)} />
          <TextInput label="Estado (UF)" placeholder="Ex. PR" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />
        </div>
        {hospital && (
          <Field label="Status">
            <ToggleSwitch checked={form.status === 'ACTIVE'} onChange={(v) => set('status', v ? 'ACTIVE' : 'INACTIVE')} label={form.status === 'ACTIVE' ? 'Ativo' : 'Inativo'} />
          </Field>
        )}
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            {hospital ? 'Salvar alterações' : 'Cadastrar hospital'}
          </Button>
        </div>
      </form>
    </ModalOverlay>
  );
}
