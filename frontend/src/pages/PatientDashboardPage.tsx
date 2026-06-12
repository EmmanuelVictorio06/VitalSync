import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ALERT_THRESHOLDS,
  ClinicalStatus,
  Period,
  evaluateRange,
  formatCivilDate,
  whatsappLink,
  type VitalThreshold,
} from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import {
  BloodPressureChart,
  IndicatorCard,
  StepsBarChart,
  VitalLineChart,
  type DayPoint,
} from '../components/charts';
import { Button, Loading, SelectField, StatusBadge } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { PatientDashboard, VitalRecord } from '../lib/dto';

type PeriodFilter = 'MORNING' | 'NIGHT' | 'BOTH';
const DAYS = Array.from({ length: 10 }, (_, i) => i + 1);

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [data, setData] = useState<PatientDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>('BOTH');
  const [attendant, setAttendant] = useState('');
  const [marking, setMarking] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      setData(await api.get<PatientDashboard>(`/patients/${id}/dashboard`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o paciente.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);

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
    return { day, systolic: sys, diastolic: dia, status: evaluateRange(sys, ALERT_THRESHOLDS.bloodPressure) };
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

  async function markAttended() {
    if (!id || !attendant) {
      toast.error('Selecione o profissional que atendeu.');
      return;
    }
    setMarking(true);
    try {
      await api.post(`/patients/${id}/attend`, { attendedByUserId: attendant });
      toast.success('Atendimento registrado. O card foi atualizado para a equipe.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao registrar atendimento.');
    } finally {
      setMarking(false);
    }
  }

  if (loading) return <Loading label="Carregando painel…" />;
  if (!data) return <p className="empty">Paciente não encontrado.</p>;

  const p = data.patient;
  const worst = (s?: ClinicalStatus) => s ?? ClinicalStatus.GREEN;

  return (
    <div className="stack">
      <div>
        <h1>Painel de acompanhamento</h1>
        <p className="subtext">Evolução diária dos sinais vitais nos 10 dias de monitoramento.</p>
      </div>

      {/* Resumo do paciente */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <div className="card-title" style={{ fontSize: '1.3rem' }}>{p.name}</div>
            <div className="muted">{p.surgeryTypeName} · {p.hospitalName}</div>
          </div>
          <span className="spacer" />
          <div className="pill-day">{p.monitoringDay ? `${p.monitoringDay}º dia` : 'Fora da janela'}</div>
          <StatusBadge status={p.currentStatus} />
        </div>
        <div className="divider" />
        <div className="grid grid-3">
          <div className="kv"><span>Cirurgião</span><span>{p.surgeonName ?? '—'}</span></div>
          <div className="kv"><span>Data da cirurgia</span><span>{fmt(p.surgeryDate)}</span></div>
          <div className="kv"><span>Alta hospitalar</span><span>{fmt(p.dischargeDate)}</span></div>
          <div className="kv"><span>Dias pós-alta</span><span>{p.daysSinceDischarge}</span></div>
        </div>
      </div>

      {/* Período */}
      <div className="card">
        <div className="block-title">Período de monitoramento</div>
        <div className="toggle-group">
          <Button variant={period === 'MORNING' ? 'primary' : 'ghost'} onClick={() => setPeriod('MORNING')}>Manhã</Button>
          <Button variant={period === 'NIGHT' ? 'primary' : 'ghost'} onClick={() => setPeriod('NIGHT')}>Noite</Button>
          <Button variant={period === 'BOTH' ? 'primary' : 'ghost'} onClick={() => setPeriod('BOTH')}>Ambos (média)</Button>
        </div>
      </div>

      {data.records.length === 0 ? (
        <p className="empty">O paciente ainda não enviou nenhuma medição.</p>
      ) : (
        <>
          <div className="grid grid-2">
            <VitalLineChart title="Temperatura" unit="°C" data={tempSeries} domain={[35, 42]} status={worstOf(tempSeries)} />
            <VitalLineChart title="Saturação (SpO₂)" unit="%" data={spo2Series} domain={[91, 100]} status={worstOf(spo2Series)} />
            <BloodPressureChart data={bpSeries} status={worstOfBp(bpSeries)} pending={ALERT_THRESHOLDS.bloodPressure.PENDING_MEDICAL_VALIDATION} />
            <VitalLineChart title="Frequência cardíaca" unit="bpm" data={hrSeries} domain={[60, 130]} status={worstOf(hrSeries)} />
            <StepsBarChart data={stepsSeries} status={worstOf(stepsSeries)} />
          </div>

          {/* Indicadores do último registro */}
          {latest && (
            <>
              <div className="block-title">Indicadores do último registro ({latest.monitoringDay}º dia · {latest.period === Period.MORNING ? 'manhã' : 'noite'})</div>
              <div className="grid grid-3">
                <IndicatorCard title="Diurese" valueText={latest.urinationCount != null ? `${latest.urinationCount} micções` : latest.urinatedNormally ? 'Normal' : 'Reduzida'} status={worst(latest.statusByVital.DIURESIS)} />
                <IndicatorCard title="Vômitos" valueText={latest.hadVomit ? `Sim${latest.vomitCount ? ` (${latest.vomitCount}x)` : ''}` : 'Não'} status={worst(latest.statusByVital.VOMIT)} />
                <IndicatorCard title="Sangramento" valueText={latest.hadBleeding ? 'Sim' : 'Não'} status={worst(latest.statusByVital.BLEEDING)} />
                <IndicatorCard title="Nível de dor" valueText={`${latest.pain} / 10`} status={worst(latest.statusByVital.PAIN)} />
                <IndicatorCard title="Dispneia" valueText={`${latest.dyspnea} / 10`} status={worst(latest.statusByVital.DYSPNEA)} />
              </div>
            </>
          )}
        </>
      )}

      {/* Confirmação de atendimento */}
      <div className="card stack">
        <div className="block-title">Confirmação de atendimento</div>
        {p.attendedByName ? (
          <p className="muted">✓ Já atendido por <strong>{p.attendedByName}</strong>. Será resetado quando o paciente enviar uma nova medição.</p>
        ) : (
          <p className="muted">Marque o atendimento para avisar o restante da equipe.</p>
        )}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SelectField
              label="Atendido por"
              value={attendant}
              onChange={(e) => setAttendant(e.target.value)}
              options={data.teamMembers.map((m) => ({ value: m.id, label: m.name }))}
              placeholder="Selecione o profissional"
            />
          </div>
          <Button onClick={markAttended} loading={marking}>Marcar como atendido</Button>
          <Button
            variant="whatsapp"
            onClick={() => window.open(whatsappLink(p.phone, `Olá, ${p.name}! Aqui é da sua equipe médica.`), '_blank')}
          >
            Conversar
          </Button>
        </div>
      </div>
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
