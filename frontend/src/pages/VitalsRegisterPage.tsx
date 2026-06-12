import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Period, formatCivilDate } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { Button, Field, IntensityScale, Loading, TextInput, YesNo } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { PatientLinkInfo } from '../lib/dto';

type Step = 'choose' | 'form' | 'success';

export function VitalsRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const toast = useToast();
  const [info, setInfo] = useState<PatientLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [period, setPeriod] = useState<Period>(Period.MORNING);

  useEffect(() => {
    if (!token) return;
    api
      .get<PatientLinkInfo>(`/public/link/${token}`, false)
      .then(setInfo)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Link inválido.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="center-screen"><Loading label="Abrindo seu registro…" /></div>;
  if (error || !info) {
    return (
      <div className="center-screen">
        <div className="card auth-card" style={{ textAlign: 'center' }}>
          <h2>Link indisponível</h2>
          <p className="subtext">{error ?? 'Não foi possível abrir este link.'}</p>
          <p className="muted">Solicite um novo link à sua equipe médica.</p>
        </div>
      </div>
    );
  }

  const p = info.patient;

  if (step === 'success') {
    return <SuccessScreen />;
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }} className="stack">
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '1.4rem' }}>VitalSync</div>
        <h1 style={{ fontSize: '1.2rem' }}>Registro de sinais vitais</h1>
      </div>

      {/* Resumo do paciente */}
      <div className="card">
        <div className="card-title">{p.name}</div>
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <div className="kv"><span>Idade</span><span>{p.age} anos</span></div>
          <div className="kv"><span>Monitoramento</span><span>{p.monitoringDay ? `${p.monitoringDay}º dia` : '—'}</span></div>
          <div className="kv"><span>Cirurgia</span><span>{fmt(p.surgeryDate)}</span></div>
          <div className="kv"><span>Alta</span><span>{fmt(p.dischargeDate)}</span></div>
        </div>
      </div>

      {!p.withinWindow ? (
        <div className="card" style={{ textAlign: 'center', borderColor: 'var(--yellow)' }}>
          <h2>Monitoramento encerrado</h2>
          <p className="subtext">O período de 10 dias de acompanhamento não está ativo nesta data. Em caso de sintomas, contate sua equipe.</p>
        </div>
      ) : step === 'choose' ? (
        <div className="card stack">
          <div className="block-title">Quando você está registrando?</div>
          <Button size="lg" block onClick={() => { setPeriod(Period.MORNING); setStep('form'); }}>
            ☀️ Manhã (ao acordar)
          </Button>
          <Button size="lg" block variant="secondary" onClick={() => { setPeriod(Period.NIGHT); setStep('form'); }}>
            🌙 Noite (antes de dormir)
          </Button>
        </div>
      ) : (
        <MeasurementForm
          token={token!}
          period={period}
          ranges={info.inputRanges}
          onBack={() => setStep('choose')}
          onSuccess={() => setStep('success')}
        />
      )}
    </div>
  );
}

function MeasurementForm({
  token, period, ranges, onBack, onSuccess,
}: {
  token: string;
  period: Period;
  ranges: PatientLinkInfo['inputRanges'];
  onBack: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [temperature, setTemperature] = useState('');
  const [spo2, setSpo2] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [pain, setPain] = useState<number | null>(null);
  const [dyspnea, setDyspnea] = useState<number | null>(null);
  const [urinatedNormally, setUrinatedNormally] = useState<boolean | null>(null);
  const [urinationCount, setUrinationCount] = useState('');
  const [hadVomit, setHadVomit] = useState<boolean | null>(null);
  const [vomitCount, setVomitCount] = useState('');
  const [hadBleeding, setHadBleeding] = useState<boolean | null>(null);
  const [steps, setSteps] = useState('');

  const isNight = period === Period.NIGHT;
  const today = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  function num(v: string): number {
    return Number(v.replace(',', '.'));
  }

  function validate(): string | null {
    if (!temperature || !spo2 || !systolic || !diastolic || !heartRate)
      return 'Preencha todos os campos de medição.';
    if (pain === null || dyspnea === null) return 'Informe os níveis de dor e de dispneia.';
    if (urinatedNormally === null) return 'Responda sobre a diurese.';
    if (hadVomit === null) return 'Responda sobre vômitos.';
    if (hadBleeding === null) return 'Responda sobre sangramentos.';
    const checks: Array<[string, number, { min: number; max: number }]> = [
      ['Temperatura', num(temperature), ranges.temperature],
      ['Saturação', num(spo2), ranges.spo2],
      ['Pressão sistólica', num(systolic), ranges.systolic],
      ['Pressão diastólica', num(diastolic), ranges.diastolic],
      ['Frequência cardíaca', num(heartRate), ranges.heartRate],
    ];
    for (const [label, value, r] of checks) {
      if (Number.isNaN(value)) return `Informe um número válido para ${label}.`;
      if (value < r.min || value > r.max) return `${label} deve estar entre ${r.min} e ${r.max}.`;
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await api.post(
        `/public/link/${token}/records`,
        {
          period,
          temperature: num(temperature),
          spo2: num(spo2),
          systolic: num(systolic),
          diastolic: num(diastolic),
          heartRate: num(heartRate),
          pain,
          dyspnea,
          urinatedNormally,
          urinationCount: urinatedNormally && urinationCount ? Number(urinationCount) : null,
          hadVomit,
          vomitCount: hadVomit && vomitCount ? Number(vomitCount) : null,
          hadBleeding,
          stepsCount: isNight && steps ? Number(steps) : null,
        },
        false,
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card" style={{ textAlign: 'center', padding: 12 }}>
        <strong>{today}</strong> · Período: {isNight ? '🌙 Noite' : '☀️ Manhã'}
      </div>

      <div className="card">
        <div className="block-title">Temperatura</div>
        <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>Use o termômetro digital.</p>
        <TextInput label="Temperatura" inputMode="decimal" placeholder={ranges.temperature.example} hint={`${ranges.temperature.unit} · entre ${ranges.temperature.min} e ${ranges.temperature.max}`} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
      </div>

      <div className="card">
        <div className="block-title">Saturação de oxigênio</div>
        <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>Use o oxímetro de dedo.</p>
        <TextInput label="Saturação" inputMode="numeric" placeholder={ranges.spo2.example} hint={`${ranges.spo2.unit} · entre ${ranges.spo2.min} e ${ranges.spo2.max}`} value={spo2} onChange={(e) => setSpo2(e.target.value)} />
      </div>

      <div className="card">
        <div className="block-title">Pressão arterial e batimentos</div>
        <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>
          Use o aparelho de pressão.
          {(ranges.systolic.PENDING_MEDICAL_VALIDATION || ranges.heartRate.PENDING_MEDICAL_VALIDATION) && (
            <span className="pending-flag" style={{ marginLeft: 6 }}>faixas a confirmar</span>
          )}
        </p>
        <div className="grid grid-2">
          <TextInput label="Sistólica" inputMode="numeric" placeholder={ranges.systolic.example} hint="mmHg" value={systolic} onChange={(e) => setSystolic(e.target.value)} />
          <TextInput label="Diastólica" inputMode="numeric" placeholder={ranges.diastolic.example} hint="mmHg" value={diastolic} onChange={(e) => setDiastolic(e.target.value)} />
          <TextInput label="Frequência cardíaca" inputMode="numeric" placeholder={ranges.heartRate.example} hint="bpm" value={heartRate} onChange={(e) => setHeartRate(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="block-title">Nível de dor</div>
        <IntensityScale value={pain} onChange={setPain} leftLabel="0 – Sem dor" rightLabel="10 – Dor extrema" colorFor={(n) => (n <= 6 ? 'g' : n <= 8 ? 'y' : 'r')} />
      </div>

      <div className="card">
        <div className="block-title">Dispneia (falta de ar)</div>
        <IntensityScale value={dyspnea} onChange={setDyspnea} leftLabel="0 – Respiração normal" rightLabel="10 – Falta de ar extrema" colorFor={(n) => (n === 0 ? 'g' : n <= 5 ? 'y' : 'r')} />
      </div>

      <div className="card">
        <div className="block-title">Diurese</div>
        <Field label="Urinou normalmente?"><YesNo value={urinatedNormally} onChange={setUrinatedNormally} /></Field>
        {urinatedNormally === true && (
          <TextInput label="Quantas vezes?" inputMode="numeric" placeholder="Ex.: 5" value={urinationCount} onChange={(e) => setUrinationCount(e.target.value)} />
        )}
      </div>

      <div className="card">
        <div className="block-title">Vômitos</div>
        <Field label="Teve episódios de vômito?"><YesNo value={hadVomit} onChange={setHadVomit} /></Field>
        {hadVomit === true && (
          <TextInput label="Quantas vezes?" inputMode="numeric" placeholder="Ex.: 2" value={vomitCount} onChange={(e) => setVomitCount(e.target.value)} />
        )}
      </div>

      <div className="card">
        <div className="block-title">Sangramentos</div>
        <Field label="Observou sangue no vômito, fezes ou urina?"><YesNo value={hadBleeding} onChange={setHadBleeding} /></Field>
      </div>

      {isNight && (
        <div className="card">
          <div className="block-title">Contagem de passos</div>
          <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>Verifique seu smartwatch.</p>
          <TextInput label="Passos" inputMode="numeric" placeholder={ranges.steps.example} hint="passos" value={steps} onChange={(e) => setSteps(e.target.value)} />
          <p className="muted" style={{ fontSize: '.8rem' }}>⚠️ A caminhada leve ajuda a prevenir trombose e melhora o trânsito intestinal pós-cirúrgico.</p>
        </div>
      )}

      <Button size="lg" block onClick={submit} loading={busy}>Enviar dados</Button>
      <Button variant="ghost" block onClick={onBack}>Voltar</Button>
    </div>
  );
}

function SuccessScreen() {
  return (
    <div className="center-screen">
      <div className="card auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem' }}>✅</div>
        <h2>Dados enviados com sucesso!</h2>
        <p className="subtext">
          Suas medições foram registradas e estão sendo acompanhadas com atenção pela nossa equipe.
        </p>
        <p className="muted" style={{ fontSize: '.85rem' }}>
          Fique tranquilo(a): se identificarmos qualquer sinal de alerta, um profissional entrará em contato.
        </p>
        <Button block size="lg" onClick={() => window.close()}>SAIR</Button>
      </div>
    </div>
  );
}

const fmt = formatCivilDate;
