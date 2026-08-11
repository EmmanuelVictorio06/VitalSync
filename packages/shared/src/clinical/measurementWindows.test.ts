import { describe, it, expect } from 'vitest';
import { isWindowClosed, isWindowNotYetOpen, classifyPeriodEntry } from './measurementWindows.js';
import { Period } from '../types.js';

/** America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019). */
function spTime(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 0, 15, hour + 3, minute));
}

describe('isWindowClosed — MORNING (fecha 10:00)', () => {
  it('09:59 ainda não fechou', () => {
    expect(isWindowClosed(Period.MORNING, spTime(9, 59))).toBe(false);
  });
  it('10:00 exatamente já fechou', () => {
    expect(isWindowClosed(Period.MORNING, spTime(10, 0))).toBe(true);
  });
  it('10:01 já fechou', () => {
    expect(isWindowClosed(Period.MORNING, spTime(10, 1))).toBe(true);
  });
});

describe('isWindowClosed — NIGHT (fecha 20:00)', () => {
  it('19:59 ainda não fechou', () => {
    expect(isWindowClosed(Period.NIGHT, spTime(19, 59))).toBe(false);
  });
  it('20:00 exatamente já fechou', () => {
    expect(isWindowClosed(Period.NIGHT, spTime(20, 0))).toBe(true);
  });
});

describe('isWindowNotYetOpen', () => {
  it('07:59 MORNING ainda não abriu', () => {
    expect(isWindowNotYetOpen(Period.MORNING, spTime(7, 59))).toBe(true);
  });
  it('08:00 MORNING já abriu', () => {
    expect(isWindowNotYetOpen(Period.MORNING, spTime(8, 0))).toBe(false);
  });
  it('17:59 NIGHT ainda não abriu', () => {
    expect(isWindowNotYetOpen(Period.NIGHT, spTime(17, 59))).toBe(true);
  });
});

describe('classifyPeriodEntry', () => {
  it('com registro é SUBMITTED independente do horário', () => {
    expect(
      classifyPeriodEntry({ period: Period.MORNING, hasRecord: true, now: spTime(10, 30) }),
    ).toBe('SUBMITTED');
  });
  it('sem registro, antes da janela abrir, é NOT_YET_OPEN', () => {
    expect(
      classifyPeriodEntry({ period: Period.MORNING, hasRecord: false, now: spTime(7, 0) }),
    ).toBe('NOT_YET_OPEN');
  });
  it('sem registro, dentro da janela, é OPEN', () => {
    expect(
      classifyPeriodEntry({ period: Period.MORNING, hasRecord: false, now: spTime(9, 0) }),
    ).toBe('OPEN');
  });
  it('sem registro, depois da janela fechar, é MISSED', () => {
    expect(
      classifyPeriodEntry({ period: Period.MORNING, hasRecord: false, now: spTime(10, 0) }),
    ).toBe('MISSED');
  });
  it('NIGHT: sem registro às 20:15 é MISSED', () => {
    expect(
      classifyPeriodEntry({ period: Period.NIGHT, hasRecord: false, now: spTime(20, 15) }),
    ).toBe('MISSED');
  });
});
