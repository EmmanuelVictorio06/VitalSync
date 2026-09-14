import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Copy, Eye, MessageCircle, Search, Trash2, X } from 'lucide-react';
import { ClinicalStatus, formatCivilDate, whatsappLink } from '@vitalsync/shared';
import { useAuth } from '../auth/AuthContext';
import { ActionsMenu } from '../components/ActionsMenu';
import { useToast } from '../components/Toast';
import { SegmentedFilter } from '../components/admin';
import { ConfirmModal, PageContainer, PageHeader, StatusBadge, cn, statusBorder } from '../components/ui';
import { useMissedMeasurementCount } from '../components/MissedMeasurementCount';
import { homologationService } from '../services/homologationService';
import { patientService, type PatientKind, type PatientWithNames } from '../services/patientService';
import { supportPermissionService } from '../services/supportPermissionService';

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

function patientLink(p: PatientWithNames): string {
  return `${window.location.origin}/r/${p.secure_token}`;
}

/**
 * Grade dos cards de paciente.
 *
 * `grid-cols-[minmax(0,1fr)]` na base é OBRIGATÓRIO, não enfeite: `grid`
 * sozinho cria uma coluna IMPLÍCITA `auto`, dimensionada por min-content — e o
 * min-content do card é enorme porque o nome e o subtítulo usam `truncate`
 * (`white-space: nowrap`), cujo min-content é o texto inteiro sem cortar. Em
 * 390px o card estourava a coluna em 56px (380 vs. 324), sem scrollbar à vista
 * porque um ancestral tem `overflow-x: clip` e cortava em silêncio.
 * As variantes `sm:`/`xl:` nunca tiveram o problema: `grid-cols-N` do Tailwind
 * já expande para `repeat(N, minmax(0,1fr))`.
 */
const CARD_GRID = 'grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 xl:grid-cols-3 gap-4';

/** Botão de ação do card. `min-h-11` = 44px, o alvo de toque mínimo no mobile. */
const ACTION_BTN =
  'inline-flex items-center justify-center gap-1.5 px-3 min-h-11 sm:min-h-9 rounded-md text-sm sm:text-xs font-semibold transition-colors';

export function MonitoringPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Suporte é operacional: não abre o detalhe clínico (/patients/:id é barrado a
  // ele) nem exclui paciente. Esconde essas ações para não habilitar o que o
  // backend recusaria (M-03).
  const canOpen = !supportPermissionService.isSupport(user);
  const canDelete = supportPermissionService.canDeletePatient(user);
  // Exclusão pode remover paciente com medição de hoje pendente — atualiza o badge da sidebar.
  const { refresh: refreshMissedCount } = useMissedMeasurementCount();

  const [searchParams, setSearchParams] = useSearchParams();
  const [patients, setPatients] = useState<PatientWithNames[] | null>(null);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState<'' | ClinicalStatus>(() => {
    const param = searchParams.get('status');
    if (param === 'stable') return ClinicalStatus.GREEN;
    if (param === 'attention') return ClinicalStatus.YELLOW;
    if (param === 'alert') return ClinicalStatus.RED;
    return '';
  });
  const [toDelete, setToDelete] = useState<PatientWithNames | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [kind, setKind] = useState<PatientKind>('all');
  const [homologation, setHomologation] = useState(false);
  const team = searchParams.get('team') ?? '';

  const load = useCallback(async () => {
    setPatients(null);
    try {
      const items = await patientService.list({ status: status || undefined, search: search || undefined, kind });
      setPatients(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar pacientes.');
      setPatients([]);
    }
  }, [search, status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtro Reais/Teste só faz sentido durante a homologação — fica oculto fora dela.
  useEffect(() => {
    homologationService.isActive().then(setHomologation).catch(() => {});
  }, []);

  // Filtro por equipe (vindo de "Minhas Equipes"/"Minha Equipe") — client-side.
  const visible = (patients ?? []).filter(
    (p) => !team || String(p.medical_team?.team_number ?? '') === team || String(p.medical_team?.team_number ?? '').padStart(2, '0') === team,
  );

  function clearTeam() {
    const next = new URLSearchParams(searchParams);
    next.delete('team');
    setSearchParams(next, { replace: true });
  }

  function clearStatus() {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    setSearchParams(next, { replace: true });
    setStatus('');
  }

  async function share(p: PatientWithNames, mode: 'copy' | 'whatsapp') {
    const link = patientLink(p);
    try {
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
      refreshMissedCount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir paciente.');
    }
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Pacientes em monitoramento"
        subtitle="Pacientes ativos em monitoramento domiciliar pós-alta. Filtre por nome ou status."
      />

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

      {status && (
        <div className="flex items-center gap-2 animate-entry">
          <span className={cn(
            'inline-flex items-center gap-2 text-xs font-semibold rounded-full pl-3 pr-1.5 py-1',
            status === ClinicalStatus.GREEN && 'bg-stable/10 text-stable',
            status === ClinicalStatus.YELLOW && 'bg-warning/10 text-warning',
            status === ClinicalStatus.RED && 'bg-alert/10 text-alert',
          )}>
            Filtro ativo: {STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status}
            <button onClick={clearStatus} className="size-5 rounded-full hover:bg-foreground/10 flex items-center justify-center" aria-label="Remover filtro de status">
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
        {homologation && (
          <SegmentedFilter
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'real', label: 'Reais' },
              { value: 'test', label: 'Teste' },
            ]}
          />
        )}
        <div className="flex gap-1 bg-muted rounded-lg p-1 self-start lg:self-auto">
          {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => {
                  setStatus(s.value);
                  const next = new URLSearchParams(searchParams);
                  if (s.value) {
                    const paramMap: Record<ClinicalStatus, string> = { [ClinicalStatus.GREEN]: 'stable', [ClinicalStatus.YELLOW]: 'attention', [ClinicalStatus.RED]: 'alert' };
                    next.set('status', paramMap[s.value]);
                  } else {
                    next.delete('status');
                  }
                  setSearchParams(next, { replace: true });
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

      {patients === null ? (
        <p className="text-center text-muted-foreground py-10 animate-pulse">Carregando…</p>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold">Nenhum paciente encontrado</p>
          <p className="text-sm mt-1">Ajuste os filtros ou cadastre um novo paciente.</p>
        </div>
      ) : (
        <div className={cn(CARD_GRID, 'animate-entry [animation-delay:150ms]')}>
          {visible.map((p) => (
            <PatientCard
              key={p.id}
              p={p}
              onOpen={canOpen ? () => navigate(`/patients/${p.id}`) : undefined}
              onCopy={() => share(p, 'copy')}
              onWhats={() => share(p, 'whatsapp')}
              onDelete={canDelete ? () => setToDelete(p) : undefined}
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
    </PageContainer>
  );
}

function PatientCard({
  p, onOpen, onCopy, onWhats, onDelete,
}: {
  p: PatientWithNames;
  /** Indefinido = perfil não abre o detalhe clínico (ex.: Suporte). */
  onOpen?: () => void;
  onCopy: () => void;
  onWhats: () => void;
  /** Indefinido = perfil não pode excluir (ex.: Suporte). */
  onDelete?: () => void;
}) {
  return (
    // `min-w-0`: como grid item, o card tem `min-width: auto` e não encolheria
    // abaixo do próprio min-content. É a garantia no item, redundante com o
    // `minmax(0,1fr)` da trilha de propósito — uma protege a outra.
    <article className={cn('bg-card border border-border rounded-xl p-4 md:p-5 shadow-sm border-l-4 flex flex-col gap-4 min-w-0', statusBorder(p.current_status))}>
      <header className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className={cn('font-bold text-base leading-tight truncate', onOpen && 'cursor-pointer hover:text-primary')} onClick={onOpen}>
            {p.name}
            {p.is_test && (
              <span className="ml-2 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning align-middle">
                Teste
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {p.surgery_type?.name ?? '—'}
            {p.medical_team ? ` · Equipe ${String(p.medical_team.team_number).padStart(2, '0')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusBadge status={p.current_status} />
          {/* Excluir é destrutivo sobre paciente real: sai do rodapé (onde o
              polegar bate sem querer) e passa a exigir um toque intencional. */}
          {onDelete && (
            <ActionsMenu
              ariaLabel={`Mais ações de ${p.name}`}
              entries={[{ kind: 'button', icon: Trash2, label: 'Excluir paciente', onClick: onDelete, danger: true }]}
            />
          )}
        </div>
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

      {/* Duas colunas em qualquer largura, com "Acompanhar" ocupando a linha
          inteira: o grid fecha certo tanto com 2 quanto com 3 botões (Suporte
          não vê "Acompanhar"), sem buraco nem botão esticado sozinho.
          Alvo de toque de 44px no mobile; do `sm` pra cima volta à densidade
          anterior. */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        {onOpen && (
          <button onClick={onOpen} className={cn(ACTION_BTN, 'col-span-2 bg-primary text-primary-foreground hover:bg-primary/90')}>
            <Eye className="size-3.5" /> Acompanhar
          </button>
        )}
        <button onClick={onWhats} className={cn(ACTION_BTN, 'border border-border hover:bg-muted')}>
          <MessageCircle className="size-3.5" /> WhatsApp
        </button>
        <button onClick={onCopy} className={cn(ACTION_BTN, 'border border-border hover:bg-muted')}>
          <Copy className="size-3.5" /> Copiar link
        </button>
      </div>
    </article>
  );
}
