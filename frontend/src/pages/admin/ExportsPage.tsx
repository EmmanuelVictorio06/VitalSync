import { useEffect, useState } from 'react';
import { Download, FileDown, RotateCw } from 'lucide-react';
import { ClinicalStatus } from '@vitalsync/shared';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { AdminPageHeader, AdminTable, LoadingState, SettingsSection } from '../../components/admin';
import { Field, SelectField, TextInput, cn } from '../../components/ui';
import { api, downloadFile } from '../../lib/api';
import { exportHistoryApi } from '../../lib/admin-api';
import {
  EXPORT_DATASET_LABEL,
  type ExportDataset,
  type ExportFilters,
  type ExportFormat,
  type ExportHistoryItem,
} from '../../lib/admin-types';
import type { SelectItem, SurgeonItem, Team } from '../../lib/dto';

const DATASETS = Object.entries(EXPORT_DATASET_LABEL) as Array<[ExportDataset, string]>;

const DATASET_FILE: Record<ExportDataset, string> = {
  PATIENTS: 'pacientes',
  VITALS: 'sinais_vitais',
  ALERTS: 'alertas',
  CARE: 'atendimentos',
  FULL: 'completo',
};

const STATUS_BADGE: Record<ExportHistoryItem['status'], { label: string; cls: string }> = {
  GENERATING: { label: 'Gerando', cls: 'bg-warning/10 text-warning border-warning/20' },
  DONE: { label: 'Concluído', cls: 'bg-stable/10 text-stable border-stable/20' },
  ERROR: { label: 'Erro', cls: 'bg-alert/10 text-alert border-alert/20' },
};

export function ExportsPage() {
  const toast = useToast();
  const { user } = useAuth();

  const [filters, setFilters] = useState<ExportFilters>({ clinicalStatus: '', monitoring: '' });
  const [dataset, setDataset] = useState<ExportDataset>('PATIENTS');
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const [history, setHistory] = useState<ExportHistoryItem[] | null>(null);

  // Catálogos reais para os filtros
  const [teams, setTeams] = useState<Team[]>([]);
  const [surgeons, setSurgeons] = useState<SurgeonItem[]>([]);
  const [hospitals, setHospitals] = useState<SelectItem[]>([]);
  const [surgeryTypes, setSurgeryTypes] = useState<SelectItem[]>([]);

  useEffect(() => {
    void exportHistoryApi.list().then(setHistory);
    Promise.all([
      api.get<{ items: Team[] }>('/teams'),
      api.get<{ items: SurgeonItem[] }>('/catalog/surgeons'),
      api.get<{ items: SelectItem[] }>('/catalog/hospitals'),
      api.get<{ items: SelectItem[] }>('/catalog/surgery-types'),
    ])
      .then(([t, s, h, st]) => {
        setTeams(t.items);
        setSurgeons(s.items);
        setHospitals(h.items);
        setSurgeryTypes(st.items);
      })
      .catch(() => toast.error('Erro ao carregar os filtros de exportação.'));
  }, []);

  function set<K extends keyof ExportFilters>(k: K, v: ExportFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  function summarize(): string {
    const parts: string[] = [];
    if (filters.fromDate || filters.toDate) parts.push(`Período: ${filters.fromDate || '…'} a ${filters.toDate || '…'}`);
    if (filters.patient) parts.push(`Paciente: ${filters.patient}`);
    if (filters.teamId) parts.push(`Equipe: ${teams.find((t) => t.id === filters.teamId)?.number ?? filters.teamId}`);
    if (filters.clinicalStatus) parts.push(`Status: ${filters.clinicalStatus}`);
    if (filters.surgeonId) parts.push(`Cirurgião: ${surgeons.find((s) => s.id === filters.surgeonId)?.name ?? ''}`);
    if (filters.hospitalId) parts.push(`Hospital: ${hospitals.find((h) => h.id === filters.hospitalId)?.name ?? ''}`);
    if (filters.surgeryTypeId) parts.push(`Cirurgia: ${surgeryTypes.find((s) => s.id === filters.surgeryTypeId)?.name ?? ''}`);
    if (filters.monitoring) parts.push(`Monitoramento: ${filters.monitoring === 'ACTIVE' ? 'Ativo' : 'Finalizado'}`);
    return parts.length ? parts.join(' · ') : 'Sem filtros';
  }

  /** Monta a query aceita hoje pelo backend (GET /api/export). */
  function buildQuery(format: ExportFormat): string {
    const params = new URLSearchParams({ format });
    if (filters.patient) params.set('search', filters.patient);
    if (filters.clinicalStatus) params.set('status', filters.clinicalStatus);
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    return params.toString();
  }

  async function runExport(format: ExportFormat, query?: string) {
    const q = query ?? buildQuery(format);
    const date = new Date().toISOString().slice(0, 10);
    const fallback = `curapath_${DATASET_FILE[dataset]}_${date}.${format}`;
    setBusyFormat(format);
    toast.info('Exportação iniciada.');
    try {
      await downloadFile(`/export?${q}`, fallback);
      toast.success('Arquivo gerado com sucesso.');
      await exportHistoryApi.add({
        datetime: new Date().toISOString().slice(0, 16).replace('T', ' '),
        userName: user?.name ?? '—',
        dataset,
        filtersSummary: summarize(),
        format,
        status: 'DONE',
        query: q,
      });
    } catch {
      toast.error('Erro ao gerar exportação. Tente novamente.');
      await exportHistoryApi.add({
        datetime: new Date().toISOString().slice(0, 16).replace('T', ' '),
        userName: user?.name ?? '—',
        dataset,
        filtersSummary: summarize(),
        format,
        status: 'ERROR',
        query: q,
      });
    } finally {
      setBusyFormat(null);
      setHistory(await exportHistoryApi.list());
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      <AdminPageHeader
        title="Exportações"
        subtitle="Exporte dados de pacientes, equipes, procedimentos e registros de sinais vitais para análise e armazenamento. Toda exportação é registrada em auditoria."
      />

      <div className="animate-entry [animation-delay:100ms] space-y-6">
        <SettingsSection
          title="Filtros"
          description="Use os filtros para evitar exportações desnecessariamente pesadas. Campos marcados com * serão aplicados quando o endpoint de exportação detalhada estiver disponível."
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <TextInput label="Período inicial" type="date" value={filters.fromDate ?? ''} onChange={(e) => set('fromDate', e.target.value)} />
            <TextInput label="Período final" type="date" value={filters.toDate ?? ''} onChange={(e) => set('toDate', e.target.value)} />
            <TextInput label="Paciente" placeholder="Nome do paciente" value={filters.patient ?? ''} onChange={(e) => set('patient', e.target.value)} />
            <SelectField
              label="Equipe médica"
              value={filters.teamId ?? ''}
              onChange={(e) => set('teamId', e.target.value)}
              options={teams.map((t) => ({ value: t.id, label: `Equipe ${t.number}` }))}
              placeholder="Todas"
            />
            <SelectField
              label="Cirurgião responsável *"
              value={filters.surgeonId ?? ''}
              onChange={(e) => set('surgeonId', e.target.value)}
              options={surgeons.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Todos"
            />
            <SelectField
              label="Hospital *"
              value={filters.hospitalId ?? ''}
              onChange={(e) => set('hospitalId', e.target.value)}
              options={hospitals.map((h) => ({ value: h.id, label: h.name }))}
              placeholder="Todos"
            />
            <SelectField
              label="Tipo de cirurgia *"
              value={filters.surgeryTypeId ?? ''}
              onChange={(e) => set('surgeryTypeId', e.target.value)}
              options={surgeryTypes.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Todos"
            />
            <SelectField
              label="Status clínico"
              value={filters.clinicalStatus ?? ''}
              onChange={(e) => set('clinicalStatus', e.target.value as ClinicalStatus | '')}
              options={[
                { value: ClinicalStatus.GREEN, label: 'Estável' },
                { value: ClinicalStatus.YELLOW, label: 'Atenção' },
                { value: ClinicalStatus.RED, label: 'Alerta' },
              ]}
              placeholder="Todos"
            />
            <SelectField
              label="Situação do monitoramento *"
              value={filters.monitoring ?? ''}
              onChange={(e) => set('monitoring', e.target.value as ExportFilters['monitoring'])}
              options={[
                { value: 'ACTIVE', label: 'Ativo' },
                { value: 'FINISHED', label: 'Finalizado' },
              ]}
              placeholder="Todos"
            />
          </div>
        </SettingsSection>

        <SettingsSection title="Tipo de dados" description="Escolha o conjunto de dados a exportar.">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {DATASETS.map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  'flex items-center gap-3 border rounded-lg px-4 py-3 text-sm font-medium cursor-pointer transition-colors',
                  dataset === value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <input
                  type="radio"
                  name="dataset"
                  className="accent-[#2563eb]"
                  checked={dataset === value}
                  onChange={() => setDataset(value)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => runExport('csv')}
              disabled={busyFormat !== null}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-primary/30 text-primary rounded-lg text-sm font-semibold hover:bg-accent disabled:opacity-55"
            >
              <FileDown className="size-4" /> {busyFormat === 'csv' ? 'Gerando…' : 'Exportar CSV'}
            </button>
            <button
              onClick={() => runExport('xlsx')}
              disabled={busyFormat !== null}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 shadow-lg shadow-primary/20 disabled:opacity-55"
            >
              <Download className="size-4" /> {busyFormat === 'xlsx' ? 'Gerando…' : 'Exportar XLSX'}
            </button>
          </div>
        </SettingsSection>

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Histórico de exportações
          </h3>
          {history === null ? (
            <LoadingState label="Carregando histórico…" />
          ) : (
            <AdminTable
              rows={history}
              keyFor={(h) => h.id}
              columns={[
                { header: 'Data', render: (h) => <span className="font-mono text-xs">{h.datetime}</span> },
                { header: 'Usuário', render: (h) => h.userName },
                { header: 'Tipo', render: (h) => EXPORT_DATASET_LABEL[h.dataset] },
                {
                  header: 'Filtros',
                  hideOnMobile: true,
                  render: (h) => <span className="text-xs text-muted-foreground">{h.filtersSummary}</span>,
                },
                { header: 'Formato', render: (h) => <span className="font-mono text-xs uppercase">{h.format}</span> },
                {
                  header: 'Status',
                  render: (h) => (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
                        STATUS_BADGE[h.status].cls,
                      )}
                    >
                      {STATUS_BADGE[h.status].label}
                    </span>
                  ),
                },
              ]}
              actions={(h) =>
                h.status === 'DONE' && h.query ? (
                  <button
                    onClick={() => runExport(h.format, h.query)}
                    disabled={busyFormat !== null}
                    title="Baixar novamente"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-semibold hover:bg-muted disabled:opacity-55"
                  >
                    <RotateCw className="size-3.5" /> Baixar
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
