/**
 * Etapa 3 — Fotos de acompanhamento. Pergunta do dreno + upload da cicatriz e,
 * quando há dreno, upload do dreno. Cada upload permite tirar foto, escolher da
 * galeria, ver prévia, trocar e remover (componentes de `photo.tsx`).
 */
import { DrainQuestionField, PhotoUploadField } from '../photo';
import type { StepProps } from './VitalSignsStep';

export function PhotosStep({
  form,
  errors,
  setField,
  onError,
}: StepProps & { onError: (msg: string) => void }) {
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
          )}

          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            💡 Tire a foto em um local bem iluminado e tente deixar a imagem nítida.
          </div>
        </div>
      )}
    </div>
  );
}
