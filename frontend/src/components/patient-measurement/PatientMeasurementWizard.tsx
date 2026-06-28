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
import { storageService } from '../../services/storageService';
import { vitalSignsService } from '../../services/vitalSignsService';
import { PatientMeasurementHeader } from './PatientMeasurementHeader';
import { PatientSummaryCard } from './PatientSummaryCard';
import { PatientMeasurementStepIndicator } from './PatientMeasurementStepIndicator';
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
  patient: MeasurementPatient;
  period: Period;
  onSuccess: (photoAttached: boolean) => void;
}

export function PatientMeasurementWizard({ token, patient, period, onSuccess }: PatientMeasurementWizardProps) {
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
    if (step === 2) return validateSymptoms(form);
    if (step === 3) return validatePhotos(form);
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
      // Fotos sobem ao Storage (bucket privado) e guardam só o caminho.
      // A foto do dreno só é enviada quando o paciente informou possuir dreno.
      const effectiveDrainPhoto = form.hasDrain ? form.drainPhoto : null;
      let woundPhotoPath: string | undefined;
      if (form.woundPhoto)
        woundPhotoPath = await storageService.uploadPatientPhoto(form.woundPhoto, patient.id, 'wound');
      let drainPhotoPath: string | undefined;
      if (effectiveDrainPhoto)
        drainPhotoPath = await storageService.uploadPatientPhoto(effectiveDrainPhoto, patient.id, 'drain');

      await vitalSignsService.submitByToken({
        secure_token: token,
        period,
        temperature: toNumber(form.temperature),
        oxygen_saturation: toNumber(form.spo2),
        systolic_pressure: toNumber(form.systolic),
        diastolic_pressure: toNumber(form.diastolic),
        heart_rate: toNumber(form.heartRate),
        pain_level: form.pain ?? undefined,
        dyspnea_level: form.dyspnea ?? undefined,
        urination_count: form.urinatedNormally && form.urinationCount ? Number(form.urinationCount) : undefined,
        vomiting_count: form.hadVomit && form.vomitCount ? Number(form.vomitCount) : undefined,
        has_bleeding: form.hadBleeding ?? false,
        steps: isNight && form.steps ? Number(form.steps) : undefined,
        wound_photo_path: woundPhotoPath,
        has_drain: form.hasDrain ?? false,
        drain_photo_path: drainPhotoPath,
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
      <div className="bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 p-6 sm:p-8 w-full max-w-[480px]">
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
              <PhotosStep form={form} errors={errors} setField={setField} onError={(msg) => toast.error(msg)} />
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
    </div>
  );
}
