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
import { Button, ConfirmModal, Field, SelectField, TextInput } from '../../components/ui';
import { surgeryTypeService } from '../../services/surgeryTypeService';
import type { EntityStatus, SurgeryType } from '../../services/types';

type StatusFilter = 'ALL' | EntityStatus;
interface SurgeryForm { name: string; specialty: string; description: string; status: EntityStatus }
const EMPTY_FORM: SurgeryForm = { name: '', specialty: '', description: '', status: 'ACTIVE' };

export function SurgeryTypesPage() {
  const toast = useToast();
  const [items, setItems] = useState<SurgeryType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const [editing, setEditing] = useState<SurgeryType | 'new' | null>(null);
  const [toToggle, setToToggle] = useState<SurgeryType | null>(null);
  const [toDelete, setToDelete] = useState<SurgeryType | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    setItems(null);
    try {
      setItems(await surgeryTypeService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar tipos de cirurgia.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const specialties = useMemo(
    () => Array.from(new Set((items ?? []).map((s) => s.specialty).filter(Boolean))) as string[],
    [items],
  );

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (s) =>
          (statusFilter === 'ALL' || s.status === statusFilter) &&
          (!specialty || s.specialty === specialty) &&
          s.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search, specialty, statusFilter],
  );

  async function toggle() {
    if (!toToggle) return;
    setBusy(true);
    try {
      await surgeryTypeService.update(toToggle.id, { status: toToggle.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      toast.success(toToggle.status === 'ACTIVE' ? 'Tipo de cirurgia inativado.' : 'Tipo de cirurgia reativado.');
      setToToggle(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar status.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await surgeryTypeService.remove(toDelete.id);
      toast.success('Tipo de cirurgia excluído.');
    } catch {
      try {
        await surgeryTypeService.update(toDelete.id, { status: 'INACTIVE' });
        toast.success('Tipo vinculado a pacientes — foi inativado em vez de excluído.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir tipo de cirurgia.');
      }
    } finally {
      setToDelete(null);
      setBusy(false);
      await load();
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      <AdminPageHeader
        title="Tipos de Cirurgia"
        subtitle="Gerencie os tipos de procedimentos usados no cadastro dos pacientes. Tipos inativos não aparecem em novos cadastros."
        actionLabel="Novo Tipo de Cirurgia"
        onAction={() => setEditing('new')}
      />

      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col md:flex-row gap-3 animate-entry [animation-delay:100ms]">
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome da cirurgia..." />
        <select className="input md:!w-56" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
          <option value="">Todas as especialidades</option>
          {specialties.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
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
        <LoadingState label="Carregando tipos de cirurgia…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum tipo de cirurgia encontrado" hint="Ajuste os filtros ou cadastre um novo tipo." />
      ) : (
        <div className="animate-entry [animation-delay:150ms]">
          <AdminTable
            rows={filtered}
            keyFor={(s) => s.id}
            columns={[
              {
                header: 'Tipo de cirurgia',
                render: (s) => (
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{s.name}</p>
                    {s.description && <p className="text-[11px] text-muted-foreground truncate">{s.description}</p>}
                  </div>
                ),
              },
              { header: 'Especialidade', render: (s) => s.specialty || '—' },
              { header: 'Status', render: (s) => <StatusPill status={s.status} /> },
              { header: 'Cadastro', hideOnMobile: true, render: (s) => <span className="text-muted-foreground font-mono text-xs">{s.created_at.slice(0, 10)}</span> },
            ]}
            actions={(s) => (
              <>
                <RowIconButton label="Editar" onClick={() => setEditing(s)}>
                  <Pencil className="size-4" />
                </RowIconButton>
                <RowIconButton label={s.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} onClick={() => setToToggle(s)}>
                  <Power className="size-4" />
                </RowIconButton>
                <RowIconButton label="Excluir" danger onClick={() => setToDelete(s)}>
                  <Trash2 className="size-4" />
                </RowIconButton>
              </>
            )}
          />
        </div>
      )}

      {editing && (
        <SurgeryTypeFormModal
          surgeryType={editing === 'new' ? null : editing}
          specialties={specialties}
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
              ? 'Tipos inativos deixam de aparecer no cadastro de novos pacientes.'
              : 'O tipo voltará a aparecer no cadastro de novos pacientes.'
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
          confirmLabel="Excluir tipo"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function SurgeryTypeFormModal({
  surgeryType,
  specialties,
  onClose,
  onSaved,
}: {
  surgeryType: SurgeryType | null;
  specialties: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<SurgeryForm>(
    surgeryType
      ? { name: surgeryType.name, specialty: surgeryType.specialty ?? '', description: surgeryType.description ?? '', status: surgeryType.status }
      : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const allSpecialties = Array.from(new Set(['Cirurgia Geral', 'Ortopedia', 'Obstetrícia', 'Cardiologia', 'Urologia', ...specialties]));

  function set<K extends keyof SurgeryForm>(k: K, v: SurgeryForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError('Informe o nome da cirurgia.');
      return;
    }
    setBusy(true);
    try {
      if (surgeryType) {
        await surgeryTypeService.update(surgeryType.id, { name: form.name, specialty: form.specialty, description: form.description, status: form.status });
        onSaved('Tipo de cirurgia atualizado com sucesso.');
      } else {
        await surgeryTypeService.create({ name: form.name, specialty: form.specialty, description: form.description });
        onSaved('Tipo de cirurgia cadastrado com sucesso.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar tipo de cirurgia.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-lg space-y-4 animate-entry my-8">
        <h2 className="text-lg font-extrabold tracking-tight">{surgeryType ? `Editar ${surgeryType.name}` : 'Novo Tipo de Cirurgia'}</h2>
        <TextInput
          label="Nome da cirurgia"
          required
          placeholder="Ex. Colecistectomia"
          value={form.name}
          error={nameError}
          onChange={(e) => {
            set('name', e.target.value);
            setNameError('');
          }}
        />
        <SelectField
          label="Especialidade médica (opcional)"
          value={form.specialty}
          onChange={(e) => set('specialty', e.target.value)}
          options={allSpecialties.map((s) => ({ value: s, label: s }))}
          placeholder="Sem especialidade"
        />
        <Field label="Descrição curta (opcional)">
          <textarea className="input min-h-20 resize-y" placeholder="Breve descrição do procedimento" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        {surgeryType && (
          <Field label="Status">
            <ToggleSwitch checked={form.status === 'ACTIVE'} onChange={(v) => set('status', v ? 'ACTIVE' : 'INACTIVE')} label={form.status === 'ACTIVE' ? 'Ativo' : 'Inativo'} />
          </Field>
        )}
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            {surgeryType ? 'Salvar alterações' : 'Cadastrar tipo'}
          </Button>
        </div>
      </form>
    </div>
  );
}
