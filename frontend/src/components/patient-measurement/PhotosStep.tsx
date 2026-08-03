/**
 * Etapa 3 — Fotos de acompanhamento.
 *  Noite: pergunta do dreno + foto da cicatriz OBRIGATÓRIA + (se dreno) foto do
 *  dreno e débito (ml).
 *  Manhã: só pergunta se o paciente notou algo diferente na cicatriz ao
 *  acordar; a foto é sempre OPCIONAL e só aparece se a resposta for "Sim".
 *  Cada upload permite tirar foto, escolher da galeria, ver prévia, trocar e
 *  remover (componentes de `photo.tsx`).
 */
import { DrainQuestionField, PhotoUploadField } from '../photo';
import { NumericInput, YesNoSelector } from './fields';
import type { StepProps } from './VitalSignsStep';

export function PhotosStep({
  form,
  errors,
  setField,
  isNight,
  onError,
}: StepProps & { isNight: boolean; onError: (msg: string) => void }) {
  if (!isNight) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">As fotos ajudam a equipe médica a acompanhar sua recuperação.</p>

        <div>
          <YesNoSelector
            label="Ao acordar, notou algo diferente na cicatriz? (ex.: vermelhidão, secreção, abertura ou sangramento)"
            value={form.noticedWoundChange}
            onChange={(v) => setField('noticedWoundChange', v)}
            error={errors.noticedWoundChange}
          />
        </div>

        {form.noticedWoundChange === true && (
          <div>
            <PhotoUploadField
              value={form.woundPhoto}
              onChange={(file) => setField('woundPhoto', file)}
              onError={onError}
              title="Foto da cicatriz (opcional)"
              description="Se puder, envie uma foto da alteração — é opcional."
            />
          </div>
        )}
      </div>
    );
  }

  const hasDrain = form.hasDrain;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">As fotos ajudam a equipe médica a acompanhar sua recuperação.</p>

      <div>
        <DrainQuestionField value={hasDrain} onChange={(v) => setField('hasDrain', v)} />
        {errors.hasDrain && <span className="block text-xs font-semibold text-alert mt-1.5">{errors.hasDrain}</span>}
      </div>

      {hasDrain !== null && (
        <div className="space-y-3">
          <div>
            <PhotoUploadField
              value={form.woundPhoto}
              onChange={(file) => setField('woundPhoto', file)}
              onError={onError}
              title="Foto da cicatriz operatória"
              description="Envie uma foto nítida da cicatriz operatória para acompanhamento da equipe médica."
            />
            {errors.woundPhoto && (
              <span className="block text-xs font-semibold text-alert mt-1.5">{errors.woundPhoto}</span>
            )}
          </div>

          {hasDrain && (
            <div className="space-y-3">
              <div>
                <PhotoUploadField
                  value={form.drainPhoto}
                  onChange={(file) => setField('drainPhoto', file)}
                  onError={onError}
                  title="Foto do dreno"
                  description="Envie uma foto nítida do dreno para acompanhamento da equipe médica."
                />
                {errors.drainPhoto && (
                  <span className="block text-xs font-semibold text-alert mt-1.5">{errors.drainPhoto}</span>
                )}
              </div>
              <NumericInput
                label="Débito do dreno (ml)"
                placeholder="Ex. 50"
                inputMode="numeric"
                value={form.drainOutputMl}
                error={errors.drainOutputMl}
                onChange={(v) => setField('drainOutputMl', v)}
              />
            </div>
          )}

          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            💡 Tire a foto em um local bem iluminado e tente deixar a imagem nítida.
          </div>
        </div>
      )}
    </div>
  );
}
