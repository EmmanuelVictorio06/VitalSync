/**
 * Janelas de medição diária (Manhã 08:00-10:00 / Noite 18:00-20:00,
 * America/Sao_Paulo) e classificação "esquecido vs. dentro da janela" —
 * usadas tanto pelo gate real (staff_insert_vital_record, no banco) quanto
 * pela UX do frontend (banner de esquecimento, formulário de lançamento pela
 * equipe). O gate de segurança de verdade vive no banco; aqui é só para UI.
 */
import { Period } from '../types.js';
import { CLINIC_TIMEZONE } from '../utils.js';

export interface MeasurementWindow {
  openHour: number;
  closeHour: number;
}

export const MEASUREMENT_WINDOWS: Record<Period, MeasurementWindow> = {
  MORNING: { openHour: 8, closeHour: 10 },
  NIGHT: { openHour: 18, closeHour: 20 },
};

/** Hora/minuto "civis" (sem hora local do navegador) no fuso da clínica. */
export function clinicWallClock(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { hour: get('hour'), minute: get('minute') };
}

/** true quando o horário atual já passou do fechamento da janela do período (fecha em ponto, minuto 0). */
export function isWindowClosed(period: Period, now: Date = new Date()): boolean {
  const { hour } = clinicWallClock(now);
  return hour >= MEASUREMENT_WINDOWS[period].closeHour;
}

/** true quando o horário atual ainda não chegou na abertura da janela do período. */
export function isWindowNotYetOpen(period: Period, now: Date = new Date()): boolean {
  const { hour } = clinicWallClock(now);
  return hour < MEASUREMENT_WINDOWS[period].openHour;
}

export type PeriodEntryState = 'NOT_YET_OPEN' | 'OPEN' | 'MISSED' | 'SUBMITTED';

/**
 * Classifica o estado de um período de HOJE: se já tem registro, SUBMITTED;
 * senão, NOT_YET_OPEN (antes das 8h/18h), OPEN (dentro da janela) ou MISSED
 * (janela fechada e nada registrado — dispara o banner de esquecimento).
 */
export function classifyPeriodEntry(input: {
  period: Period;
  hasRecord: boolean;
  now?: Date;
}): PeriodEntryState {
  const { period, hasRecord, now = new Date() } = input;
  if (hasRecord) return 'SUBMITTED';
  if (isWindowNotYetOpen(period, now)) return 'NOT_YET_OPEN';
  if (isWindowClosed(period, now)) return 'MISSED';
  return 'OPEN';
}
