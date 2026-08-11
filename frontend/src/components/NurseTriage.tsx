/**
 * Triagem de enfermagem: barra de plantão + fila em três blocos + escalonamento.
 *
 * A fila NUNCA esconde um alerta atribuído a outro enfermeiro — ele aparece
 * esmaecido com "aguardando Fulano — 4:12". Direcionamento sem perder a
 * redundância do broadcast: um alerta jamais fica preso e invisível (0068).
 *
 * As garantias reais são do banco: claim atômico (0044), escopo do pool (0066),
 * bloqueio de finalizar vermelho (0067). Aqui só decidimos o que mostrar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Stethoscope,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { Button, StatusBadge, cn } from './ui';
import {
  classifyQueueItem,
  offerCountdown,
  sortOpenQueue,
  unavailableReason,
  validateEscalationReason,
  type QueueBucket,
} from '../lib/nurseTriage';
import { openForLabel } from '../lib/nurseDashboard';
import { alertService, type AlertRow } from '../services/alertService';
import { nurseShiftService } from '../services/nurseShiftService';
import type { NurseShift } from '../services/types';

/* ============================ barra de plantão ============================ */

function ShiftBar({ shift, onChanged }: { shift: NurseShift | null; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const paused = Boolean(shift?.paused_at);

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar o plantão.');
    } finally {
      setBusy(false);
    }
  }

  if (!shift) {
    return (
      <section className="bg-warning/5 border border-warning/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">Você não está de plantão</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fora do plantão você não recebe ofertas de alerta. A fila aberta continua visível.
          </p>
        </div>
        <Button size="sm" loading={busy} onClick={() => void run(nurseShiftService.openShift, 'Plantão aberto.')}>
          <PlayCircle className="size-4" /> Abrir plantão
        </Button>
      </section>
    );
  }

  const motivo = unavailableReason({
    onDuty: shift.on_duty,
    paused,
    activeLoad: shift.active_load,
    wipLimit: shift.wip_limit,
  });

  return (
    <section
      className={cn(
        'bg-card border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3',
        paused ? 'border-warning/40' : 'border-border',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold flex items-center gap-2">
          <Stethoscope className="size-4 text-primary" />
          {paused ? 'Plantão pausado' : 'Em plantão'} · {shift.pool_name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Carga atual{' '}
          <strong className="font-mono text-foreground">
            {shift.active_load}/{shift.wip_limit}
          </strong>
          {motivo ? ` · ${motivo}` : ' · recebendo ofertas'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {paused ? (
          <Button size="sm" loading={busy} onClick={() => void run(nurseShiftService.resumeShift, 'Plantão retomado.')}>
            <PlayCircle className="size-4" /> Retomar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => void run(nurseShiftService.pauseShift, 'Plantão pausado.')}
          >
            <PauseCircle className="size-4" /> Pausar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => void run(nurseShiftService.closeShift, 'Plantão encerrado.')}
        >
          Encerrar
        </Button>
      </div>
    </section>
  );
}

/* ========================== modal de escalonamento ======================== */

function EscalateModal({
  alert,
  onClose,
  onDone,
}: {
  alert: AlertRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const problema = validateEscalationReason(reason);
    setError(problema);
    if (problema) return;
    setBusy(true);
    try {
      await alertService.escalate(alert.id, reason.trim());
      toast.success('Caso escalado para o médico da equipe.');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível escalar o caso.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight">Escalar para o médico</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {alert.patient?.name ?? 'Paciente'} — a classificação clínica do alerta{' '}
            <strong>não muda</strong>; o médico da equipe é avisado e assume o caso.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Por que este caso precisa do médico?
          </label>
          <textarea
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary min-h-28"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Ex.: Paciente relatou piora da dor e febre desde ontem; orientei hidratação, mas mantém queixa."
            autoFocus
          />
          {error && <p className="text-xs text-alert mt-1">{error}</p>}
          <p className="text-[11px] text-muted-foreground mt-1">
            O médico lê esta justificativa e o seu histórico de contato antes de assumir.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={confirm} loading={busy}>
            <ArrowUpRight className="size-4" /> Escalar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ============================== linha da fila ============================= */

function QueueRow({
  alert,
  bucket,
  now,
  onClaim,
  onDecline,
  onEscalate,
  busyId,
}: {
  alert: AlertRow;
  bucket: QueueBucket;
  now: Date;
  onClaim: (a: AlertRow) => void;
  onDecline: (a: AlertRow) => void;
  onEscalate: (a: AlertRow) => void;
  busyId: string | null;
}) {
  const countdown = offerCountdown(alert.offer_expires_at, now);
  const esmaecido = bucket === 'OFFERED_TO_OTHER' || bucket === 'LOCKED_BY_OTHER';
  const atrasado = Boolean(alert.sla_breached_at);
  const busy = busyId === alert.id;

  return (
    <li
      className={cn(
        'px-4 py-3 flex items-center justify-between gap-3 flex-wrap',
        esmaecido && 'opacity-60',
        atrasado && 'bg-alert/5',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold truncate">{alert.patient?.name ?? '—'}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {alert.type ?? 'Sinais vitais'} · esperando {openForLabel(alert.created_at, now)}
          {atrasado && <span className="text-alert font-semibold"> · atrasado</span>}
        </p>
        {bucket === 'OFFERED_TO_OTHER' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <Clock className="size-3 inline mr-1" />
            aguardando {alert.assigned_nurse_name ?? 'outro profissional'} — {countdown.label}
          </p>
        )}
        {bucket === 'LOCKED_BY_OTHER' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            em análise por {alert.in_analysis_by_name ?? 'outro profissional'}
          </p>
        )}
        {bucket === 'OFFERED_TO_ME' && (
          <p className="text-[11px] font-semibold text-primary mt-0.5">
            <Clock className="size-3 inline mr-1" />
            oferecido a você — {countdown.label} para assumir
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={alert.status} />
        {(bucket === 'OFFERED_TO_ME' || bucket === 'OPEN') && (
          <Button size="sm" onClick={() => onClaim(alert)} loading={busy}>
            Assumir
          </Button>
        )}
        {bucket === 'OFFERED_TO_ME' && (
          <Button size="sm" variant="ghost" onClick={() => onDecline(alert)} disabled={busy}>
            Devolver
          </Button>
        )}
        {bucket === 'MINE_IN_ANALYSIS' && (
          <>
            <Button size="sm" variant="secondary" onClick={() => onEscalate(alert)} disabled={busy}>
              <ArrowUpRight className="size-4" /> Escalar
            </Button>
            <Link
              to="/alerts"
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Concluir
            </Link>
          </>
        )}
      </div>
    </li>
  );
}

function Block({
  title,
  hint,
  icon: Icon,
  tone = 'default',
  children,
  empty,
  count,
}: {
  title: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'primary' | 'alert';
  children: React.ReactNode;
  empty: string;
  count: number;
}) {
  const border = { default: 'border-border', primary: 'border-primary/30', alert: 'border-alert/30' }[tone];
  const color = { default: 'text-muted-foreground', primary: 'text-primary', alert: 'text-alert' }[tone];
  return (
    <section className={cn('bg-card border rounded-xl shadow-sm overflow-hidden', border)}>
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Icon className={cn('size-4', color)} />
          {title}
          <span className="font-mono text-foreground">({count})</span>
        </h3>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </div>
      {count === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          <CheckCircle2 className="size-8 mx-auto opacity-30" />
          <p className="text-sm font-medium mt-2">{empty}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </section>
  );
}

/* ================================ principal =============================== */

export function NurseTriage() {
  const { user } = useAuth();
  const toast = useToast();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [shift, setShift] = useState<NurseShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [escalating, setEscalating] = useState<AlertRow | null>(null);
  // Relógio local só para as contagens regressivas — não refaz requisição.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [a, s] = await Promise.all([
        alertService.getAlerts().catch(() => [] as AlertRow[]),
        nurseShiftService.getMyShift().catch(() => null),
      ]);
      setAlerts(a);
      setShift(s);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const myId = user?.id ?? null;

  const buckets = useMemo(() => {
    const out: Record<QueueBucket, AlertRow[]> = {
      OFFERED_TO_ME: [],
      OPEN: [],
      OFFERED_TO_OTHER: [],
      MINE_IN_ANALYSIS: [],
      LOCKED_BY_OTHER: [],
    };
    for (const a of alerts) {
      const bucket = classifyQueueItem(a, myId, now);
      if (bucket) out[bucket].push(a);
    }
    out.OPEN = sortOpenQueue(out.OPEN);
    return out;
    // `now` muda a cada segundo, mas só afeta a fronteira "oferta expirou".
  }, [alerts, myId, now]);

  async function act(alert: AlertRow, fn: () => Promise<void>, ok: string) {
    setBusyId(alert.id);
    try {
      await fn();
      toast.success(ok);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
      await load(true);
    } finally {
      setBusyId(null);
    }
  }

  const onClaim = (a: AlertRow) => void act(a, () => alertService.claimOffer(a.id), 'Alerta assumido.');
  const onDecline = (a: AlertRow) => void act(a, () => alertService.declineOffer(a.id), 'Alerta devolvido à fila.');

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 bg-muted rounded-xl animate-pulse" />
        <div className="h-48 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  const outros = buckets.OFFERED_TO_OTHER.concat(buckets.LOCKED_BY_OTHER);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Fila de triagem</h3>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} loading={refreshing}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
      </div>

      <ShiftBar shift={shift} onChanged={() => void load(true)} />

      <Block
        title="Ofertados a mim"
        hint="Você tem preferência até o fim da contagem; depois volta para a fila aberta."
        icon={Clock}
        tone="primary"
        count={buckets.OFFERED_TO_ME.length}
        empty="Nenhum alerta oferecido a você agora."
      >
        {buckets.OFFERED_TO_ME.map((a) => (
          <QueueRow
            key={a.id}
            alert={a}
            bucket="OFFERED_TO_ME"
            now={now}
            onClaim={onClaim}
            onDecline={onDecline}
            onEscalate={setEscalating}
            busyId={busyId}
          />
        ))}
      </Block>

      <Block
        title="Fila aberta"
        hint="Sem dono ou com oferta vencida — qualquer enfermeiro do pool pode assumir."
        icon={Inbox}
        tone={buckets.OPEN.some((a) => a.sla_breached_at) ? 'alert' : 'default'}
        count={buckets.OPEN.length}
        empty="Fila aberta vazia."
      >
        {buckets.OPEN.map((a) => (
          <QueueRow
            key={a.id}
            alert={a}
            bucket="OPEN"
            now={now}
            onClaim={onClaim}
            onDecline={onDecline}
            onEscalate={setEscalating}
            busyId={busyId}
          />
        ))}
      </Block>

      <Block
        title="Em análise por mim"
        hint="O que você travou e precisa concluir ou escalar."
        icon={Stethoscope}
        count={buckets.MINE_IN_ANALYSIS.length}
        empty="Você não tem alertas em análise."
      >
        {buckets.MINE_IN_ANALYSIS.map((a) => (
          <QueueRow
            key={a.id}
            alert={a}
            bucket="MINE_IN_ANALYSIS"
            now={now}
            onClaim={onClaim}
            onDecline={onDecline}
            onEscalate={setEscalating}
            busyId={busyId}
          />
        ))}
      </Block>

      {outros.length > 0 && (
        <Block
          title="Com outros profissionais"
          hint="Visível de propósito: se a oferta expirar, o alerta volta para a fila aberta e você pode assumir."
          icon={AlertTriangle}
          count={outros.length}
          empty=""
        >
          {buckets.OFFERED_TO_OTHER.map((a) => (
            <QueueRow
              key={a.id}
              alert={a}
              bucket="OFFERED_TO_OTHER"
              now={now}
              onClaim={onClaim}
              onDecline={onDecline}
              onEscalate={setEscalating}
              busyId={busyId}
            />
          ))}
          {buckets.LOCKED_BY_OTHER.map((a) => (
            <QueueRow
              key={a.id}
              alert={a}
              bucket="LOCKED_BY_OTHER"
              now={now}
              onClaim={onClaim}
              onDecline={onDecline}
              onEscalate={setEscalating}
              busyId={busyId}
            />
          ))}
        </Block>
      )}

      {escalating && (
        <EscalateModal
          alert={escalating}
          onClose={() => setEscalating(null)}
          onDone={() => {
            setEscalating(null);
            void load(true);
          }}
        />
      )}
    </div>
  );
}
