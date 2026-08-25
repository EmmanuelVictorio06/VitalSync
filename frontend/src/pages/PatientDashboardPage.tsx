import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Droplets,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  MessageCircle,
  Pencil,
  Thermometer,
  UserCog,
  Wind,
} from 'lucide-react';
import {
  ALERT_THRESHOLDS,
  ClinicalStatus,
  Period,
  evaluateRange,
  formatCivilDate,
  whatsappLink,
  worstStatus,
  type VitalThreshold,
} from '@vitalsync/shared';
import { Role, useAuth } from '../auth/AuthContext';
import { sanitizeRichText } from '../lib/richText';
import { PatientEditModal } from '../components/PatientEditModal';
import { PatientRecordSummaryModal } from '../components/PatientRecordSummaryModal';
import { PatientFollowupSection } from '../components/PatientFollowupSection';
import { PatientDay30Section } from '../components/PatientDay30Section';
import { NurseReassessmentSection, useReassessmentBadge } from '../components/NurseReassessmentSection';
import { Tabs, type TabDef } from '../components/Tabs';
import { useToast } from '../components/Toast';
import {
  BloodPressureChart,
  IndicatorCard,
  ScaleIndicatorCard,
  StepsBarChart,
  VitalLineChart,
  type DayPoint,
} from '../components/charts';
import { PatientMeasurementPhotoSection } from '../components/photo';
import { Button, CustomSelect, Loading, PageContainer, StatusBadge, cn, statusBorder } from '../components/ui';
import { patientDashboardService } from '../services/patientDashboardService';
import { permissionService } from '../services/permissionService';
import { getMissedPeriodsToday } from '../lib/staffEntry';
import type { PatientDashboard, VitalRecord } from '../lib/dto';

type PeriodFilter = 'MORNING' | 'NIGHT' | 'BOTH';
const DAYS = Array.from({ length: 10 }, (_, i) => i + 1);

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'NIGHT', label: 'Noite' },
  { value: 'BOTH', label: 'Ambos (média)' },
];

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<PatientDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>('BOTH');
  const [attendant, setAttendant] = useState('');
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordViewer, setRecordViewer] = useState<{ mode: 'view' | 'edit' } | null>(null);

  const canEditPatient = permissionService.canEditPatient(user);

  /* Aba inicial por PAPEL: o enfermeiro cai direto no fluxo dele (recontato +
     atendimentos); médico/cirurgião começam na visão clínica. `?tab=` na URL
     sempre vence — a preferência é um default, não uma trava. */
  const abaInicial = hasRole(Role.NURSE) ? 'enfermagem' : 'visao-geral';

  /* Selo de pendência da aba: mostra "atrasado" sem obrigar a abrir a aba. */
  const reassessBadge = useReassessmentBadge(id);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      setData(await patientDashboardService.getDashboard(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar o paciente.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    setAttendant('');
  }, [data?.patient.currentAlertId]);

  // Indexa registros por dia (manhã/noite) para montar as séries dos gráficos.
  const byDay = useMemo(() => {
    const map = new Map<number, { morning?: VitalRecord; night?: VitalRecord }>();
    for (const r of data?.records ?? []) {
      const e = map.get(r.monitoringDay) ?? {};
      if (r.period === Period.MORNING) e.morning = r;
      else e.night = r;
      map.set(r.monitoringDay, e);
    }
    return map;
  }, [data]);

  function recordsForDay(day: number): VitalRecord[] {
    const e = byDay.get(day);
    if (!e) return [];
    if (period === 'MORNING') return e.morning ? [e.morning] : [];
    if (period === 'NIGHT') return e.night ? [e.night] : [];
    return [e.morning, e.night].filter(Boolean) as VitalRecord[];
  }

  function lineSeries(accessor: (r: VitalRecord) => number, threshold: VitalThreshold): DayPoint[] {
    return DAYS.map((day) => {
      const recs = recordsForDay(day);
      if (recs.length === 0) return { day, value: null };
      const value = round(recs.reduce((s, r) => s + accessor(r), 0) / recs.length);
      return { day, value, status: evaluateRange(value, threshold) };
    });
  }

  const tempSeries = lineSeries((r) => r.temperature, ALERT_THRESHOLDS.temperature);
  const spo2Series = lineSeries((r) => r.spo2, ALERT_THRESHOLDS.spo2);
  const hrSeries = lineSeries((r) => r.heartRate, ALERT_THRESHOLDS.heartRate);

  const bpSeries = DAYS.map((day) => {
    const recs = recordsForDay(day);
    if (recs.length === 0) return { day, systolic: null, diastolic: null };
    const sys = round(recs.reduce((s, r) => s + r.systolic, 0) / recs.length);
    const dia = round(recs.reduce((s, r) => s + r.diastolic, 0) / recs.length);
    const status = worstStatus([
      evaluateRange(sys, ALERT_THRESHOLDS.bloodPressureSystolic),
      evaluateRange(dia, ALERT_THRESHOLDS.bloodPressureDiastolic),
    ]);
    return { day, systolic: sys, diastolic: dia, status };
  });

  // Passos: sempre do registro da noite (não fazem média com a manhã).
  const stepsSeries: DayPoint[] = DAYS.map((day) => {
    const night = byDay.get(day)?.night;
    if (!night || night.stepsCount == null) return { day, value: null };
    return { day, value: night.stepsCount, status: night.statusByVital.STEPS ?? ClinicalStatus.GREEN };
  });

  const latest = useMemo(() => {
    const recs = data?.records ?? [];
    return recs.length ? recs[recs.length - 1] : null;
  }, [data]);

  // Período(s) de hoje já com a janela fechada e sem registro — dispara o banner.
  const missedToday = useMemo(
    () => getMissedPeriodsToday(data?.records ?? [], data?.patient.monitoringDay ?? null),
    [data],
  );
  const canEnterMissedVitals = hasRole(Role.SURGEON, Role.ASSOCIATE, Role.NURSE);

  // Registros do período selecionado (para a seção de fotos da ferida).
  const periodRecords = useMemo(() => {
    const recs = data?.records ?? [];
    if (period === 'MORNING') return recs.filter((r) => r.period === Period.MORNING);
    if (period === 'NIGHT') return recs.filter((r) => r.period === Period.NIGHT);
    return recs;
  }, [data, period]);

  async function markAttended() {
    const currentAlertId = data?.patient.currentAlertId;
    if (!currentAlertId) {
      toast.error('Não há alerta atual para marcar.');
      return;
    }
    if (!attendant) {
      toast.error('Selecione o profissional que atendeu.');
      return;
    }
    setMarking(true);
    try {
      await patientDashboardService.markAttended(currentAlertId, attendant);
      toast.success('Alerta marcado como atendido.');
      setAttendant('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar atendimento.');
    } finally {
      setMarking(false);
    }
  }

  if (loading) return <PageContainer size="wide"><Loading label="Carregando painel…" /></PageContainer>;
  if (!data) return <PageContainer size="wide"><p className="text-center text-muted-foreground py-12">Paciente não encontrado.</p></PageContainer>;

  const p = data.patient;
  const worst = (s?: ClinicalStatus) => s ?? ClinicalStatus.GREEN;

  /* ── Conteúdo das abas ──────────────────────────────────────────────────
     Os componentes são os MESMOS de antes — apenas reagrupados. Nenhuma
     mudança de dado ou de RPC aqui. */

  const abaVisaoGeral = (
    <>
      {/* Período */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Período:</span>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setPeriod(o.value)}
              className={cn(
                'min-h-10 px-3 rounded-md text-xs font-semibold transition-colors',
                period === o.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {data.records.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold">Nenhuma medição registrada</p>
          <p className="text-sm mt-1">O paciente ainda não enviou nenhuma medição.</p>
        </div>
      ) : (
        <>
          <h3 className="sr-only">Gráficos de sinais vitais</h3>
          <section className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            <VitalLineChart title="Temperatura" unit="°C" icon={Thermometer} data={tempSeries} domain={[35, 42]} status={worstOf(tempSeries)} />
            <VitalLineChart title="Saturação O₂" unit="%" icon={Wind} data={spo2Series} domain={[91, 100]} status={worstOf(spo2Series)} />
            <BloodPressureChart icon={Gauge} data={bpSeries} status={worstOfBp(bpSeries)} pending={ALERT_THRESHOLDS.bloodPressureSystolic.PENDING_MEDICAL_VALIDATION} />
            <VitalLineChart title="Frequência Cardíaca" unit="bpm" icon={HeartPulse} data={hrSeries} domain={[60, 130]} status={worstOf(hrSeries)} />
            <StepsBarChart icon={Footprints} data={stepsSeries} status={worstOf(stepsSeries)} />
          </section>

          {/* Indicadores do último registro */}
          {latest && (
            <>
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground pt-2 flex items-center gap-2 flex-wrap">
                <span>
                  Indicadores do último registro ({latest.monitoringDay}º dia ·{' '}
                  {latest.period === Period.MORNING ? 'manhã' : 'noite'})
                </span>
                {latest.source === 'STAFF' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] normal-case font-semibold tracking-normal text-blue-800">
                    <UserCog className="size-3" />
                    Registrado por {latest.enteredByName ?? 'equipe'} (equipe)
                  </span>
                )}
              </h3>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <ScaleIndicatorCard title="Dor" icon={AlertCircle} value={latest.pain} status={worst(latest.statusByVital.PAIN)} />
                <ScaleIndicatorCard title="Dispneia" icon={Wind} value={latest.dyspnea} status={worst(latest.statusByVital.DYSPNEA)} />
                <IndicatorCard
                  title="Diurese"
                  icon={Droplets}
                  valueText={latest.urinationCount != null ? `${latest.urinationCount} micções` : latest.urinatedNormally ? 'Normal' : 'Reduzida'}
                  status={worst(latest.statusByVital.DIURESIS)}
                />
                <IndicatorCard
                  title="Vômitos"
                  icon={Activity}
                  valueText={latest.hadVomit ? `Sim${latest.vomitCount ? ` (${latest.vomitCount}x)` : ''}` : 'Não'}
                  status={worst(latest.statusByVital.VOMIT)}
                />
                <IndicatorCard
                  title="Sangramento"
                  icon={Droplets}
                  valueText={latest.hadBleeding ? 'Sim' : 'Não'}
                  status={worst(latest.statusByVital.BLEEDING)}
                />
              </div>
            </>
          )}

          {/* Foto da ferida operatória ou do dreno (período selecionado) */}
          <PatientMeasurementPhotoSection records={periodRecords} />
        </>
      )}
    </>
  );

  const abaEnfermagem = (
    <>
      <h3 className="sr-only">Enfermagem e atendimentos</h3>
      {id && <NurseReassessmentSection patientId={id} onChanged={load} />}
      {id && <PatientFollowupSection patientId={id} />}
    </>
  );

  const abas: TabDef[] = [
    { id: 'visao-geral', label: 'Visão geral', shortLabel: 'Visão', content: abaVisaoGeral },
    {
      id: 'enfermagem',
      label: 'Enfermagem e atendimentos',
      shortLabel: 'Enfermagem',
      badge: reassessBadge.overdue > 0 ? 'atrasado' : reassessBadge.pending || null,
      badgeTone: reassessBadge.overdue > 0 ? 'alert' : 'warning',
      content: abaEnfermagem,
    },
    {
      id: 'dia-30',
      label: 'Avaliação em 30 dias',
      shortLabel: '30 dias',
      content: (
        <>
          <h3 className="sr-only">Avaliação em 30 dias</h3>
          {id && <PatientDay30Section patientId={id} />}
        </>
      ),
    },
  ];

  return (
    <PageContainer size="wide">
      <Link
        to="/monitoring"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Voltar para pacientes
      </Link>

      {/* Resumo do paciente */}
      <section
        className={cn(
          'bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 border-l-4 animate-entry',
          statusBorder(p.currentStatus),
        )}
      >
        <div className="grid lg:grid-cols-[1fr_auto] gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">{p.name}</h2>
              <StatusBadge status={p.currentStatus} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {p.surgeryTypeName} · {p.hospitalName}
              {p.surgeonName ? ` · ${p.surgeonName}` : ''}
            </p>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-xs">
              <SummaryItem label="Data da cirurgia" value={fmt(p.surgeryDate)} />
              <SummaryItem label="Alta hospitalar" value={fmt(p.dischargeDate)} />
              <SummaryItem label="Dia de monitoramento" value={p.monitoringDay ? `D+${p.monitoringDay}` : 'Fora da janela'} mono />
              <SummaryItem label="Dias pós-alta" value={String(p.daysSinceDischarge)} mono />
            </dl>
            {p.medicalRecordSummary ? (
              <div className="mt-4 rounded-lg bg-muted/40 border border-border px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Resumo de prontuário
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => setRecordViewer({ mode: 'view' })}>
                    <FileText className="size-3.5" /> Ver prontuário completo
                  </Button>
                </div>
                {/* medical_record_summary pode vir do editor rich text (HTML sanitizado) ou,
                    para pacientes antigos, texto puro com quebras de linha literais —
                    whitespace-pre-wrap cobre os dois casos. line-clamp-3 mantém o card
                    como um resumo mesmo para prontuários longos (ver visualizador). */}
                <div
                  className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(p.medicalRecordSummary) }}
                />
              </div>
            ) : (
              canEditPatient && (
                <div className="mt-4 rounded-lg bg-muted/40 border border-border px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Resumo de prontuário
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => setRecordViewer({ mode: 'edit' })}>
                    <Pencil className="size-3.5" /> Adicionar prontuário
                  </Button>
                </div>
              )
            )}
          </div>
          <div className="flex flex-col gap-2 lg:items-end lg:min-w-64">
            {canEditPatient && (
              <Button variant="secondary" onClick={() => setEditing(true)} className="w-full lg:w-auto">
                <Pencil className="size-4" /> Editar paciente
              </Button>
            )}
            <Button
              variant="whatsapp"
              onClick={() => window.open(whatsappLink(p.phone, `Olá, ${p.name}! Aqui é da sua equipe médica.`), '_blank')}
              className="w-full lg:w-auto"
            >
              <MessageCircle className="size-4" /> Conversar no WhatsApp
            </Button>
            {p.currentAlertStatus === 'ATTENDED' ? (
              <p className="max-w-full break-words text-xs text-muted-foreground lg:text-right">
                Atendimento já marcado{p.attendedByName ? <> por <strong className="text-foreground">{p.attendedByName}</strong></> : ''}.
              </p>
            ) : p.currentAlertStatus === 'IGNORED' ? (
              <p className="max-w-full break-words text-xs text-muted-foreground lg:text-right">
                Este alerta já foi finalizado.
              </p>
            ) : p.currentAlertId ? (
              <div className="flex w-full min-w-0 items-center gap-2 text-xs font-medium lg:w-auto">
                <div className="max-w-full min-w-0 flex-1">
                  <CustomSelect
                    label=""
                    ariaLabel="Atendido por"
                    placeholder="Atendido por…"
                    value={attendant}
                    onChange={(e) => setAttendant(e.target.value)}
                    options={data.teamMembers.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </div>
                <Button size="sm" onClick={markAttended} loading={marking} disabled={!attendant} className="shrink-0">
                  Marcar
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Banner de esquecimento: período de hoje com a janela fechada e sem registro */}
      {(missedToday.morning || missedToday.night) && (
        <section className="bg-warning/10 border border-warning/20 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-warning">
            <strong>Atenção:</strong>{' '}
            {missedToday.morning && missedToday.night
              ? 'as medições da manhã e da noite de hoje ainda não foram registradas.'
              : missedToday.morning
                ? 'a medição da manhã de hoje ainda não foi registrada.'
                : 'a medição da noite de hoje ainda não foi registrada.'}
          </p>
          {canEnterMissedVitals && id && (
            <div className="flex gap-2">
              {missedToday.morning && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/patients/${id}/registrar-medicao?period=MORNING`)}>
                  Registrar manhã
                </Button>
              )}
              {missedToday.night && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/patients/${id}/registrar-medicao?period=NIGHT`)}>
                  Registrar noite
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Abas: o urgente (banner acima) fica fora delas, sempre visível. */}
      <Tabs tabs={abas} defaultTab={abaInicial} ariaLabel="Seções do acompanhamento do paciente" />

      {editing && id && (
        <PatientEditModal
          patientId={id}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      )}

      {recordViewer && id && (
        <PatientRecordSummaryModal
          patientId={id}
          patientName={p.name}
          html={p.medicalRecordSummary ?? ''}
          canEdit={canEditPatient}
          initialMode={recordViewer.mode}
          onClose={() => setRecordViewer(null)}
          onSaved={load}
        />
      )}
    </PageContainer>
  );
}

function SummaryItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 font-semibold', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
const fmt = formatCivilDate;
function worstOf(series: DayPoint[]): ClinicalStatus {
  return reduceStatus(series.map((s) => s.status));
}
function worstOfBp(series: Array<{ status?: ClinicalStatus }>): ClinicalStatus {
  return reduceStatus(series.map((s) => s.status));
}
function reduceStatus(list: Array<ClinicalStatus | undefined>): ClinicalStatus {
  const sev = { GREEN: 0, YELLOW: 1, RED: 2 } as const;
  return list.reduce<ClinicalStatus>((acc, s) => (s && sev[s] > sev[acc] ? s : acc), ClinicalStatus.GREEN);
}
