import { describe, it, expect } from 'vitest';
import { monitoringDay, daysSinceDischarge, startOfToday, CLINIC_TIMEZONE } from './utils.js';

/** Data civil (meia-noite UTC), no mesmo formato usado pelo código de produção. */
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('monitoringDay', () => {
  const discharge = day(2026, 3, 1); // alta em 2026-03-01

  it('dia da alta é o dia 1', () => {
    expect(monitoringDay(discharge, discharge)).toBe(1);
  });

  it('dia 5, no meio da janela', () => {
    expect(monitoringDay(discharge, day(2026, 3, 5))).toBe(5);
  });

  it('9 dias depois da alta é o dia 10 (último dia da janela)', () => {
    expect(monitoringDay(discharge, day(2026, 3, 10))).toBe(10);
  });

  it('10 dias depois da alta já está fora da janela (null)', () => {
    expect(monitoringDay(discharge, day(2026, 3, 11))).toBeNull();
  });

  it('antes da data de alta é null', () => {
    expect(monitoringDay(discharge, day(2026, 2, 28))).toBeNull();
  });
});

describe('daysSinceDischarge', () => {
  const discharge = day(2026, 3, 1);

  it('no dia da alta é 0', () => {
    expect(daysSinceDischarge(discharge, discharge)).toBe(0);
  });

  it('passa de 10 dias sem ser limitado (uso: exibição "nº de dias pós-alta")', () => {
    expect(daysSinceDischarge(discharge, day(2026, 3, 20))).toBe(19);
  });

  it('referência antes da alta fica limitada a 0 (não fica negativo)', () => {
    expect(daysSinceDischarge(discharge, day(2026, 2, 25))).toBe(0);
  });
});

describe('startOfToday — usa CLINIC_TIMEZONE (America/Sao_Paulo, UTC-3 fixo, sem horário de verão desde 2019)', () => {
  it('CLINIC_TIMEZONE é America/Sao_Paulo', () => {
    expect(CLINIC_TIMEZONE).toBe('America/Sao_Paulo');
  });

  // Estes 3 casos fixam o instante UTC exato em torno da virada de meia-noite em
  // SP (UTC-3) — o resultado não pode depender do fuso horário da máquina que
  // roda o teste, porque a função nunca lê o fuso local do processo (usa sempre
  // Intl.DateTimeFormat com timeZone explícito).
  it('03:00 UTC já é meia-noite em SP → novo dia civil', () => {
    const now = new Date('2026-03-15T03:00:00.000Z');
    expect(startOfToday(now)).toEqual(day(2026, 3, 15));
  });

  it('02:59:59 UTC ainda é 23:59:59 do dia anterior em SP → dia civil anterior', () => {
    const now = new Date('2026-03-15T02:59:59.000Z');
    expect(startOfToday(now)).toEqual(day(2026, 3, 14));
  });

  it('meio-dia UTC é sempre a manhã do mesmo dia civil em SP', () => {
    const now = new Date('2026-03-15T12:00:00.000Z');
    expect(startOfToday(now)).toEqual(day(2026, 3, 15));
  });
});
