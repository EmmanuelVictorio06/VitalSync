import { describe, it, expect } from 'vitest';
import { monitoringDay, daysSinceDischarge, startOfToday, CLINIC_TIMEZONE, isDischargeAfterSurgery } from './utils.js';

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

describe('isDischargeAfterSurgery', () => {
  it('alta depois da cirurgia é válido', () => {
    expect(isDischargeAfterSurgery('2026-08-14', '2026-08-20')).toBe(true);
  });

  it('alta no MESMO DIA da cirurgia é válido (procedimento ambulatorial)', () => {
    expect(isDischargeAfterSurgery('2026-08-14', '2026-08-14')).toBe(true);
  });

  it('alta antes da cirurgia é inválido', () => {
    expect(isDischargeAfterSurgery('2026-08-20', '2026-08-14')).toBe(false);
  });

  it('virada de mês: alta 1 dia depois, cruzando de agosto pra setembro', () => {
    expect(isDischargeAfterSurgery('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('virada de mês invertida: cirurgia em setembro, alta ainda em agosto, é inválido', () => {
    expect(isDischargeAfterSurgery('2026-09-01', '2026-08-31')).toBe(false);
  });

  it('virada de ano: alta 1 dia depois, cruzando pro ano seguinte', () => {
    expect(isDischargeAfterSurgery('2026-12-31', '2027-01-01')).toBe(true);
  });

  it('virada de ano invertida é inválido', () => {
    expect(isDischargeAfterSurgery('2027-01-01', '2026-12-31')).toBe(false);
  });

  it('ano bissexto: cirurgia em 29/02/2024, alta no mesmo dia é válido', () => {
    expect(isDischargeAfterSurgery('2024-02-29', '2024-02-29')).toBe(true);
  });

  it('ano bissexto: alta 1º de março depois de cirurgia em 29/02/2024 é válido', () => {
    expect(isDischargeAfterSurgery('2024-02-29', '2024-03-01')).toBe(true);
  });

  it('sem cirurgia informada, não invalida (obrigatoriedade é checada à parte)', () => {
    expect(isDischargeAfterSurgery(undefined, '2026-08-14')).toBe(true);
    expect(isDischargeAfterSurgery(null, '2026-08-14')).toBe(true);
    expect(isDischargeAfterSurgery('', '2026-08-14')).toBe(true);
  });

  it('sem alta informada, não invalida', () => {
    expect(isDischargeAfterSurgery('2026-08-14', undefined)).toBe(true);
    expect(isDischargeAfterSurgery('2026-08-14', null)).toBe(true);
    expect(isDischargeAfterSurgery('2026-08-14', '')).toBe(true);
  });

  it('nenhuma das duas informada, não invalida', () => {
    expect(isDischargeAfterSurgery(undefined, undefined)).toBe(true);
  });

  it('comparação lexicográfica não sofre deslocamento de fuso (não usa new Date)', () => {
    // Se a implementação usasse `new Date(iso)`, '2026-08-14' viraria meia-noite
    // UTC, que em America/Sao_Paulo (UTC-3) é 13/08 às 21h — um dia antes. Como
    // a comparação é puramente por string, o resultado independe do fuso da
    // máquina que roda o teste.
    expect(isDischargeAfterSurgery('2026-08-14', '2026-08-14')).toBe(true);
    expect(isDischargeAfterSurgery('2026-08-14', '2026-08-13')).toBe(false);
  });
});
