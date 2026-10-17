import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitoringDayFrom } from './teams-admin';

/** Fixa o relógio ao meio-dia de São Paulo (15:00 UTC), longe da virada do dia. */
function fixarAgora(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T15:00:00.000Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('monitoringDayFrom — regra nova (startsNextDay = true)', () => {
  it('no dia da alta → null (fora da janela nova)', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-02-10', true)).toBeNull();
  });

  it('alta ontem (hoje = alta + 1) → dia 1', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-02-09', true)).toBe(1);
  });

  it('alta futura → null', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-02-12', true)).toBeNull();
  });

  it('sem alta → null', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom(null, true)).toBeNull();
  });
});

describe('monitoringDayFrom — padrão (sem o parâmetro) é a regra antiga', () => {
  it('no dia da alta → dia 1; ontem → dia 2', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-02-10')).toBe(1);
    expect(monitoringDayFrom('2026-02-09')).toBe(2);
    expect(monitoringDayFrom('2026-02-10', false)).toBe(1);
  });
});

describe('monitoringDayFrom — regra nova usa o dia de São Paulo e para no 10', () => {
  it('alta hoje, às 22h de São Paulo (01:00 UTC do dia seguinte) → null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-11T01:00:00.000Z')); // 10/02 22:00 em São Paulo
    expect(monitoringDayFrom('2026-02-10', true)).toBeNull();
  });

  it('alta − 1, às 22h de São Paulo → dia 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-11T01:00:00.000Z')); // 10/02 22:00 em São Paulo
    expect(monitoringDayFrom('2026-02-09', true)).toBe(1);
  });

  it('alta − 10 → dia 10 (último dia da janela nova)', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-01-31', true)).toBe(10);
  });

  it('alta − 11 → null (janela encerrada)', () => {
    fixarAgora('2026-02-10');
    expect(monitoringDayFrom('2026-01-30', true)).toBeNull();
  });
});
