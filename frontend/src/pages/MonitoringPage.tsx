import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Copy, Eye, MessageCircle, Search, Trash2, X } from 'lucide-react';
import { ClinicalStatus, formatCivilDate, whatsappLink } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { ConfirmModal, StatusBadge, cn, statusBorder } from '../components/ui';
import { patientService, type PatientWithNames } from '../services/patientService';

const STATUS_OPTIONS: Array<{ value: '' | ClinicalStatus; label: string }> = [
  { value: '', label: 'Todos' },
  { value: ClinicalStatus.GREEN, label: 'Estável' },
  { value: ClinicalStatus.YELLOW, label: 'Atenção' },
  { value: ClinicalStatus.RED, label: 'Alerta' },
];

/** Copia texto para a área de transferência, com fallback p/ contexto não seguro. */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Não foi possível copiar o link.');
}

export function MonitoringPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const [patients, setPatients] = useState<PatientWithNames[] | null>(null);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState<'' | ClinicalStatus>('');
  const [toDelete, setToDelete] = useState<PatientWithNames | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const team = searchParams.get('team') ?? '';

  const load = useCallback(async () => {
    setPatients(null);
    try {
      const items = await patientService.list({ status: status || undefined, search: search || undefined });
      setPatients(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar pacientes.');
      setPatients([]);
    }
  }, [search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtro por equipe (vindo de "Minhas Equipes"/"Minha Equipe") — client-side.
  const visible = (patients ?? []).filter(
    (p) => !team || String(p.medical_team?.team_number ?? '') === team || String(p.medical_team?.team_number ?? '').padStart(2, '0') === team,
  );

  function clearTeam() {
    const next = new URLSearchParams(searchParams);
    next.delete('team');
    setSearchParams(next, { replace: true });
  }

  async function share(p: PatientWithNames, mode: 'copy' | 'whatsapp') {
    try {
      const link = await patientService.getLink(p.id);
      if (mode === 'copy') {
        await copyToClipboard(link);
        toast.info('Link copiado.');
      } else {
        window.open(whatsappLink(p.phone ?? '', `Olá, ${p.name}! Registre seus sinais vitais neste link seguro: ${link}`), '_blank');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao compartilhar o link.');
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await patientService.remove(toDelete.id);
      toast.success('Paciente removido do monitoramento.');
      setToDelete(null);
      setConfirmText('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir paciente.');
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Pacientes em monitoramento</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pacientes ativos em monitoramento domiciliar pós-alta. Filtre por nome ou status.
        </p>
      </div>

      {team && (
        <div className="flex items-center gap-2 animate-entry">
          <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-full pl-3 pr-1.5 py-1">
            Filtrando pela Equipe nº {team.padStart(2, '0')}
            <button onClick={clearTeam} className="size-5 rounded-full hover:bg-primary/20 flex items-center justify-center" aria-label="Remover filtro de equipe">
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}

      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col lg:flex-row gap-3 animate-entry [animation-delay:100ms]">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome do paciente..."
            className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1 self-start lg:self-auto">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
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

      {patients === null ? (
        <p className="text-center text-muted-foreground py-10 animate-pulse">Carregando…</p>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold">Nenhum paciente encontrado</p>
          <p className="text-sm mt-1">Ajuste os filtros ou cadastre um novo paciente.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-entry [animation-delay:150ms]">
          {visible.map((p) => (
            <PatientCard
              key={p.id}
              p={p}
              onOpen={() => navigate(`/patients/${p.id}`)}
              onCopy={() => share(p, 'copy')}
              onWhats={() => share(p, 'whatsapp')}
              onDelete={() => setToDelete(p)}
            />
          ))}
        </div>
      )}

      {toDelete && (
        <ConfirmModal
          title={`Excluir ${toDelete.name}?`}
          message="O paciente será removido do monitoramento."
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

function PatientCard({
  p, onOpen, onCopy, onWhats, onDelete,
}: {
  p: PatientWithNames;
  onOpen: () => void;
  onCopy: () => void;
  onWhats: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={cn('bg-card border border-border rounded-xl p-4 md:p-5 shadow-sm border-l-4 flex flex-col gap-4', statusBorder(p.current_status))}>
      <header className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-base leading-tight truncate cursor-pointer hover:text-primary" onClick={onOpen}>
            {p.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {p.surgery_type?.name ?? '—'}
            {p.medical_team ? ` · Equipe ${String(p.medical_team.team_number).padStart(2, '0')}` : ''}
          </p>
        </div>
        <StatusBadge status={p.current_status} />
      </header>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Cirurgia</dt>
          <dd className="flex items-center gap-1 mt-0.5 font-medium">
            <Calendar className="size-3" />
            {p.surgery_date ? formatCivilDate(p.surgery_date) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Alta</dt>
          <dd className="flex items-center gap-1 mt-0.5 font-medium">
            <Calendar className="size-3" />
            {p.hospital_discharge_date ? formatCivilDate(p.hospital_discharge_date) : '—'}
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        <button onClick={onOpen} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Eye className="size-3.5" /> Acompanhar
        </button>
        <button onClick={onWhats} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors">
          <MessageCircle className="size-3.5" /> WhatsApp
        </button>
        <button onClick={onCopy} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors">
          <Copy className="size-3.5" /> Copiar link
        </button>
        <button onClick={onDelete} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-alert/30 text-alert rounded-md text-xs font-semibold hover:bg-alert/5 transition-colors">
          <Trash2 className="size-3.5" /> Excluir
        </button>
      </div>
    </article>
  );
}
