/**
 * Blocos compartilhados dos drawers de detalhe clínico — "Detalhes do Alerta"
 * (`components/alerts.tsx`) e "Detalhes do Atendimento"
 * (`components/attendances/AttendanceDetailsDrawer.tsx`). Fonte única de
 * `DSection`/`DGrid` e dos grids de paciente/medição, que antes eram
 * duplicados nos dois arquivos. Cada drawer decide sua própria ordem/ênfase
 * de seções — este módulo só evita repetir o JSX/lógica de apresentação.
 */
import type { ComponentType, ReactNode } from 'react';
import { calculateAge, Period } from '@vitalsync/shared';
import type { VitalSignRecord } from '../../services/types';
import { fmtDate, teamLabel } from '../attendances/utils';

/* ---------------- DSection ---------------- */
export function DSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold mb-3">
        <Icon className="size-4 text-primary" /> {title}
      </h3>
      {children}
    </section>
  );
}

/* ---------------- DGrid ---------------- */
export function DGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{k}</dt>
          <dd className="font-semibold mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- PatientInfoGrid ---------------- */
export interface PatientInfoInput {
  name: string;
  birth_date: string | null;
  phone: string | null;
  surgery_type: { name: string } | null;
  hospital: { name: string } | null;
  surgery_date: string | null;
  hospital_discharge_date: string | null;
}

/** Grid de dados do paciente — mesmo conjunto de campos nos dois drawers. */
export function PatientInfoGrid({
  patient,
  teamNumber,
  surgeonName,
  monitoringDay,
}: {
  patient: PatientInfoInput | null | undefined;
  teamNumber: number | null | undefined;
  surgeonName: string | null;
  monitoringDay: number | null | undefined;
}) {
  return (
    <DGrid
      items={[
        ['Nome', patient?.name ?? '—'],
        ['Idade', patient?.birth_date ? `${calculateAge(new Date(patient.birth_date))} anos` : '—'],
        ['Telefone', patient?.phone ?? '—'],
        ['Tipo de cirurgia', patient?.surgery_type?.name ?? '—'],
        ['Hospital', patient?.hospital?.name ?? '—'],
        ['Data da cirurgia', fmtDate(patient?.surgery_date)],
        ['Data da alta', fmtDate(patient?.hospital_discharge_date)],
        ['Dia de monitoramento', monitoringDay ? `D+${monitoringDay}` : '—'],
        ['Equipe', teamLabel(teamNumber)],
        ['Cirurgião responsável', surgeonName ?? '—'],
      ]}
    />
  );
}

/* ---------------- MeasurementGrid ---------------- */
/**
 * Grid da medição completa (sinais vitais + dreno + fotos). `onPhotoClick`
 * opcional: quando informado, as fotos abrem em zoom ao clicar (usado pelo
 * Detalhes do Atendimento); sem ele, as fotos só são exibidas.
 */

/** Mapeia dyspnea_level (0-2) p/ label legível, igual ao ReviewStep do
 *  paciente (só trocamos "Sem dispneia" por "Ausente" p/ maior clareza). */
const DYSPNEA_LABEL: Record<number, string> = {
  0: 'Ausente',
  1: 'Leve',
  2: 'Moderada/Intensa',
};

/** Vômitos: usa `had_vomit` como primário (boolean); quando ausente, fallback
 *  p/ `vomiting_count > 0`. Se true, mostra "Sim (N episódios)" ou só "Sim". */
function fmtVomiting(r: VitalSignRecord | null | undefined): string {
  if (!r) return '—';
  const hadVomit = r.had_vomit ?? (r.vomiting_count ?? 0) > 0;
  if (!hadVomit) return 'Não';
  return r.vomiting_count != null && r.vomiting_count > 0
    ? `Sim (${r.vomiting_count} episódios)`
    : 'Sim';
}

export function MeasurementGrid({
  record,
  photoUrl,
  drainPhotoUrl,
  onPhotoClick,
}: {
  record: VitalSignRecord | null | undefined;
  photoUrl: string | null;
  drainPhotoUrl: string | null;
  onPhotoClick?: (url: string) => void;
}) {
  const r = record;
  return (
    <>
      <DGrid
        items={[
          ['Data', fmtDate(r?.record_date)],
          ['Período', r?.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
          ['Temperatura', r?.temperature != null ? `${r.temperature} °C` : '—'],
          ['Saturação', r?.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—'],
          [
            'Pressão arterial',
            r?.systolic_pressure != null ? `${r.systolic_pressure}/${r.diastolic_pressure ?? '—'} mmHg` : '—',
          ],
          ['Frequência cardíaca', r?.heart_rate != null ? `${r.heart_rate} bpm` : '—'],
          ['Dor', r?.pain_level != null ? `${r.pain_level}/10` : '—'],
          ['Dispneia', r?.dyspnea_level != null ? (DYSPNEA_LABEL[r.dyspnea_level] ?? String(r.dyspnea_level)) : '—'],
          ['Diurese', r?.urination_count != null ? `${r.urination_count}×` : '—'],
          ['Vômitos', fmtVomiting(r)],
          ['Sangramento', r?.has_bleeding ? 'Sim' : 'Não'],
          ['Passos', r?.steps != null ? String(r.steps) : '—'],
        ]}
      />
      {r && (
        <p className="mt-3 text-xs">
          <span className="font-bold">Possui dreno:</span>{' '}
          <span className={r.has_drain ? 'text-primary font-semibold' : 'text-muted-foreground'}>
            {r.has_drain ? 'Sim' : 'Não'}
          </span>
        </p>
      )}
      {(photoUrl || drainPhotoUrl) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {photoUrl && <MeasurementPhoto label="Cicatriz operatória" alt="Foto da cicatriz operatória" url={photoUrl} onClick={onPhotoClick} />}
          {drainPhotoUrl && <MeasurementPhoto label="Dreno" alt="Foto do dreno" url={drainPhotoUrl} onClick={onPhotoClick} />}
        </div>
      )}
    </>
  );
}

function MeasurementPhoto({
  label,
  alt,
  url,
  onClick,
}: {
  label: string;
  alt: string;
  url: string;
  onClick?: (url: string) => void;
}) {
  const img = <img src={url} alt={alt} className="rounded-lg border border-border max-h-56 w-full object-cover" />;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      {onClick ? (
        <button type="button" onClick={() => onClick(url)} className="block w-full">
          {img}
        </button>
      ) : (
        img
      )}
    </div>
  );
}
