/**
 * Formulário de lançamento PELA EQUIPE (Enfermagem/Cirurgião/Associado) do
 * período de hoje que o paciente esqueceu — reusa por import (não duplica) o
 * estado/validação/etapas do wizard do paciente (types.ts/validation.ts,
 * VitalSignsStep/SymptomsStep) e os campos de foto de `photo.tsx`, mas sem CPF
 * e em página única, já que é um preenchimento pontual e não um wizard.
 *
 * FOTOS (FUNC 3 / migration 0074): o staff sobe o arquivo direto no Storage
 * pelo cliente autenticado — a policy `patient_photos_write` (0020) autoriza
 * quem é membro da equipe do paciente. O upload acontece AO SELECIONAR, para o
 * erro aparecer na hora; o que vai para a RPC é só o caminho retornado.
 *
 * Diferenças deliberadas em relação à etapa de fotos do PACIENTE
 * (`PhotosStep` + `validatePhotos`):
 *   • Aqui a foto é SEMPRE opcional — inclusive à noite, onde o paciente é
 *     obrigado a enviar a da cicatriz. O lançamento pela equipe existe para
 *     fechar uma lacuna de registro; exigir foto de quem está preenchendo em
 *     nome do paciente transformaria a ausência de foto em ausência de medição.
 *   • A pergunta do dreno aparece nos DOIS períodos (no wizard do paciente é só
 *     à noite): dreno é um fato do paciente, não do período, e quem lança pode
 *     estar preenchendo a manhã. A consistência do dado é garantida no banco —
 *     a RPC só grava `drain_photo_path` quando `has_drain` é true.
 */
import { useState } from 'react';
import { Period } from '@vitalsync/shared';
import { Button } from '../ui';
import { useToast } from '../Toast';
import { DrainQuestionField, PhotoUploadField } from '../photo';
import { storageService, type PatientPhotoKind } from '../../services/storageService';
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
  /** Caminhos já subidos no Storage (o que a RPC recebe). */
  const [woundPath, setWoundPath] = useState<string | null>(null);
  const [drainPath, setDrainPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<PatientPhotoKind | null>(null);

  function setField<K extends keyof MeasurementFormState>(key: K, value: MeasurementFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Sobe a foto escolhida e guarda o caminho. Remover a foto apenas descarta a
   * referência: o bucket não tem policy de DELETE para `authenticated` (só
   * avatares têm — 0006), então o objeto trocado fica órfão no Storage. É
   * inofensivo — sem caminho no registro, ele não entra em `measurement_photos`
   * nem aparece em nenhuma tela.
   */
  async function handlePhoto(kind: PatientPhotoKind, file: File | null) {
    const field = kind === 'wound' ? 'woundPhoto' : 'drainPhoto';
    const setPath = kind === 'wound' ? setWoundPath : setDrainPath;

    if (!file) {
      setField(field, null);
      setPath(null);
      return;
    }

    setUploading(kind);
    try {
      const path = await storageService.uploadPatientPhotoAsStaff(file, patientId, kind);
      setField(field, file);
      setPath(path);
    } catch (err) {
      // Mantém o campo vazio: sem caminho, não há o que enviar à RPC.
      setField(field, null);
      setPath(null);
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a foto.');
    } finally {
      setUploading(null);
    }
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

    // Anexou foto mas o upload não concluiu: não deixa passar em silêncio —
    // o usuário acha que a foto foi junto. Sem foto anexada, segue normalmente.
    if ((form.woundPhoto && !woundPath) || (form.drainPhoto && !drainPath)) {
      toast.error('Aguarde o envio da foto terminar (ou remova-a) antes de registrar.');
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
      wound_photo_path: woundPath ?? undefined,
      // `has_drain` só vai como true se foi respondido "Sim"; a RPC descarta o
      // caminho do dreno quando é false.
      has_drain: form.hasDrain ?? false,
      drain_photo_path: form.hasDrain ? drainPath ?? undefined : undefined,
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

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Fotos de acompanhamento
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Opcional. Se você fotografou a cicatriz ou o dreno durante o contato com o paciente, anexe aqui — a foto
            fica no acompanhamento junto com esta medição.
          </p>
        </div>

        <PhotoUploadField
          value={form.woundPhoto}
          onChange={(file) => void handlePhoto('wound', file)}
          onError={(msg) => toast.error(msg)}
          title="Foto da cicatriz operatória (opcional)"
          description="Envie uma foto nítida da cicatriz operatória."
        />

        <div>
          <DrainQuestionField
            value={form.hasDrain}
            onChange={(v) => setField('hasDrain', v)}
            label="O paciente possui dreno?"
          />
        </div>

        {form.hasDrain && (
          <PhotoUploadField
            value={form.drainPhoto}
            onChange={(file) => void handlePhoto('drain', file)}
            onError={(msg) => toast.error(msg)}
            title="Foto do dreno (opcional)"
            description="Envie uma foto nítida do dreno."
          />
        )}

        {uploading && <p className="text-xs text-muted-foreground">Enviando a foto…</p>}
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} loading={submitting} disabled={uploading !== null}>
          Registrar medição
        </Button>
      </div>
    </div>
  );
}
