/**
 * NurseReassessmentSection — "Recontato de enfermagem" (migration 0078).
 *
 * Depois de a enfermagem atender um alerta AMARELO, o sistema agenda um
 * recontato com prazo. Esta seção mostra a pendência (com contagem regressiva e
 * destaque de atraso), o formulário de desfecho e o histórico das concluídas.
 *
 * "Piorou" NÃO escala sozinho: o banco devolve `shouldEscalate` e a tela oferece
 * o botão. Escalar continua sendo um ato explícito e auditável (0077/0078).
 *
 * Papéis: só a enfermagem registra (a RPC recusa os demais). Para quem não é
 * enfermagem a seção é somente-leitura. A seção fica sempre visível na aba de
 * enfermagem; sem recontato, mostra um estado vazio explicando quando ele surge.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ClockAlert, Loader2, ArrowUpRight } from 'lucide-react';
import { Role, useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { Button, ConfirmModal, TextareaField, cn } from './ui';
import {
  OUTCOME_LABEL,
  dueLabel,
  minutesUntil,
  nurseReassessmentService,
  type NurseReassessment,
  type ReassessmentOutcome,
} from '../services/nurseReassessmentService';

const OUTCOME_OPTIONS: Array<{ value: ReassessmentOutcome; label: string; hint: string }> = [
  { value: 'IMPROVED', label: 'Melhorou', hint: 'Sinais e sintomas cederam' },
  { value: 'UNCHANGED', label: 'Mantém', hint: 'Segue igual, sem piora' },
  { value: 'WORSENED', label: 'Piorou', hint: 'Precisa de avaliação médica' },
];

function fmtDateTime(iso: string): string {
  // Fuso da clínica: o prazo é combinado em horário de São Paulo (M-15/M-16).
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
}

export function NurseReassessmentSection({
  patientId,
  onChanged,
}: {
  patientId: string;
  /** Avisa a página para recarregar o alerta atual (escalar muda o estado dele). */
  onChanged?: () => void;
}) {
  const { hasRole } = useAuth();
  const toast = useToast();
  const isNurse = hasRole(Role.NURSE);

  const [rows, setRows] = useState<NurseReassessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<ReassessmentOutcome | ''>('');
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);
  const [escalateTarget, setEscalateTarget] = useState<{ id: string; observation: string } | null>(null);
  // Relógio de 1 min: mantém a contagem regressiva viva sem recarregar dados.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await nurseReassessmentService.listByPatient(patientId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar os recontatos.');
    } finally {
      setLoading(false);
    }
    // toast é estável no provider; incluí-lo recarregaria a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const pendente = useMemo(() => rows.find((r) => r.status === 'PENDING') ?? null, [rows]);
  const historico = useMemo(() => rows.filter((r) => r.status !== 'PENDING'), [rows]);

  async function registrar() {
    if (!pendente || !outcome) return;
    setSaving(true);
    try {
      const { shouldEscalate } = await nurseReassessmentService.complete(pendente.id, outcome, observation.trim());
      toast.success('Recontato registrado.');
      const obs = observation.trim();
      setOutcome('');
      setObservation('');
      await load();
      // NÃO chamar onChanged aqui: registrar o desfecho não altera o alerta, e
      // o reload da página troca a árvore por <Loading/> — o que DESMONTARIA
      // esta seção e engoliria o modal de escalada logo abaixo. A página só
      // precisa recarregar depois de escalar, onde o alerta muda de fato.
      if (shouldEscalate) setEscalateTarget({ id: pendente.id, observation: obs });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível registrar o recontato.');
    } finally {
      setSaving(false);
    }
  }

  async function escalar() {
    if (!escalateTarget) return;
    try {
      await nurseReassessmentService.escalate(escalateTarget.id, escalateTarget.observation);
      toast.success('Caso escalado para o médico da equipe.');
      setEscalateTarget(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível escalar o caso.');
    }
  }

  // A seção fica sempre visível na aba de enfermagem: quando não há recontato,
  // mostra um estado vazio explicando quando ele é criado (ver bloco abaixo).
  const atrasada = pendente ? minutesUntil(pendente.due_at, now) < 0 : false;

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 space-y-4">
      <header className="flex items-center gap-2 flex-wrap">
        <CalendarClock className="size-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Recontato de enfermagem
        </h3>
        {atrasada && (
          <span className="inline-flex items-center gap-1 rounded-full bg-alert/10 border border-alert/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-alert">
            <ClockAlert className="size-3" /> Em atraso
          </span>
        )}
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <>
          {!pendente && historico.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum recontato de enfermagem no momento. Um recontato de 2h é criado
              automaticamente quando a enfermagem atende um alerta amarelo deste paciente.
            </p>
          )}

          {pendente && (
            <div
              className={cn(
                'rounded-lg border p-4 space-y-4',
                atrasada ? 'border-alert/40 bg-alert/5' : 'border-warning/40 bg-warning/5',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  Previsto para <span className="font-mono">{fmtDateTime(pendente.due_at)}</span>
                </p>
                <span className={cn('text-xs font-bold', atrasada ? 'text-alert' : 'text-muted-foreground')}>
                  {dueLabel(pendente.due_at, now)}
                </span>
              </div>

              {isNurse ? (
                /* Desktop: desfecho à esquerda, observação à direita. Mobile: empilha. */
                <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
                  <fieldset className="min-w-0">
                    <legend className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Como o paciente está?
                    </legend>
                    <div className="flex flex-col gap-1.5">
                      {OUTCOME_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setOutcome(o.value)}
                          aria-pressed={outcome === o.value}
                          className={cn(
                            'min-h-10 text-left rounded-lg border px-3 py-2 transition-colors',
                            outcome === o.value
                              ? 'border-primary ring-1 ring-primary bg-primary/5'
                              : 'border-border hover:border-primary/40',
                          )}
                        >
                          <span className="text-sm font-semibold">{o.label}</span>
                          <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="min-w-0 flex flex-col">
                    <TextareaField
                      label="O que o paciente relatou"
                      required
                      rows={5}
                      value={observation}
                      onChange={(e) => setObservation(e.target.value)}
                      placeholder="Ex.: Refere que a dor diminuiu, sem febre desde ontem; orientada a manter hidratação."
                    />
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Button onClick={registrar} loading={saving} disabled={!outcome || !observation.trim()}>
                        <CheckCircle2 className="size-4" /> Registrar recontato
                      </Button>
                      {outcome === 'WORSENED' && (
                        <span className="text-[11px] text-muted-foreground">
                          Ao registrar, você poderá escalar para o médico.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  O recontato é registrado pelo profissional de enfermagem.
                </p>
              )}
            </div>
          )}

          {historico.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Histórico
              </h4>
              <ul className="space-y-2">
                {historico.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.status === 'DONE' && r.outcome ? (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border',
                            r.outcome === 'IMPROVED' && 'bg-stable/10 text-stable border-stable/30',
                            r.outcome === 'UNCHANGED' && 'bg-warning/10 text-warning border-warning/30',
                            r.outcome === 'WORSENED' && 'bg-alert/10 text-alert border-alert/30',
                          )}
                        >
                          {OUTCOME_LABEL[r.outcome]}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                          Cancelada
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {r.performed_at ? fmtDateTime(r.performed_at) : fmtDateTime(r.created_at)}
                      </span>
                    </div>
                    {r.observation && (
                      <p className="text-sm mt-1.5 whitespace-pre-wrap break-words">{r.observation}</p>
                    )}
                    {r.cancel_reason && (
                      <p className="text-xs mt-1 text-muted-foreground">{r.cancel_reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {escalateTarget && (
        <ConfirmModal
          title="Escalar para o médico?"
          message={
            'O paciente piorou no recontato. O alerta será reaberto e o médico da equipe avisado. ' +
            'A classificação clínica não muda — o escalonamento fica registrado à parte.'
          }
          confirmLabel="Escalar para o médico"
          onConfirm={escalar}
          onCancel={() => setEscalateTarget(null)}
        />
      )}
    </section>
  );
}

/** Selo de pendência para a aba (mostra atraso sem precisar abrir a seção). */
export function useReassessmentBadge(patientId: string | undefined): { pending: number; overdue: number } {
  const [state, setState] = useState({ pending: 0, overdue: 0 });
  useEffect(() => {
    if (!patientId) return;
    let vivo = true;
    nurseReassessmentService
      .listByPatient(patientId)
      .then((rows) => {
        if (!vivo) return;
        const pend = rows.filter((r) => r.status === 'PENDING');
        setState({
          pending: pend.length,
          overdue: pend.filter((r) => minutesUntil(r.due_at) < 0).length,
        });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [patientId]);
  return state;
}
