/**
 * Resumo compacto do paciente — grade 2×2 (idade, cirurgia, monitoramento, alta).
 * Colapsa para 1 coluna em telas muito estreitas.
 */
import { formatCivilDate } from '@vitalsync/shared';
import type { MeasurementPatient } from './types';

export function PatientSummaryCard({ patient }: { patient: MeasurementPatient }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <SummaryItem label="Idade" value={patient.age != null ? `${patient.age} anos` : '—'} />
        <SummaryItem label="Monitoramento" value={patient.monitoringDay ? `${patient.monitoringDay}º dia` : '—'} />
        <SummaryItem label="Cirurgia" value={patient.surgeryDate ? formatCivilDate(patient.surgeryDate) : '—'} />
        <SummaryItem label="Alta" value={patient.dischargeDate ? formatCivilDate(patient.dischargeDate) : '—'} />
      </dl>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold truncate">{value}</dd>
    </div>
  );
}
