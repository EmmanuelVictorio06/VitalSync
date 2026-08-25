/**
 * PatientMeasurementWizard — orquestra a medição do paciente em 4 etapas
 * (sinais vitais → sintomas → fotos → revisão), no mesmo padrão visual do
 * cadastro de profissional.
 *
 * Responsabilidades:
 *  - manter o estado único do formulário;
 *  - validar cada etapa antes de avançar (prevenção de erro), com mensagens
 *    humanas próximas ao campo;
 *  - permitir voltar para corrigir;
 *  - na revisão, fazer upload das fotos e enviar a medição (mesma lógica/serviços
 *    de antes — nada do envio muda);
 *  - renderizar cabeçalho, resumo, indicador de progresso e botões.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { Period } from '@vitalsync/shared';
import { useToast } from '../Toast';
import { ThemeToggle } from '../ThemeToggle';
import { storageService } from '../../services/storageService';
import { vitalSignsService } from '../../services/vitalSignsService';
import { PatientMeasurementHeader } from './PatientMeasurementHeader';
import { PatientSummaryCard } from './PatientSummaryCard';
import { PatientMeasurementStepIndicator } from './PatientMeasurementStepIndicator';
import { SupportFooter } from './SupportFooter';
import { VitalSignsStep } from './VitalSignsStep';
import { SymptomsStep } from './SymptomsStep';
import { PhotosStep } from './PhotosStep';
import { ReviewStep } from './ReviewStep';
import { WizardNavigationButtons } from './WizardNavigationButtons';
import { INPUT_RANGES, validatePhotos, validateSymptoms, validateVitals } from './validation';
import {
  EMPTY_FORM,
  GRADIENT_BG,
  STEP_COUNT,
  toNumber,
  type MeasurementErrors,
  type MeasurementFormState,
  type MeasurementPatient,
  type MeasurementStep,
} from './types';

export interface PatientMeasurementWizardProps {
  token: string;
  /** CPF confirmado no gate — reenviado no submit para revalidar a identidade. */
  cpf: string;
  patient: MeasurementPatient;
  period: Period;
  onSuccess: (photoAttached: boolean) => void;
}

export function PatientMeasurementWizard({ token, cpf, patient, period, onSuccess }: PatientMeasurementWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState<MeasurementStep>(1);
  const [form, setForm] = useState<MeasurementFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<MeasurementErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const isNight = period === Period.NIGHT;

  function setField<K extends keyof MeasurementFormState>(key: K, value: MeasurementFormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
  }

  function validateCurrent(): MeasurementErrors {
    if (step === 1) return validateVitals(form, INPUT_RANGES);
    if (step === 2) return validateSymptoms(form, isNight);
    if (step === 3) return validatePhotos(form, isNight);
    return {};
  }

  function goNext() {
    const e = validateCurrent();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setStep((s) => (s < STEP_COUNT ? ((s + 1) as MeasurementStep) : s));
  }

  function goBack() {
    setErrors({});
    setStep((s) => (s > 1 ? ((s - 1) as MeasurementStep) : s));
  }

  async function submit() {
    setSubmitting(true);
    try {
      // Fotos sobem via Edge Function (revalida token + CPF; resolve a pasta
      // do paciente no servidor) e guardam só o caminho.
      // A foto do dreno só é enviada quando o paciente informou possuir dreno
      // (só à noite). Na manhã, a foto da cicatriz é sempre opcional.
      const effectiveDrainPhoto = isNight && form.hasDrain ? form.drainPhoto : null;
      let woundPhotoPath: string | undefined;
      if (form.woundPhoto)
        woundPhotoPath = await storageService.uploadPatientPhotoViaToken(form.woundPhoto, token, cpf, 'wound');
      let drainPhotoPath: string | undefined;
      if (effectiveDrainPhoto)
        drainPhotoPath = await storageService.uploadPatientPhotoViaToken(effectiveDrainPhoto, token, cpf, 'drain');

      await vitalSignsService.submitByToken({
        secure_token: token,
        cpf,
        period,
        temperature: toNumber(form.temperature),
        oxygen_saturation: toNumber(form.spo2),
        systolic_pressure: toNumber(form.systolic),
        diastolic_pressure: toNumber(form.diastolic),
        heart_rate: toNumber(form.heartRate),
        pain_level: form.pain ?? undefined,
        dyspnea_level: form.dyspnea ?? undefined,
        water_intake_ok: form.waterIntakeOk ?? undefined,
        // Diurese só é perguntada à noite; o booleano resolve a ambiguidade (M-01).
        urinated_normally: isNight ? form.urinatedNormally ?? undefined : undefined,
        urination_count:
          isNight && form.urinatedNormally && form.urinationCount ? Number(form.urinationCount) : undefined,
        had_vomit: form.hadVomit ?? undefined,
        vomiting_count: form.hadVomit && form.vomitCount ? Number(form.vomitCount) : undefined,
        has_bleeding: form.hadBleeding ?? false,
        steps: isNight && form.steps ? Number(form.steps) : undefined,
        wound_photo_path: woundPhotoPath,
        // Dreno/débito só existem na medição noturna.
        has_drain: isNight ? form.hasDrain ?? false : false,
        drain_photo_path: drainPhotoPath,
        drain_output_ml: isNight && form.hasDrain && form.drainOutputMl ? Number(form.drainOutputMl) : undefined,
        // Manhã: sinaliza que o paciente notou algo diferente na cicatriz ao acordar.
        noticed_wound_change: !isNight ? form.noticedWoundChange ?? undefined : undefined,
      });
      onSuccess(Boolean(woundPhotoPath || drainPhotoPath));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar sua medição. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (step < STEP_COUNT) goNext();
    else void submit();
  }

  const isReview = step === STEP_COUNT;
  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6" style={GRADIENT_BG}>
      <div className="w-full max-w-[480px]">
        <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-6 sm:p-8 w-full">
          <div className="flex justify-end -mt-1 -mr-1 mb-1 sm:-mt-2 sm:-mr-2 sm:mb-2">
            <ThemeToggle />
          </div>
          <PatientMeasurementHeader name={patient.name} monitoringDay={patient.monitoringDay} period={period} />

          <div className="mt-5">
            <PatientSummaryCard patient={patient} />
          </div>

          <div className="mt-6">
            <PatientMeasurementStepIndicator current={step} />
          </div>

          <form className="mt-6" onSubmit={handleSubmit} noValidate>
            <div key={step} className="animate-entry">
              {step === 1 && <VitalSignsStep form={form} errors={errors} setField={setField} ranges={INPUT_RANGES} />}
              {step === 2 && (
                <SymptomsStep form={form} errors={errors} setField={setField} isNight={isNight} ranges={INPUT_RANGES} />
              )}
              {step === 3 && (
                <PhotosStep
                  form={form}
                  errors={errors}
                  setField={setField}
                  isNight={isNight}
                  onError={(msg) => toast.error(msg)}
                />
              )}
              {step === 4 && <ReviewStep form={form} period={period} />}
            </div>

            {/* Navegação — sem "Voltar" na primeira etapa; principal em destaque */}
            <WizardNavigationButtons
              onBack={step > 1 ? goBack : undefined}
              nextLabel={isReview ? 'Enviar medição' : 'Continuar'}
              loadingLabel={isReview ? 'Enviando…' : 'Continuando…'}
              isLoading={submitting}
              nextIcon={isReview ? <Send className="size-4" /> : undefined}
            />
          </form>
        </div>
        <SupportFooter />
      </div>
    </div>
  );
}
