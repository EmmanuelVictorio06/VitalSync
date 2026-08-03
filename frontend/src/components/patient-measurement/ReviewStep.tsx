/**
 * Etapa 4 — Revisão: resumo simples e legível de tudo o que foi preenchido,
 * antes do envio. Sem campos editáveis; o paciente volta para corrigir.
 */
import { Period } from '@vitalsync/shared';
import { toNumber, type MeasurementFormState } from './types';

const DYSPNEA_LABEL: Record<number, string> = {
  0: 'Sem dispneia',
  1: 'Leve',
  2: 'Moderada/intensa',
};

export function ReviewStep({
  form,
  period,
}: {
  form: MeasurementFormState;
  period: Period;
}) {
  const isNight = period === Period.NIGHT;
  const photoCount = (form.woundPhoto ? 1 : 0) + (isNight && form.hasDrain && form.drainPhoto ? 1 : 0);
  const fmtNum = (v: string) => (v.trim() ? String(toNumber(v)).replace('.', ',') : '—');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Confira suas informações antes de enviar.</p>

      <dl className="rounded-2xl border border-border bg-muted/30 divide-y divide-border">
        <Row label="Temperatura" value={form.temperature.trim() ? `${fmtNum(form.temperature)} °C` : '—'} />
        <Row label="Saturação" value={form.spo2.trim() ? `${fmtNum(form.spo2)}%` : '—'} />
        <Row
          label="Pressão"
          value={form.systolic.trim() && form.diastolic.trim() ? `${form.systolic}/${form.diastolic} mmHg` : '—'}
        />
        <Row label="Frequência cardíaca" value={form.heartRate.trim() ? `${form.heartRate} bpm` : '—'} />
        <Row label="Dor" value={form.pain != null ? `${form.pain}/10` : '—'} />
        <Row label="Dispneia" value={form.dyspnea != null ? (DYSPNEA_LABEL[form.dyspnea] ?? '—') : '—'} />
        <Row label="Ingestão de líquidos" value={yesNo(form.waterIntakeOk)} />
        {isNight && <Row label="Diurese" value={yesNo(form.urinatedNormally)} />}
        <Row label="Vômito" value={yesNo(form.hadVomit)} />
        <Row label="Sangramento" value={yesNo(form.hadBleeding)} />
        {isNight && form.steps.trim() && <Row label="Passos hoje" value={form.steps} />}
        {isNight ? (
          <>
            <Row label="Possui dreno" value={yesNo(form.hasDrain)} />
            {form.hasDrain && form.drainOutputMl.trim() && (
              <Row label="Débito do dreno" value={`${form.drainOutputMl} ml`} />
            )}
            <Row label="Fotos" value={photoCount === 0 ? 'Nenhuma' : `${photoCount} enviada${photoCount > 1 ? 's' : ''}`} />
          </>
        ) : (
          <>
            <Row label="Notou algo na cicatriz" value={yesNo(form.noticedWoundChange)} />
            <Row label="Foto da cicatriz" value={form.woundPhoto ? 'Enviada' : 'Nenhuma'} />
          </>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold text-foreground text-right">{value}</dd>
    </div>
  );
}

function yesNo(v: boolean | null): string {
  if (v === null) return '—';
  return v ? 'Sim' : 'Não';
}
