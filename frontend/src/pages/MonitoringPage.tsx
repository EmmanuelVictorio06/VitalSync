import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClinicalStatus, formatCivilDate } from '@vitalsync/shared';
import { Role, useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, SelectField, StatusBadge, TextInput } from '../components/ui';
import { api, ApiError, downloadFile } from '../lib/api';
import type { Paginated, PatientCardData } from '../lib/dto';

const STATUS_OPTIONS = [
  { value: ClinicalStatus.RED, label: 'Alerta (vermelho)' },
  { value: ClinicalStatus.YELLOW, label: 'Atenção (amarelo)' },
  { value: ClinicalStatus.GREEN, label: 'Estável (verde)' },
];

export function MonitoringPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  const [data, setData] = useState<Paginated<PatientCardData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Pacientes em monitoramento</h1>
          <p className="subtext" style={{ marginBottom: 0 }}>
            Pacientes ativos em monitoramento domiciliar pós-alta. Filtre por nome, status ou período.
          </p>
        </div>
        <span className="spacer" />
        {hasRole(Role.ADM) && (
          <div className="row">
            <Button variant="secondary" size="sm" onClick={() => exportData('xlsx')}>⬇ Exportar XLSX</Button>
            <Button variant="secondary" size="sm" onClick={() => exportData('csv')}>⬇ Exportar CSV</Button>
          </div>
        )}
      </div>

      {/* Filtro avançado */}
      <div className="card">
        <div className="block-title">Filtro avançado de busca</div>
        <div className="grid grid-2">
          <TextInput label="Paciente" placeholder="Buscar por nome…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <SelectField label="Status clínico" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} options={STATUS_OPTIONS} placeholder="Todos" />
          <TextInput label="Cirurgia a partir de" type="date" value={fromDate} onChange={(e) => { setPage(1); setFromDate(e.target.value); }} />
          <TextInput label="Cirurgia até" type="date" value={toDate} onChange={(e) => { setPage(1); setToDate(e.target.value); }} />
        </div>
      </div>

      {loading ? (
        <p className="loading">Carregando…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="empty">Nenhum paciente encontrado com os filtros atuais.</p>
      ) : (
        <div className="grid grid-3">
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
        <div className="row" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</Button>
          <span className="muted">Página {data.page} de {Math.ceil(data.total / data.pageSize)}</span>
          <Button variant="ghost" size="sm" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage((p) => p + 1)}>Próxima →</Button>
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
          onCancel={() => { setToDelete(null); setConfirmText(''); }}
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
    <div className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="card-title" style={{ cursor: 'pointer' }} onClick={onOpen}>{p.name}</div>
        <span className="spacer" />
        <StatusBadge status={p.currentStatus} />
      </div>
      <div>
        <div className="kv"><span>Cirurgião</span><span>{p.surgeonName ?? '—'}</span></div>
        <div className="kv"><span>Cirurgia</span><span>{p.surgeryTypeName}</span></div>
        <div className="kv"><span>Data da cirurgia</span><span>{fmt(p.surgeryDate)}</span></div>
        <div className="kv"><span>Alta hospitalar</span><span>{fmt(p.dischargeDate)}</span></div>
      </div>
      <label className="kv" style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 10px' }}>
        <span>Atendido {p.attendedByName ? `por ${p.attendedByName}` : ''}</span>
        <input type="checkbox" readOnly checked={!!p.attendedById} style={{ width: 'auto', minHeight: 'auto' }} />
      </label>
      <div className="row">
        <Button size="sm" onClick={onOpen}>Acompanhar</Button>
        <Button variant="ghost" size="sm" onClick={onCopy} title="Copiar link">📋</Button>
        <Button variant="whatsapp" size="sm" onClick={onWhats} title="Conversar no WhatsApp">WhatsApp</Button>
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={onDelete} title="Excluir">🗑️</Button>
      </div>
    </div>
  );
}
