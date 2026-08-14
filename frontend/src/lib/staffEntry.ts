/**
 * Detecta, no painel individual do paciente, se o período de HOJE (manhã/
 * noite) já fechou sem registro — só para UX (banner "Registrar agora"). A
 * barreira de segurança real é a RPC staff_insert_vital_record (0062); esta
 * função nunca decide se o lançamento é permitido, só se o aviso aparece.
 */
import { classifyPeriodEntry, Period } from '@vitalsync/shared';
import type { VitalRecord } from './dto';

export function getMissedPeriodsToday(
  records: VitalRecord[],
  todayMonitoringDay: number | null,
  now: Date = new Date(),
): { morning: boolean; night: boolean } {
  if (todayMonitoringDay == null) return { morning: false, night: false };

  const todays = records.filter((r) => r.monitoringDay === todayMonitoringDay);
  const hasMorning = todays.some((r) => r.period === Period.MORNING);
  const hasNight = todays.some((r) => r.period === Period.NIGHT);

  return {
    morning: classifyPeriodEntry({ period: Period.MORNING, hasRecord: hasMorning, now }) === 'MISSED',
    night: classifyPeriodEntry({ period: Period.NIGHT, hasRecord: hasNight, now }) === 'MISSED',
  };
}
