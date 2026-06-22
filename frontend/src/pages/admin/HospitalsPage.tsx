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
import { Button, ConfirmModal, Field, TextInput } from '../../components/ui';
import { AdminApiError, hospitalsApi } from '../../lib/admin-api';
import type { EntityStatus, Hospital, HospitalInput } from '../../lib/admin-types';

type StatusFilter = 'ALL' | EntityStatus;

const EMPTY_FORM: HospitalInput = { name: '', city: '', state: '', address: '', phone: '', status: 'ACTIVE' };

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
      setItems(await hospitalsApi.list());
    } catch {
      setError('Erro ao carregar hospitais.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (h) =>
          (statusFilter === 'ALL' || h.status === statusFilter) &&
          h.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search, statusFilter],
  );

  async function toggle() {
    if (!toToggle) return;
    setBusy(true);
    try {
      await hospitalsApi.toggleStatus(toToggle.id);
      toast.success(toToggle.status === 'ACTIVE' ? 'Hospital inativado.' : 'Hospital reativado.');
      setToToggle(null);
      await load();
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : 'Erro ao alterar status do hospital.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await hospitalsApi.remove(toDelete.id);
      toast.success(
        res.inactivated
          ? 'Este hospital já está vinculado a pacientes. Ele foi inativado em vez de excluído.'
          : 'Hospital excluído.',
      );
      setToDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : 'Erro ao excluir hospital.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      <AdminPageHeader
        title="Hospitais"
        subtitle="Gerencie os hospitais disponíveis para vínculo nos cadastros de pacientes e procedimentos cirúrgicos. Hospitais inativos não aparecem no cadastro de novos pacientes."
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
              {
                header: 'Hospital',
                render: (h) => (
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{h.name}</p>
                    {h.linkedPatients > 0 && (
                      <p className="text-[10px] text-muted-foreground">{h.linkedPatients} paciente(s) vinculado(s)</p>
                    )}
                  </div>
                ),
              },
              { header: 'Cidade', render: (h) => h.city || '—' },
              { header: 'Estado', render: (h) => h.state || '—' },
              { header: 'Status', render: (h) => <StatusPill status={h.status} /> },
              {
                header: 'Cadastro',
                hideOnMobile: true,
                render: (h) => <span className="text-muted-foreground font-mono text-xs">{h.createdAt}</span>,
              },
            ]}
            actions={(h) => (
              <>
                <RowIconButton label="Editar" onClick={() => setEditing(h)}>
                  <Pencil className="size-4" />
                </RowIconButton>
                <RowIconButton
                  label={h.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}
                  onClick={() => setToToggle(h)}
                >
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
              ? 'Hospitais inativos deixam de aparecer no cadastro de novos pacientes. Registros antigos não são afetados.'
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
          message={
            toDelete.linkedPatients > 0
              ? 'Este hospital já está vinculado a pacientes. Ele será inativado em vez de excluído.'
              : 'O hospital será removido definitivamente. Esta ação não pode ser desfeita.'
          }
          confirmLabel={toDelete.linkedPatients > 0 ? 'Inativar hospital' : 'Excluir hospital'}
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </div>
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
  const [form, setForm] = useState<HospitalInput>(
    hospital
      ? { name: hospital.name, city: hospital.city, state: hospital.state, address: hospital.address ?? '', phone: hospital.phone ?? '', status: hospital.status }
      : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState('');

  function set<K extends keyof HospitalInput>(k: K, v: HospitalInput[K]) {
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
        await hospitalsApi.update(hospital.id, form);
        onSaved('Hospital atualizado com sucesso.');
      } else {
        await hospitalsApi.create(form);
        onSaved('Hospital cadastrado com sucesso.');
      }
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : 'Erro ao salvar hospital. Verifique os campos obrigatórios.');
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
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-lg space-y-4 animate-entry my-8"
      >
        <h2 className="text-lg font-extrabold tracking-tight">
          {hospital ? `Editar ${hospital.name}` : 'Novo Hospital'}
        </h2>

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
          <TextInput
            label="Cidade"
            hint="Recomendado para organização."
            placeholder="Ex. Curitiba"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
          <TextInput
            label="Estado (UF)"
            placeholder="Ex. PR"
            maxLength={2}
            value={form.state}
            onChange={(e) => set('state', e.target.value.toUpperCase())}
          />
        </div>
        <TextInput label="Endereço (opcional)" placeholder="Rua, número, bairro" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        <TextInput label="Telefone (opcional)" placeholder="(41) 3000-0000" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        <Field label="Status">
          <ToggleSwitch
            checked={form.status === 'ACTIVE'}
            onChange={(v) => set('status', v ? 'ACTIVE' : 'INACTIVE')}
            label={form.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
          />
        </Field>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            {hospital ? 'Salvar alterações' : 'Cadastrar hospital'}
          </Button>
        </div>
      </form>
    </div>
  );
}
