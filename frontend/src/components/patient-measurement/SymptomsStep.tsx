/**
 * Etapa 2 — Sintomas: dor, dispneia (escalas) e perguntas Sim/Não (diurese,
 * vômito, sangramento). À noite, inclui também o número de passos do dia.
 */
import { AlertCircle, Droplets, Footprints, Wind } from 'lucide-react';
import { NumericInput, SegmentSelector, SymptomScaleSelector, YesNoSelector } from './fields';
import type { StepProps } from './VitalSignsStep';
import type { InputRanges } from './validation';

const DYSPNEA_OPTIONS = [
  { value: 0, label: 'Sem dispneia' },
  { value: 1, label: 'Dispneia leve' },
  { value: 2, label: 'Moderada ou intensa' },
];

export function SymptomsStep({
  form,
  errors,
  setField,
  isNight,
  ranges,
}: StepProps & { isNight: boolean; ranges: InputRanges }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Como você está se sentindo?</p>

      <SymptomScaleSelector
        icon={AlertCircle}
        label="Nível de dor"
        description="Como está sua dor agora?"
        value={form.pain}
        onChange={(v) => setField('pain', v)}
        minLabel="0 — Sem dor"
        maxLabel="10 — Dor extrema"
        error={errors.pain}
      />

      <SegmentSelector
        icon={Wind}
        label="Falta de ar / dispneia"
        description="Como está sua respiração agora?"
        value={form.dyspnea}
        options={DYSPNEA_OPTIONS}
        onChange={(v) => setField('dyspnea', v)}
        error={errors.dyspnea}
      />

      <YesNoSelector
        label="Está conseguindo tomar líquidos normalmente?"
        value={form.waterIntakeOk}
        onChange={(v) => setField('waterIntakeOk', v)}
        error={errors.waterIntakeOk}
      />

      {isNight && (
        <>
          <YesNoSelector
            label="Diurese — urinou normalmente?"
            value={form.urinatedNormally}
            onChange={(v) => setField('urinatedNormally', v)}
            error={errors.urinatedNormally}
          />
          {form.urinatedNormally === true && (
            <NumericInput
              icon={Droplets}
              label="Quantas vezes?"
              placeholder="Ex. 5"
              inputMode="numeric"
              value={form.urinationCount}
              onChange={(v) => setField('urinationCount', v)}
            />
          )}
        </>
      )}

      <YesNoSelector
        label="Teve episódios de vômito?"
        value={form.hadVomit}
        onChange={(v) => setField('hadVomit', v)}
        error={errors.hadVomit}
      />
      {form.hadVomit === true && (
        <NumericInput
          label="Quantas vezes?"
          placeholder="Ex. 2"
          inputMode="numeric"
          value={form.vomitCount}
          onChange={(v) => setField('vomitCount', v)}
        />
      )}

      <YesNoSelector
        label="Observou sangue no vômito, fezes ou urina?"
        value={form.hadBleeding}
        onChange={(v) => setField('hadBleeding', v)}
        error={errors.hadBleeding}
      />

      {isNight && (
        <div className="pt-4 border-t border-border space-y-2">
          <NumericInput
            icon={Footprints}
            label="Número de passos hoje"
            placeholder={ranges.steps.example}
            hint="Verifique seu smartwatch (opcional)"
            inputMode="numeric"
            value={form.steps}
            onChange={(v) => setField('steps', v)}
          />
          <p className="text-xs text-muted-foreground">
            A caminhada leve ajuda a prevenir trombose e melhora o trânsito intestinal pós-cirúrgico.
          </p>
        </div>
      )}
    </div>
  );
}
