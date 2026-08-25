/**
 * Central de Enfermagem — dashboard do Profissional de Enfermagem.
 *
 * Diferente do painel dos médicos (visão gerencial: gráficos, donut de status),
 * aqui a tela responde três perguntas operacionais do protocolo do estudo:
 * "o que preciso fazer agora", "com quem preciso falar" e "o que está vencendo".
 * A composição dos dados fica em `services/nurseDashboardService.ts` e as regras
 * derivadas em `lib/nurseDashboard.ts` (testadas).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { whatsappLink } from '@vitalsync/shared';
import { openForLabel, recheckCountdown } from '../lib/nurseDashboard';
import { nurseDashboardService, type AgendaItem, type NurseDashboardData } from '../services/nurseDashboardService';
import type { AlertRow } from '../services/alertService';
import type { MissingMeasurementPatient } from '../services/patientService';
import { DashboardMetricCard } from './dashboard';
import { NurseTriage } from './NurseTriage';
import { NurseReassessmentQueue } from './NurseReassessmentQueue';
import { Button, StatusBadge, cn } from './ui';

/** Nº de itens mostrados em cada lista antes do "ver todos". */
const PREVIEW_LIMIT = 5;

const PERIOD_LABEL: Record<MissingMeasurementPatient['period'], string> = {
  MORNING: 'manhã',
  NIGHT: 'noite',
};

/* ============================ blocos auxiliares ============================ */

function SectionCard({
  title,
  description,
  icon: Icon,
  tone = 'default',
  action,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'alert' | 'warning';
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneCls = {
    default: 'border-border',
    alert: 'border-alert/30',
    warning: 'border-warning/30',
  }[tone];
  const iconCls = {
    default: 'text-primary',
    alert: 'text-alert',
    warning: 'text-warning',
  }[tone];
  return (
    <section className={cn('bg-card border rounded-xl shadow-sm overflow-hidden', toneCls)}>
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Icon className={cn('size-4', iconCls)} />
            {title}
          </h2>
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <CheckCircle2 className="size-8 mx-auto opacity-30" />
      <p className="text-sm font-medium mt-2">{message}</p>
    </div>
  );
}

/* ============================== a) triagem ================================ */

function AlertQueueRow({ alert }: { alert: AlertRow }) {
  const isRed = alert.status === 'RED';
  return (
    <li className={cn('px-4 py-3 flex items-center justify-between gap-3 flex-wrap', isRed && 'bg-alert/5')}>
      <div className="min-w-0">
        <p className="text-sm font-bold truncate">{alert.patient?.name ?? '—'}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {alert.type ?? 'Sinais vitais'} · aberto {openForLabel(alert.created_at)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={alert.status} />
        <Link
          to="/alerts"
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors"
          title="Abrir a fila de alertas para triagem"
        >
          Triar
        </Link>
      </div>
    </li>
  );
}

/* ========================= d) agenda de acompanhamento ==================== */

function AgendaList({ items, emptyMessage }: { items: AgendaItem[]; emptyMessage: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground px-4 py-3">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.slice(0, PREVIEW_LIMIT).map((item) => (
        <li key={item.patientId} className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{item.patientName}</p>
            <p className="text-[11px] text-muted-foreground">
              D+{item.daysSinceDischarge} pós-alta
              {item.monitoringDay ? ` · dia ${item.monitoringDay} de monitoramento` : ''}
            </p>
          </div>
          <Link to={`/patients/${item.patientId}`} className="text-xs font-semibold text-primary hover:underline shrink-0">
            Abrir
          </Link>
        </li>
      ))}
      {items.length > PREVIEW_LIMIT && (
        <li className="px-4 py-2 text-[11px] text-muted-foreground">
          +{items.length - PREVIEW_LIMIT} paciente(s) além dos exibidos.
        </li>
      )}
    </ul>
  );
}

/* ================================ principal =============================== */

export function NurseDashboard() {
  const [data, setData] = useState<NurseDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setData(await nurseDashboardService.getDashboard());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <p className="font-semibold">Não foi possível carregar a central de enfermagem.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void load(true)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { triage, rechecks, missing, agenda, myDay } = data;
  const overdueRechecks = rechecks.filter((r) => recheckCountdown(r.recheckDueAt).overdue).length;

  return (
    <div className="space-y-6">
      {/* Contadores do topo */}
      <section className="animate-entry">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Central de Enfermagem</h3>
          <Button variant="ghost" size="sm" onClick={() => void load(true)} loading={refreshing}>
            <RefreshCw className="size-3.5" /> Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          <DashboardMetricCard label="Alertas vermelhos" value={triage.counts.red} icon={TriangleAlert} tone="alert" />
          <DashboardMetricCard label="Alertas amarelos" value={triage.counts.yellow} icon={TriangleAlert} tone="warning" />
          <DashboardMetricCard label="Em análise por mim" value={triage.counts.mine} icon={ClipboardCheck} tone="primary" />
          <DashboardMetricCard label="Reaferições em aberto" value={rechecks.length} icon={Timer} tone={overdueRechecks > 0 ? 'alert' : 'warning'} />
          <DashboardMetricCard label="Sem medição hoje" value={missing.length} icon={PhoneCall} tone="warning" />
        </div>
      </section>

      {/* Plantão + fila de triagem (oferta / fila aberta / em análise) */}
      <NurseTriage />

      {/* Recontatos de 2h agendados ao atender um amarelo (0078). Fica logo
          abaixo da triagem porque é a continuação natural dela: o que eu
          atendi e preciso conferir depois. */}
      <NurseReassessmentQueue />

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-6 animate-entry [animation-delay:100ms]">
          {/* a) Preciso agir agora */}
          <SectionCard
            title="Preciso agir agora"
            description="Fila de triagem — vermelhos primeiro e, na mesma severidade, quem espera há mais tempo."
            icon={TriangleAlert}
            tone={triage.counts.red > 0 ? 'alert' : 'default'}
            action={
              <Link to="/alerts" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                Ver todos <ArrowRight className="size-3" />
              </Link>
            }
          >
            {triage.pending.length === 0 ? (
              <EmptyState message="Nenhum alerta aguardando triagem." />
            ) : (
              <ul className="divide-y divide-border">
                {triage.pending.slice(0, PREVIEW_LIMIT).map((a) => (
                  <AlertQueueRow key={a.id} alert={a} />
                ))}
              </ul>
            )}
          </SectionCard>

          {/* a2) Em análise por mim */}
          {triage.mine.length > 0 && (
            <SectionCard
              title="Em análise por mim"
              description="Alertas que você travou e ainda precisa concluir."
              icon={ClipboardCheck}
            >
              <ul className="divide-y divide-border">
                {triage.mine.slice(0, PREVIEW_LIMIT).map((a) => (
                  <AlertQueueRow key={a.id} alert={a} />
                ))}
              </ul>
            </SectionCard>
          )}

          {/* b) Reaferições de 2h */}
          <SectionCard
            title="Reaferições de 2h"
            description="Amarelo isolado pede nova medição em 2h (protocolo 5.7.2)."
            icon={Timer}
            tone={overdueRechecks > 0 ? 'alert' : 'default'}
          >
            {rechecks.length === 0 ? (
              <EmptyState message="Nenhuma reaferição pendente." />
            ) : (
              <ul className="divide-y divide-border">
                {rechecks.slice(0, PREVIEW_LIMIT).map((r) => {
                  const countdown = recheckCountdown(r.recheckDueAt);
                  return (
                    <li
                      key={r.alertId}
                      className={cn('px-4 py-3 flex items-center justify-between gap-3 flex-wrap', countdown.overdue && 'bg-alert/5')}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{r.patientName}</p>
                        <p className={cn('text-xs mt-0.5', countdown.overdue ? 'text-alert font-semibold' : 'text-muted-foreground')}>
                          {r.type ?? 'Sinais vitais'} · reaferição {countdown.label}
                        </p>
                      </div>
                      <Link
                        to={`/patients/${r.patientId}`}
                        className="text-xs font-semibold text-primary hover:underline shrink-0"
                        title="Abrir acompanhamento do paciente"
                      >
                        Acompanhar
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* c) Contato ativo */}
          <SectionCard
            title="Contato ativo — sem medição hoje"
            description="A janela de coleta já fechou sem registro (protocolo 5.6.3/5.6.4). Ligue e, se necessário, lance a medição."
            icon={PhoneCall}
            tone={missing.length > 0 ? 'warning' : 'default'}
          >
            {missing.length === 0 ? (
              <EmptyState message="Todos os pacientes registraram as medições de hoje." />
            ) : (
              <ul className="divide-y divide-border">
                {missing.map((p) => (
                  <li key={`${p.id}-${p.period}`} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Medição da {PERIOD_LABEL[p.period]} pendente
                        {p.phone ? ` · ${p.phone}` : ' · sem telefone cadastrado'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.phone && (
                        <a
                          href={whatsappLink(
                            p.phone,
                            `Olá, ${p.name.split(' ')[0]}! Notamos que sua medição de hoje ainda não foi registrada. Poderia enviar assim que possível?`,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#25D366] text-white hover:opacity-90 transition-opacity"
                        >
                          <MessageCircle className="size-3.5" /> WhatsApp
                        </a>
                      )}
                      <Link
                        to={`/patients/${p.id}/registrar-medicao?period=${p.period}`}
                        className="px-3 py-1.5 border border-primary/30 bg-card text-primary rounded-md text-xs font-semibold hover:bg-accent transition-colors"
                        title="Lançar a medição em nome do paciente"
                      >
                        Lançar medição
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Coluna lateral: agenda + meu dia */}
        <aside className="space-y-6 animate-entry [animation-delay:200ms]">
          <SectionCard
            title="Agenda de acompanhamento"
            description="Contatos previstos pelo protocolo, derivados das datas de alta."
            icon={CalendarClock}
          >
            <div className="divide-y divide-border">
              <div>
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Videochamada de 48h
                </p>
                <AgendaList items={agenda.followup48h} emptyMessage="Nenhuma videochamada de 48h pendente." />
              </div>
              <div>
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Avaliação de 30 dias
                </p>
                <AgendaList items={agenda.day30} emptyMessage="Nenhuma avaliação de D+30 pendente." />
              </div>
              <div>
                <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Fim de monitoramento próximo
                </p>
                <AgendaList items={agenda.endingSoon} emptyMessage="Nenhum paciente encerrando o monitoramento." />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Meu dia" icon={ClipboardCheck}>
            <dl className="divide-y divide-border">
              <div className="px-4 py-3 flex items-center justify-between">
                <dt className="text-xs text-muted-foreground">Alertas que atendi hoje</dt>
                <dd className="text-lg font-extrabold font-mono">{myDay.attendedToday}</dd>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <dt className="text-xs text-muted-foreground">Medições que lancei hoje</dt>
                <dd className="text-lg font-extrabold font-mono">{myDay.measurementsEnteredToday}</dd>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <dt className="text-xs text-muted-foreground">Pacientes ativos das minhas equipes</dt>
                <dd className="text-lg font-extrabold font-mono">{myDay.activePatients}</dd>
              </div>
            </dl>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
