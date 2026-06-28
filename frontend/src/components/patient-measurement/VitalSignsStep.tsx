/**
 * Etapa 1 — Sinais vitais. Campos numéricos (teclado numérico no celular) com
 * ajuda de uso e mensagens de erro próximas. Apenas apresentação: validação e
 * avanço ficam no Wizard.
 */
import { Gauge, HeartPulse, Thermometer, Wind } from 'lucide-react';
import { NumericInput } from './fields';
import type { InputRanges } from './validation';
import type { MeasurementErrors, MeasurementFormState } from './types';

export interface StepProps {
  form: MeasurementFormState;
  errors: MeasurementErrors;
  setField: <K extends keyof MeasurementFormState>(key: K, value: MeasurementFormState[K]) => void;
}

export function VitalSignsStep({
  form,
  errors,
  setField,
  ranges,
}: StepProps & { ranges: InputRanges }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Informe os valores medidos agora.</p>

      <NumericInput
        icon={Thermometer}
        label={`Temperatura (${ranges.temperature.unit})`}
        placeholder={ranges.temperature.example}
        hint="Use o termômetro digital"
        inputMode="decimal"
        value={form.temperature}
        error={errors.temperature}
        onChange={(v) => setField('temperature', v)}
      />
      <NumericInput
        icon={Wind}
        label={`Saturação de oxigênio (${ranges.spo2.unit})`}
        placeholder={ranges.spo2.example}
        hint="Use o oxímetro de dedo"
        inputMode="numeric"
        value={form.spo2}
        error={errors.spo2}
        onChange={(v) => setField('spo2', v)}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumericInput
          icon={Gauge}
          label="Pressão sistólica"
          placeholder={ranges.systolic.example}
          hint="mmHg"
          inputMode="numeric"
          value={form.systolic}
          error={errors.systolic}
          onChange={(v) => setField('systolic', v)}
        />
        <NumericInput
          icon={Gauge}
          label="Pressão diastólica"
          placeholder={ranges.diastolic.example}
          hint="mmHg"
          inputMode="numeric"
          value={form.diastolic}
          error={errors.diastolic}
          onChange={(v) => setField('diastolic', v)}
        />
      </div>
      <NumericInput
        icon={HeartPulse}
        label="Frequência cardíaca (bpm)"
        placeholder={ranges.heartRate.example}
        hint="Use o aparelho de pressão"
        inputMode="numeric"
        value={form.heartRate}
        error={errors.heartRate}
        onChange={(v) => setField('heartRate', v)}
      />
    </div>
  );
}
