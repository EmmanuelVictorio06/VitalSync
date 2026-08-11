import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Droplets,
  Footprints,
  Gauge,
  HeartPulse,
  MessageCircle,
  Pencil,
  Thermometer,
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
import { useAuth } from '../auth/AuthContext';
import { sanitizeRichText } from '../lib/richText';
import { PatientEditModal } from '../components/PatientEditModal';
import { PatientFollowupSection } from '../components/PatientFollowupSection';
import { PatientDay30Section } from '../components/PatientDay30Section';
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
import { Button, Loading, PageContainer, StatusBadge, cn, statusBorder } from '../components/ui';
import { patientDashboardService } from '../services/patientDashboardService';
import { permissionService } from '../services/permissionService';
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
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<PatientDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>('BOTH');
  const [attendant, setAttendant] = useState('');
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);

  const canEditPatient = permissionService.isAdmin(user);

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
            {p.medicalRecordSummary && (
              <div className="mt-4 rounded-lg bg-muted/40 border border-border px-3.5 py-2.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Resumo de prontuário
                </span>
                {/* medical_record_summary pode vir do editor rich text (HTML sanitizado) ou,
                    para pacientes antigos, texto puro com quebras de linha literais —
                    whitespace-pre-wrap cobre os dois casos. */}
                <div
                  className="text-sm text-foreground whitespace-pre-wrap break-words [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(p.medicalRecordSummary) }}
                />
              </div>
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
                <select
                  className="max-w-full min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-2 text-xs outline-none focus:border-primary"
                  value={attendant}
                  onChange={(e) => setAttendant(e.target.value)}
                >
                  <option value="">Atendido por…</option>
                  {data.teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={markAttended} loading={marking} disabled={!attendant} className="shrink-0">
                  Marcar
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Período */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Período:</span>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setPeriod(o.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
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
          <section className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 animate-entry [animation-delay:100ms]">
            <VitalLineChart title="Temperatura" unit="°C" icon={Thermometer} data={tempSeries} domain={[35, 42]} status={worstOf(tempSeries)} />
            <VitalLineChart title="Saturação O₂" unit="%" icon={Wind} data={spo2Series} domain={[91, 100]} status={worstOf(spo2Series)} />
            <BloodPressureChart icon={Gauge} data={bpSeries} status={worstOfBp(bpSeries)} pending={ALERT_THRESHOLDS.bloodPressureSystolic.PENDING_MEDICAL_VALIDATION} />
            <VitalLineChart title="Frequência Cardíaca" unit="bpm" icon={HeartPulse} data={hrSeries} domain={[60, 130]} status={worstOf(hrSeries)} />
            <StepsBarChart icon={Footprints} data={stepsSeries} status={worstOf(stepsSeries)} />
          </section>

          {/* Indicadores do último registro */}
          {latest && (
            <>
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground pt-2">
                Indicadores do último registro ({latest.monitoringDay}º dia ·{' '}
                {latest.period === Period.MORNING ? 'manhã' : 'noite'})
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

      {/* Atendimento a cada 48h — independe de haver medições registradas */}
      {id && <PatientFollowupSection patientId={id} />}

      {/* Avaliação em 30 dias (protocolo 5.8) — desfechos + satisfação */}
      {id && <PatientDay30Section patientId={id} />}

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
