/**
 * Formulário de lançamento PELA EQUIPE (Enfermagem/Cirurgião/Associado) do
 * período de hoje que o paciente esqueceu — reusa por import (não duplica) o
 * estado/validação/etapas do wizard do paciente (types.ts/validation.ts,
 * VitalSignsStep/SymptomsStep), mas sem CPF, sem etapa de fotos (staff
 * autenticado não tem o caminho de upload por token — ver
 * docs/PONTOS_PENDENTES.md) e em página única, já que é um preenchimento
 * pontual e não um wizard de várias telas.
 */
import { useState } from 'react';
import { Period } from '@vitalsync/shared';
import { Button } from '../ui';
import { useToast } from '../Toast';
import { vitalSignsService, type StaffVitalSubmission } from '../../services/vitalSignsService';
import { SymptomsStep } from './SymptomsStep';
import { VitalSignsStep } from './VitalSignsStep';
import { INPUT_RANGES, validateSymptoms, validateVitals } from './validation';
import { EMPTY_FORM, toNumber, type MeasurementErrors, type MeasurementFormState } from './types';

export function StaffVitalsEntryForm({
  patientId,
  period,
  onSuccess,
}: {
  patientId: string;
  period: 'MORNING' | 'NIGHT';
  onSuccess: (status: string) => void;
}) {
  const toast = useToast();
  const isNight = period === Period.NIGHT;
  const [form, setForm] = useState<MeasurementFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<MeasurementErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof MeasurementFormState>(key: K, value: MeasurementFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const vitalErrors = validateVitals(form, INPUT_RANGES);
    const symptomErrors = validateSymptoms(form, isNight);
    const allErrors = { ...vitalErrors, ...symptomErrors };
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      toast.error('Confira os campos destacados antes de enviar.');
      return;
    }

    const input: StaffVitalSubmission = {
      patient_id: patientId,
      period,
      temperature: toNumber(form.temperature),
      oxygen_saturation: toNumber(form.spo2),
      systolic_pressure: toNumber(form.systolic),
      diastolic_pressure: toNumber(form.diastolic),
      heart_rate: toNumber(form.heartRate),
      pain_level: form.pain ?? undefined,
      dyspnea_level: form.dyspnea ?? undefined,
      water_intake_ok: form.waterIntakeOk ?? undefined,
      had_vomit: form.hadVomit ?? undefined,
      vomiting_count: form.vomitCount.trim() ? toNumber(form.vomitCount) : undefined,
      has_bleeding: form.hadBleeding ?? false,
      ...(isNight
        ? {
            urinated_normally: form.urinatedNormally ?? undefined,
            urination_count: form.urinationCount.trim() ? toNumber(form.urinationCount) : undefined,
            steps: form.steps.trim() ? toNumber(form.steps) : undefined,
          }
        : {}),
    };

    setSubmitting(true);
    try {
      const { clinical_status } = await vitalSignsService.submitByStaff(input);
      toast.success('Medição registrada em nome do paciente.');
      onSuccess(clinical_status);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar a medição.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Sinais vitais</h3>
        <VitalSignsStep form={form} errors={errors} setField={setField} ranges={INPUT_RANGES} />
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Sintomas</h3>
        <SymptomsStep form={form} errors={errors} setField={setField} isNight={isNight} ranges={INPUT_RANGES} />
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} loading={submitting}>
          Registrar medição
        </Button>
      </div>
    </div>
  );
}
