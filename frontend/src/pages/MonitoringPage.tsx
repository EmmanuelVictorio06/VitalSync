import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Copy, Eye, FileDown, MessageCircle, Search, Trash2 } from 'lucide-react';
import { ClinicalStatus, formatCivilDate } from '@vitalsync/shared';
import { Role, useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, StatusBadge, cn, statusBorder } from '../components/ui';
import { api, ApiError, downloadFile } from '../lib/api';
import type { Paginated, PatientCardData } from '../lib/dto';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos' },
  { value: ClinicalStatus.GREEN, label: 'Estável' },
  { value: ClinicalStatus.YELLOW, label: 'Atenção' },
  { value: ClinicalStatus.RED, label: 'Alerta' },
];

export function MonitoringPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  // Aceita ?search= vindo da busca da topbar.
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<Paginated<PatientCardData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<PatientCardData | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '12' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      setData(await api.get<Paginated<PatientCardData>>(`/patients?${params}`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar pacientes.');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function shareLink(p: PatientCardData, mode: 'copy' | 'whatsapp') {
    try {
      const res = await api.post<{ link: string; whatsappUrl: string }>(`/patients/${p.id}/link`);
      if (mode === 'copy') {
        await navigator.clipboard.writeText(res.link);
        toast.info('Link copiado.');
      } else {
        window.open(res.whatsappUrl, '_blank');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao gerar link.');
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.del(`/patients/${toDelete.id}`);
      toast.success('Paciente removido do monitoramento.');
      setToDelete(null);
      setConfirmText('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir paciente.');
    }
  }

  async function exportData(format: 'csv' | 'xlsx') {
    try {
      const params = new URLSearchParams({ format });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      await downloadFile(`/export?${params}`, `vitalsync.${format}`);
      toast.success('Exportação iniciada.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao exportar.');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 animate-entry">
        <div className="flex-1">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Pacientes em monitoramento</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pacientes ativos em monitoramento domiciliar pós-alta. Filtre por nome, status ou período.
          </p>
        </div>
        {hasRole(Role.ADM) && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => exportData('xlsx')}>
              <FileDown className="size-3.5" /> XLSX
            </Button>
            <Button variant="ghost" size="sm" onClick={() => exportData('csv')}>
              <FileDown className="size-3.5" /> CSV
            </Button>
          </div>
        )}
      </div>

      {/* Filtro avançado */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col lg:flex-row gap-3 animate-entry [animation-delay:100ms]">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Buscar por nome do paciente..."
            className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            className="input !w-auto"
            title="Cirurgia a partir de"
            value={fromDate}
            onChange={(e) => {
              setPage(1);
              setFromDate(e.target.value);
            }}
          />
          <input
            type="date"
            className="input !w-auto"
            title="Cirurgia até"
            value={toDate}
            onChange={(e) => {
              setPage(1);
              setToDate(e.target.value);
            }}
          />
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1 self-start lg:self-auto">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setPage(1);
                setStatus(s.value);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                status === s.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-10 animate-pulse">Carregando…</p>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold">Nenhum paciente encontrado</p>
          <p className="text-sm mt-1">Ajuste os filtros para ver mais resultados.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-entry [animation-delay:150ms]">
          {data.items.map((p) => (
            <PatientCard
              key={p.id}
              p={p}
              onOpen={() => navigate(`/patients/${p.id}`)}
              onCopy={() => shareLink(p, 'copy')}
              onWhats={() => shareLink(p, 'whatsapp')}
              onDelete={() => setToDelete(p)}
            />
          ))}
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex justify-center items-center gap-3">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Anterior
          </Button>
          <span className="text-xs text-muted-foreground font-semibold">
            Página {data.page} de {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= Math.ceil(data.total / data.pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima →
          </Button>
        </div>
      )}

      {toDelete && (
        <ConfirmModal
          title={`Excluir ${toDelete.name}?`}
          message="O paciente será removido do monitoramento e o link será invalidado."
          confirmLabel="Excluir paciente"
          requireText="EXCLUIR"
          confirmInput={confirmText}
          onConfirmInputChange={setConfirmText}
          onCancel={() => {
            setToDelete(null);
            setConfirmText('');
          }}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

const fmt = formatCivilDate;

function PatientCard({
  p, onOpen, onCopy, onWhats, onDelete,
}: {
  p: PatientCardData;
  onOpen: () => void;
  onCopy: () => void;
  onWhats: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={cn(
        'bg-card border border-border rounded-xl p-4 md:p-5 shadow-sm border-l-4 flex flex-col gap-4',
        statusBorder(p.currentStatus),
      )}
    >
      <header className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-base leading-tight truncate cursor-pointer hover:text-primary" onClick={onOpen}>
            {p.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {p.surgeryTypeName}
            {p.surgeonName ? ` · ${p.surgeonName}` : ''}
          </p>
        </div>
        <StatusBadge status={p.currentStatus} />
      </header>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Cirurgia</dt>
          <dd className="flex items-center gap-1 mt-0.5 font-medium">
            <Calendar className="size-3" />
            {fmt(p.surgeryDate)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Alta</dt>
          <dd className="flex items-center gap-1 mt-0.5 font-medium">
            <Calendar className="size-3" />
            {fmt(p.dischargeDate)}
          </dd>
        </div>
      </dl>

      <label className="flex items-center gap-2 text-xs font-medium select-none bg-muted/60 rounded-lg px-3 py-2">
        <input type="checkbox" readOnly checked={!!p.attendedById} className="accent-[#2563eb]" />
        Atendido pela equipe{p.attendedByName ? ` · ${p.attendedByName}` : ''}
      </label>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        <button
          onClick={onOpen}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          <Eye className="size-3.5" /> Acompanhar
        </button>
        <button
          onClick={onWhats}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors"
        >
          <MessageCircle className="size-3.5" /> WhatsApp
        </button>
        <button
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors"
        >
          <Copy className="size-3.5" /> Copiar link
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-alert/30 text-alert rounded-md text-xs font-semibold hover:bg-alert/5 transition-colors"
        >
          <Trash2 className="size-3.5" /> Excluir
        </button>
      </div>
    </article>
  );
}
