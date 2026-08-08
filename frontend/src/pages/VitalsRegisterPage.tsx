import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Moon, ShieldCheck, Sun } from 'lucide-react';
import { Period, calculateAge } from '@vitalsync/shared';
import { formatCpf } from '../lib/cpfUtils';
import { publicAccessService, type PatientAccessValidation } from '../services/publicAccessService';
import { type PatientLinkInfo } from '../services/vitalSignsService';
import {
  ContatoAtivoAviso,
  GRADIENT_BG,
  MeasurementSuccess,
  PatientMeasurementWizard,
  periodLabel,
  SupportFooter,
  type MeasurementPatient,
} from '../components/patient-measurement';

type Step = 'choose' | 'form' | 'success';

export function VitalsRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<PatientLinkInfo | null>(null);
  // CPF confirmado no gate — reenviado no submit (gate real de identidade, C-04).
  const [cpf, setCpf] = useState('');
  const [step, setStep] = useState<Step>('choose');
  const [period, setPeriod] = useState<Period>(Period.MORNING);
  const [photoSent, setPhotoSent] = useState(false);
  // Regra "uma medição por período por dia": períodos de hoje já registrados
  // (fuso America/Sao_Paulo) e o toggle de admin que libera reenvio.
  const [filledPeriods, setFilledPeriods] = useState<Period[]>([]);
  const [allowResend, setAllowResend] = useState(false);

  // Token ausente na URL: link malformado.
  if (!token) {
    return (
      <CenteredCard>
        <div className="size-16 rounded-full bg-alert/10 text-alert flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight">Link indisponível</h2>
        <p className="text-sm text-muted-foreground mt-2">Não foi possível abrir este link.</p>
        <p className="text-xs text-muted-foreground mt-3">Solicite um novo link à sua equipe médica.</p>
      </CenteredCard>
    );
  }

  // Gate de identidade: só libera os dados após confirmar o CPF (server-side).
  if (!link) {
    return (
      <CpfGate
        token={token}
        onValidated={(validation, confirmedCpf) => {
          setCpf(confirmedCpf);
          setFilledPeriods(validation.periodsFilledToday);
          setAllowResend(validation.allowResendSamePeriod);
          setLink(validation.patient);
        }}
      />
    );
  }

  const patient: MeasurementPatient = {
    id: link.id,
    name: link.name,
    age: link.birth_date ? calculateAge(new Date(link.birth_date)) : null,
    surgeryDate: link.surgery_date,
    dischargeDate: link.hospital_discharge_date,
    monitoringDay: link.monitoring_day,
  };

  if (step === 'success') {
    return <MeasurementSuccess photoSent={photoSent} />;
  }

  // Monitoramento encerrado (fora da janela de 10 dias).
  if (!link.within_window) {
    return (
      <CenteredCard>
        <h2 className="text-xl font-extrabold tracking-tight">Monitoramento encerrado</h2>
        <p className="text-sm text-muted-foreground mt-2 text-balance">
          O período de 10 dias de acompanhamento não está ativo nesta data. Em caso de sintomas, contate sua equipe.
        </p>
      </CenteredCard>
    );
  }

  // Regra "uma medição por período por dia" (só quando o admin não liberou o
  // reenvio): períodos de hoje já feitos ficam bloqueados na escolha.
  const morningDone = !allowResend && filledPeriods.includes(Period.MORNING);
  const nightDone = !allowResend && filledPeriods.includes(Period.NIGHT);

  // Ambas as medições de hoje já feitas: tela de conclusão, sem formulário.
  if (morningDone && nightDone) {
    return (
      <CenteredCard>
        <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="size-8" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight">Tudo certo por hoje!</h2>
        <p className="text-sm text-muted-foreground mt-2 text-balance">
          As medições da manhã e da noite já foram registradas. Volte amanhã ao acordar para a próxima medição.
        </p>
      </CenteredCard>
    );
  }

  if (step === 'form') {
    return (
      <PatientMeasurementWizard
        token={token}
        cpf={cpf}
        patient={patient}
        period={period}
        onSuccess={(photoAttached) => {
          setPhotoSent(photoAttached);
          // Marca o período como feito para a UI refletir a regra sem revalidar.
          setFilledPeriods((prev) => (prev.includes(period) ? prev : [...prev, period]));
          setStep('success');
        }}
      />
    );
  }

  // Escolha do período (entrada do fluxo).
  return (
    <PeriodChoice
      name={patient.name}
      morningDone={morningDone}
      nightDone={nightDone}
      onChoose={(p) => { setPeriod(p); setStep('form'); }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Card centralizado reutilizável (gradiente + 480px)                 */
/* ------------------------------------------------------------------ */
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6" style={GRADIENT_BG}>
      <div className="w-full max-w-[480px]">
        <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-8 text-center animate-entry">
          {children}
        </div>
        <SupportFooter />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Escolha do período                                                 */
/* ------------------------------------------------------------------ */
function PeriodChoice({
  name,
  morningDone,
  nightDone,
  onChoose,
}: {
  name: string;
  /** Medição da manhã de hoje já registrada (e reenvio não liberado pelo admin). */
  morningDone: boolean;
  /** Medição da noite de hoje já registrada (e reenvio não liberado pelo admin). */
  nightDone: boolean;
  onChoose: (p: Period) => void;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  return (
    <CenteredCard>
      <p className="text-sm text-muted-foreground">Olá, {firstName}</p>
      <h1 className="text-xl font-extrabold tracking-tight mt-0.5">Quando você está registrando?</h1>
      <p className="text-sm text-muted-foreground mt-2">Escolha o período para iniciar sua medição.</p>

      <div className="mt-6 space-y-3 text-left">
        <button
          onClick={() => onChoose(Period.MORNING)}
          disabled={morningDone}
          className="w-full flex items-center gap-3 py-4 px-5 bg-primary text-primary-foreground rounded-xl font-bold text-base hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:shadow-none"
        >
          <Sun className="size-5" />
          {morningDone ? `${periodLabel(Period.MORNING)} — Já realizada hoje` : `${periodLabel(Period.MORNING)} (ao acordar)`}
        </button>
        <button
          onClick={() => onChoose(Period.NIGHT)}
          disabled={nightDone}
          className="w-full flex items-center gap-3 py-4 px-5 border-2 border-primary/30 text-primary bg-card rounded-xl font-bold text-base hover:bg-accent transition-colors disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:bg-card"
        >
          <Moon className="size-5" />
          {nightDone ? `${periodLabel(Period.NIGHT)} — Já realizada hoje` : `${periodLabel(Period.NIGHT)} (antes de dormir)`}
        </button>
      </div>

      {morningDone && !nightDone && (
        <p className="text-sm text-muted-foreground mt-4 text-balance">
          Você já registrou a medição da manhã. Agora é só a medição da noite, antes de dormir.
        </p>
      )}
      {nightDone && !morningDone && (
        <p className="text-sm text-muted-foreground mt-4 text-balance">
          Você já registrou a medição da noite. A próxima é amanhã de manhã, ao acordar.
        </p>
      )}
    </CenteredCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Gate de identidade (CPF)                                           */
/* ------------------------------------------------------------------ */
/**
 * Pede o CPF e valida no servidor antes de revelar qualquer dado do paciente.
 * Erro sempre genérico (não revela existência).
 */
function CpfGate({
  token,
  onValidated,
}: {
  token: string;
  onValidated: (validation: PatientAccessValidation, cpf: string) => void;
}) {
  const [cpf, setCpf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const info = await publicAccessService.validate(token, cpf);
      onValidated(info, cpf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CPF não confere com este link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard>
      <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
        <ShieldCheck className="size-8" />
      </div>
      <h2 className="text-xl font-extrabold tracking-tight">Confirme sua identidade</h2>
      <p className="text-sm text-muted-foreground mt-2 text-balance">
        Para sua segurança, digite seu CPF para acessar o registro de medição.
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
        {error && <p className="text-sm text-alert font-semibold">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors disabled:opacity-55"
        >
          {busy ? 'Validando…' : 'Acessar meu registro'}
        </button>
      </form>

      {/* Primeiro acesso: o paciente precisa saber que pode receber contato
          ANTES de recebê-lo, senão a ligação parece golpe e ele bloqueia. */}
      <div className="mt-5">
        <ContatoAtivoAviso compacto />
      </div>

      <p className="text-xs text-muted-foreground mt-4">Em caso de dúvida, entre em contato com sua equipe médica.</p>
    </CenteredCard>
  );
}
