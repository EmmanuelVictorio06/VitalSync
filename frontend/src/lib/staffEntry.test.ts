import { describe, expect, it } from 'vitest';
import { Period } from '@vitalsync/shared';
import { getMissedPeriodsToday } from './staffEntry';
import type { VitalRecord } from './dto';

/** America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019). */
function spTime(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 0, 15, hour + 3, minute));
}

function record(overrides: Partial<VitalRecord>): VitalRecord {
  return {
    id: 'r1',
    recordDate: '2026-01-15',
    period: Period.MORNING,
    monitoringDay: 3,
    temperature: 36.5,
    spo2: 98,
    systolic: 120,
    diastolic: 80,
    heartRate: 80,
    pain: 0,
    dyspnea: 0,
    urinatedNormally: true,
    urinationCount: 4,
    hadVomit: false,
    vomitCount: null,
    hadBleeding: false,
    stepsCount: 2000,
    overallStatus: 'GREEN',
    statusByVital: {},
    patientId: 'p1',
    woundPhotoUrl: null,
    woundPhotoFileName: null,
    woundPhotoMimeType: null,
    woundPhotoSize: null,
    woundPhotoUploadedAt: null,
    hasDrain: false,
    drainPhotoUrl: null,
    drainPhotoFileName: null,
    drainPhotoUploadedAt: null,
    source: 'PATIENT',
    enteredByName: null,
    ...overrides,
  };
}

describe('getMissedPeriodsToday', () => {
  it('sem monitoringDay (fora da janela), nunca marca esquecimento', () => {
    expect(getMissedPeriodsToday([], null, spTime(11, 0))).toEqual({ morning: false, night: false });
  });

  it('sem nenhum registro do dia, depois das duas janelas fecharem, marca ambos', () => {
    expect(getMissedPeriodsToday([], 3, spTime(21, 0))).toEqual({ morning: true, night: true });
  });

  it('com registro da manhã, só a noite pode ficar esquecida', () => {
    const records = [record({ monitoringDay: 3, period: Period.MORNING })];
    expect(getMissedPeriodsToday(records, 3, spTime(21, 0))).toEqual({ morning: false, night: true });
  });

  it('antes do fechamento da janela da manhã, não marca nada', () => {
    expect(getMissedPeriodsToday([], 3, spTime(9, 0))).toEqual({ morning: false, night: false });
  });

  it('registro de outro dia de monitoramento não conta para hoje', () => {
    const records = [record({ monitoringDay: 2, period: Period.MORNING })];
    expect(getMissedPeriodsToday(records, 3, spTime(21, 0))).toEqual({ morning: true, night: true });
  });

  it('com ambos os registros de hoje, nada fica esquecido', () => {
    const records = [
      record({ monitoringDay: 3, period: Period.MORNING }),
      record({ monitoringDay: 3, period: Period.NIGHT }),
    ];
    expect(getMissedPeriodsToday(records, 3, spTime(21, 0))).toEqual({ morning: false, night: false });
  });
});
