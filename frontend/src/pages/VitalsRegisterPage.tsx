import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Droplets,
  Footprints,
  Gauge,
  Heart,
  HeartPulse,
  Moon,
  ShieldCheck,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { Period, calculateAge, formatCivilDate } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { PatientPhotoUploadSection } from '../components/photo';
import { Field, IntensityScale, YesNo, cn } from '../components/ui';
import { formatCpf } from '../lib/cpfUtils';
import { storageService } from '../services/storageService';
import { publicAccessService } from '../services/publicAccessService';
import { vitalSignsService, type PatientLinkInfo } from '../services/vitalSignsService';

type Step = 'choose' | 'form' | 'success';
type IconType = React.ComponentType<{ className?: string }>;

interface InputRange { min: number; max: number; example: string; unit: string; PENDING_MEDICAL_VALIDATION: boolean }
type InputRanges = Record<'temperature' | 'spo2' | 'systolic' | 'diastolic' | 'heartRate' | 'steps', InputRange>;

/** Faixas de entrada (UX). TODO: confirmar com a equipe médica. */
const INPUT_RANGES: InputRanges = {
  temperature: { min: 34, max: 42, example: '36,5', unit: '°C', PENDING_MEDICAL_VALIDATION: false },
  spo2: { min: 70, max: 100, example: '98', unit: '%', PENDING_MEDICAL_VALIDATION: false },
  systolic: { min: 70, max: 220, example: '120', unit: 'mmHg', PENDING_MEDICAL_VALIDATION: false },
  diastolic: { min: 40, max: 140, example: '80', unit: 'mmHg', PENDING_MEDICAL_VALIDATION: false },
  heartRate: { min: 30, max: 200, example: '72', unit: 'bpm', PENDING_MEDICAL_VALIDATION: false },
  steps: { min: 0, max: 100000, example: '2000', unit: 'passos', PENDING_MEDICAL_VALIDATION: false },
};

export function VitalsRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<PatientLinkInfo | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [period, setPeriod] = useState<Period>(Period.MORNING);
  const [photoSent, setPhotoSent] = useState(false);

  // Token ausente na URL: link malformado.
  if (!token) {
    return (
      <div className="min-h-screen bg-background grid place-items-center p-6">
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8 w-full max-w-sm text-center animate-entry">
          <div className="size-14 rounded-full bg-alert/10 text-alert flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="size-7" />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight">Link indisponível</h2>
          <p className="text-sm text-muted-foreground mt-2">Não foi possível abrir este link.</p>
          <p className="text-xs text-muted-foreground mt-3">Solicite um novo link à sua equipe médica.</p>
        </div>
      </div>
    );
  }

  // Gate de identidade: só libera os dados após confirmar o CPF (server-side).
  if (!link) {
    return <CpfGate token={token} onValidated={setLink} />;
  }

  const p = {
    id: link.id,
    name: link.name,
    age: link.birth_date ? calculateAge(new Date(link.birth_date)) : null,
    surgeryDate: link.surgery_date,
    dischargeDate: link.hospital_discharge_date,
    monitoringDay: link.monitoring_day,
    withinWindow: link.within_window,
  };

  if (step === 'success') {
    return <SuccessScreen photoSent={photoSent} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Cabeçalho do paciente */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-md mx-auto px-5 py-4 flex items-center gap-3">
          <div className="size-9 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
            <Heart className="size-5" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Olá,</p>
            <p className="font-bold truncate">{p.name}</p>
          </div>
          {step === 'form' && (
            <span className="ml-auto inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-1 rounded-full text-[10px] font-bold uppercase">
              {period === Period.MORNING ? 'Manhã' : 'Noite'}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-5 py-6 pb-10 space-y-5">
        <div className="text-center animate-entry">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            {p.monitoringDay ? `Dia ${p.monitoringDay} de monitoramento` : 'Registro de sinais vitais'}
          </p>
          <h1 className="text-xl font-extrabold tracking-tight mt-1">
            {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </h1>
        </div>

        {/* Resumo do paciente */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-5 animate-entry">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <SummaryItem label="Idade" value={p.age != null ? `${p.age} anos` : '—'} />
            <SummaryItem label="Monitoramento" value={p.monitoringDay ? `${p.monitoringDay}º dia` : '—'} />
            <SummaryItem label="Cirurgia" value={p.surgeryDate ? fmt(p.surgeryDate) : '—'} />
            <SummaryItem label="Alta" value={p.dischargeDate ? fmt(p.dischargeDate) : '—'} />
          </dl>
        </div>

        {!p.withinWindow ? (
          <div className="bg-card border border-warning/30 rounded-2xl shadow-sm p-6 text-center animate-entry">
            <h2 className="text-lg font-extrabold tracking-tight">Monitoramento encerrado</h2>
            <p className="text-sm text-muted-foreground mt-2">
              O período de 10 dias de acompanhamento não está ativo nesta data. Em caso de sintomas, contate sua
              equipe.
            </p>
          </div>
        ) : step === 'choose' ? (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-3 animate-entry">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Quando você está registrando?
            </h2>
            <button
              onClick={() => {
                setPeriod(Period.MORNING);
                setStep('form');
              }}
              className="w-full flex items-center gap-3 py-4 px-5 bg-primary text-primary-foreground rounded-xl font-bold text-base hover:bg-primary/90 shadow-lg shadow-primary/20"
            >
              <Sun className="size-5" /> Manhã (ao acordar)
            </button>
            <button
              onClick={() => {
                setPeriod(Period.NIGHT);
                setStep('form');
              }}
              className="w-full flex items-center gap-3 py-4 px-5 border-2 border-primary/30 text-primary bg-card rounded-xl font-bold text-base hover:bg-accent"
            >
              <Moon className="size-5" /> Noite (antes de dormir)
            </button>
          </div>
        ) : (
          <MeasurementForm
            token={token!}
            patientId={p.id}
            period={period}
            ranges={INPUT_RANGES}
            onBack={() => setStep('choose')}
            onSuccess={(photoAttached) => {
              setPhotoSent(photoAttached);
              setStep('success');
            }}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Gate de identidade: pede o CPF e valida no servidor antes de revelar
 * qualquer dado do paciente. Erro sempre genérico (não revela existência).
 */
function CpfGate({ token, onValidated }: { token: string; onValidated: (info: PatientLinkInfo) => void }) {
  const [cpf, setCpf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const info = await publicAccessService.validate(token, cpf);
      onValidated(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CPF não confere com este link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center p-6">
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 w-full max-w-sm animate-entry">
        <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="size-7" />
        </div>
        <h2 className="text-lg font-extrabold tracking-tight text-center">Confirme sua identidade</h2>
        <p className="text-sm text-muted-foreground mt-2 text-center">
          Para sua segurança, digite seu CPF para acessar o registro de sinais vitais.
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void confirm();
          }}
        >
          <input
            value={cpf}
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            onChange={(e) => setCpf(formatCpf(e.target.value))}
            className="w-full bg-muted/60 border border-border rounded-xl px-4 py-3.5 text-lg font-semibold text-center tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {error && <p className="text-sm text-alert font-semibold text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 disabled:opacity-55"
          >
            {busy ? 'Validando…' : 'Acessar meu registro'}
          </button>
        </form>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Em caso de dúvida, entre em contato com sua equipe médica.
        </p>
      </div>
    </div>
  );
}

function MeasurementForm({
  token, patientId, period, ranges, onBack, onSuccess,
}: {
  token: string;
  patientId: string;
  period: Period;
  ranges: InputRanges;
  onBack: () => void;
  onSuccess: (photoAttached: boolean) => void;
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
  const [hasDrain, setHasDrain] = useState<boolean | null>(null);
  const [woundPhoto, setWoundPhoto] = useState<File | null>(null);
  const [drainPhoto, setDrainPhoto] = useState<File | null>(null);

  const isNight = period === Period.NIGHT;
  // Só conta a foto do dreno quando o paciente informou possuir dreno.
  const effectiveDrainPhoto = hasDrain ? drainPhoto : null;
  const anyPhoto = Boolean(woundPhoto || effectiveDrainPhoto);

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
    if (hasDrain === null) return 'Responda se você possui dreno.';
    if (!woundPhoto) return 'Envie a foto da cicatriz operatória.';
    if (hasDrain && !drainPhoto) return 'Envie a foto do dreno.';
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
      // Fotos opcionais: sobem ao Storage (bucket privado) e guardam só o caminho.
      // A foto do dreno só é enviada quando o paciente informou possuir dreno.
      let woundPhotoPath: string | undefined;
      if (woundPhoto) woundPhotoPath = await storageService.uploadPatientPhoto(woundPhoto, patientId, 'wound');
      let drainPhotoPath: string | undefined;
      if (effectiveDrainPhoto)
        drainPhotoPath = await storageService.uploadPatientPhoto(effectiveDrainPhoto, patientId, 'drain');

      await vitalSignsService.submitByToken({
        secure_token: token,
        period,
        temperature: num(temperature),
        oxygen_saturation: num(spo2),
        systolic_pressure: num(systolic),
        diastolic_pressure: num(diastolic),
        heart_rate: num(heartRate),
        pain_level: pain ?? undefined,
        dyspnea_level: dyspnea ?? undefined,
        urination_count: urinatedNormally && urinationCount ? Number(urinationCount) : undefined,
        vomiting_count: hadVomit && vomitCount ? Number(vomitCount) : undefined,
        has_bleeding: hadBleeding ?? false,
        steps: isNight && steps ? Number(steps) : undefined,
        wound_photo_path: woundPhotoPath,
        has_drain: hasDrain ?? false,
        drain_photo_path: drainPhotoPath,
      });
      onSuccess(anyPhoto);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 animate-entry">
      <Section title="Sinais vitais" subtitle="Informe os valores medidos agora.">
        <VitalInput
          icon={Thermometer}
          label={`Temperatura (${ranges.temperature.unit})`}
          placeholder={ranges.temperature.example}
          hint={`Use o termômetro digital · entre ${ranges.temperature.min} e ${ranges.temperature.max}`}
          inputMode="decimal"
          value={temperature}
          onChange={setTemperature}
        />
        <VitalInput
          icon={Wind}
          label={`Saturação de oxigênio (${ranges.spo2.unit})`}
          placeholder={ranges.spo2.example}
          hint={`Use o oxímetro de dedo · entre ${ranges.spo2.min} e ${ranges.spo2.max}`}
          inputMode="numeric"
          value={spo2}
          onChange={setSpo2}
        />
        <div className="grid grid-cols-2 gap-3">
          <VitalInput icon={Gauge} label="Pressão sistólica" placeholder={ranges.systolic.example} hint="mmHg" inputMode="numeric" value={systolic} onChange={setSystolic} />
          <VitalInput icon={Gauge} label="Pressão diastólica" placeholder={ranges.diastolic.example} hint="mmHg" inputMode="numeric" value={diastolic} onChange={setDiastolic} />
        </div>
        <VitalInput icon={HeartPulse} label="Frequência cardíaca (bpm)" placeholder={ranges.heartRate.example} hint="Use o aparelho de pressão" inputMode="numeric" value={heartRate} onChange={setHeartRate} />
        {(ranges.systolic.PENDING_MEDICAL_VALIDATION || ranges.heartRate.PENDING_MEDICAL_VALIDATION) && (
          <p className="text-[10px] font-bold uppercase text-warning bg-warning/10 border border-warning/20 rounded-full px-3 py-1 inline-block">
            ⚠ faixas a confirmar
          </p>
        )}
      </Section>

      <Section title="Sintomas" subtitle="Como você está se sentindo?">
        <div>
          <ScaleLabel icon={AlertCircle} label="Nível de dor" value={pain} />
          <IntensityScale value={pain} onChange={setPain} leftLabel="0 – Sem dor" rightLabel="10 – Dor extrema" colorFor={(n) => (n <= 6 ? 'g' : n <= 8 ? 'y' : 'r')} />
        </div>
        <div>
          <ScaleLabel icon={Wind} label="Falta de ar / dispneia" value={dyspnea} />
          <IntensityScale value={dyspnea} onChange={setDyspnea} leftLabel="0 – Respiração normal" rightLabel="10 – Falta de ar extrema" colorFor={(n) => (n === 0 ? 'g' : n <= 5 ? 'y' : 'r')} />
        </div>
        <Field label="Diurese — urinou normalmente?">
          <YesNo value={urinatedNormally} onChange={setUrinatedNormally} />
        </Field>
        {urinatedNormally === true && (
          <VitalInput icon={Droplets} label="Quantas vezes?" placeholder="Ex. 5" inputMode="numeric" value={urinationCount} onChange={setUrinationCount} />
        )}
        <Field label="Teve episódios de vômito?">
          <YesNo value={hadVomit} onChange={setHadVomit} />
        </Field>
        {hadVomit === true && (
          <VitalInput label="Quantas vezes?" placeholder="Ex. 2" inputMode="numeric" value={vomitCount} onChange={setVomitCount} />
        )}
        <Field label="Observou sangue no vômito, fezes ou urina?">
          <YesNo value={hadBleeding} onChange={setHadBleeding} />
        </Field>
      </Section>

      {isNight && (
        <Section title="Atividade física" subtitle="Quantos passos você deu hoje?">
          <VitalInput icon={Footprints} label="Número de passos hoje" placeholder={ranges.steps.example} hint="Verifique seu smartwatch" inputMode="numeric" value={steps} onChange={setSteps} />
          <p className="text-xs text-muted-foreground">
            ⚠️ A caminhada leve ajuda a prevenir trombose e melhora o trânsito intestinal pós-cirúrgico.
          </p>
        </Section>
      )}

      {/* Fotos de acompanhamento (opcional) — pergunta do dreno + uploads */}
      <PatientPhotoUploadSection
        hasDrain={hasDrain}
        onHasDrainChange={setHasDrain}
        woundPhoto={woundPhoto}
        onWoundPhotoChange={setWoundPhoto}
        drainPhoto={drainPhoto}
        onDrainPhotoChange={setDrainPhoto}
        onError={(msg) => toast.error(msg)}
      />

      {/* Revisão rápida antes do envio */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-4 space-y-2.5 text-sm">
        <p className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Revisão</p>
        <ReviewLine
          ok={hasDrain !== null}
          label={hasDrain === null ? 'Possui dreno: não informado' : `Possui dreno: ${hasDrain ? 'Sim' : 'Não'}`}
        />
        <ReviewLine ok={Boolean(woundPhoto)} label={woundPhoto ? 'Foto da cicatriz operatória anexada' : 'Nenhuma foto da cicatriz anexada'} />
        {hasDrain && (
          <ReviewLine
            ok={Boolean(effectiveDrainPhoto)}
            label={effectiveDrainPhoto ? 'Foto do dreno anexada' : 'Nenhuma foto do dreno anexada'}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 bg-stable text-stable-foreground rounded-xl font-bold text-sm hover:opacity-95 shadow-lg shadow-stable/20 inline-flex items-center justify-center gap-2 disabled:opacity-55"
        >
          {busy ? 'Aguarde…' : 'Enviar dados'} {!busy && <CheckCircle2 className="size-5" />}
        </button>
        <button
          onClick={onBack}
          className="w-full py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-5">
      <header>
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function VitalInput({
  icon: Icon,
  label,
  placeholder,
  hint,
  value,
  onChange,
  inputMode,
}: {
  icon?: IconType;
  label: string;
  placeholder?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-bold text-foreground mb-1.5">
        {Icon && <Icon className="size-3.5 text-primary" />}
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-muted/60 border border-border rounded-xl px-4 py-3.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

function ScaleLabel({ icon: Icon, label, value }: { icon: IconType; label: string; value: number | null }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-bold mb-2">
      <Icon className="size-3.5 text-primary" />
      {label}
      <span className={cn('font-mono ml-auto', value === null ? 'text-muted-foreground' : 'text-foreground')}>
        {value ?? '—'}/10
      </span>
    </span>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function ReviewLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-4 text-stable shrink-0" />
      ) : (
        <span className="size-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />
      )}
      <span className={cn('font-semibold', ok ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

function SuccessScreen({ photoSent }: { photoSent?: boolean }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="size-20 rounded-full bg-stable/10 text-stable flex items-center justify-center mb-6 animate-entry">
        <CheckCircle2 className="size-10" />
      </div>
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight max-w-md animate-entry [animation-delay:100ms]">
        Dados enviados com sucesso!
      </h1>
      <p className="text-muted-foreground mt-3 max-w-sm text-balance animate-entry [animation-delay:200ms]">
        Suas informações foram registradas e serão acompanhadas pela equipe médica.
      </p>
      {photoSent && (
        <p className="text-sm font-semibold text-stable mt-3 max-w-sm animate-entry [animation-delay:230ms]">
          As fotos foram enviadas para análise da equipe médica.
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-2 max-w-sm animate-entry [animation-delay:250ms]">
        Fique tranquilo(a): se identificarmos qualquer sinal de alerta, um profissional entrará em contato.
      </p>
      <button
        onClick={() => window.close()}
        className="mt-10 w-full max-w-xs py-4 bg-primary text-primary-foreground rounded-xl font-bold text-base hover:bg-primary/90 shadow-lg shadow-primary/20"
      >
        SAIR
      </button>
    </div>
  );
}

const fmt = formatCivilDate;
