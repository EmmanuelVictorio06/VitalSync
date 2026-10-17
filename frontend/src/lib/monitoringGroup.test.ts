import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWithinMonitoringWindow } from '@vitalsync/shared';
import { monitoringEndDate, patientGroup } from './monitoringGroup';
import { monitoringNotStartedYet } from './monitoringGroup';

/** Data civil canônica (meia-noite UTC), mesma convenção do @vitalsync/shared. */
function civil(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** 'YYYY-MM-DD' de `base` deslocado `offset` dias (negativo = passado). */
function isoOffset(base: Date, offset: number): string {
  return new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fixa o "hoje" da clínica: meio-dia em São Paulo (15:00 UTC), longe da virada
 * do dia nos dois fusos — `patientGroup` lê `startOfToday()` sem parâmetro.
 */
function fixarHoje(iso: string): Date {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T15:00:00.000Z`));
  return civil(iso);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('patientGroup', () => {
  it('alta nula → andamento', () => {
    fixarHoje('2026-02-10');
    expect(patientGroup(null)).toBe('andamento');
    expect(patientGroup(undefined)).toBe('andamento');
    expect(patientGroup('')).toBe('andamento');
  });

  it('alta futura → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, 2))).toBe('andamento');
  });

  it('alta hoje → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, 0))).toBe('andamento');
  });

  it('alta − 9 (10º dia, o último) → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, -9))).toBe('andamento');
  });

  it('alta − 10 (primeiro dia concluído) → concluidos', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, -10))).toBe('concluidos');
  });

  it('alta − 30 → concluidos', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, -30))).toBe('concluidos');
  });

  it('virada de mês: a borda cai certo atravessando fevereiro', () => {
    fixarHoje('2026-03-05');
    expect(patientGroup('2026-02-24')).toBe('andamento'); // 10º dia
    expect(patientGroup('2026-02-23')).toBe('concluidos');
  });

  it('virada de ano: a borda cai certo atravessando dezembro', () => {
    fixarHoje('2026-01-03');
    expect(patientGroup('2025-12-25')).toBe('andamento'); // 10º dia
    expect(patientGroup('2025-12-24')).toBe('concluidos');
  });

  it("varredura −2..+12 dias: 'andamento' ⇔ janela do shared OU alta futura OU alta nula", () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(null)).toBe('andamento');
    for (let diasAtras = -2; diasAtras <= 12; diasAtras++) {
      const iso = isoOffset(hoje, -diasAtras);
      const alta = civil(iso);
      const esperadoAndamento = isWithinMonitoringWindow(alta, hoje) || alta.getTime() > hoje.getTime();
      expect(patientGroup(iso) === 'andamento', `alta ${iso} (${diasAtras} dias atrás)`).toBe(esperadoAndamento);
    }
  });
});

describe('monitoringEndDate', () => {
  it('devolve alta + 9 (o 10º dia)', () => {
    expect(monitoringEndDate(civil('2026-02-10'))).toEqual(civil('2026-02-19'));
  });

  it('atravessa a virada de ano', () => {
    expect(monitoringEndDate(civil('2025-12-28'))).toEqual(civil('2026-01-06'));
  });
});

describe('patientGroup — regra nova (startsNextDay = true: dia 1 = alta + 1)', () => {
  it('alta hoje → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, 0), true)).toBe('andamento');
  });

  it('alta futura → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, 2), true)).toBe('andamento');
  });

  it('alta − 10 (10º dia, o último) → andamento', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, -10), true)).toBe('andamento');
  });

  it('alta − 11 (primeiro dia concluído) → concluidos', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(patientGroup(isoOffset(hoje, -11), true)).toBe('concluidos');
  });

  it('alta nula → andamento', () => {
    fixarHoje('2026-02-10');
    expect(patientGroup(null, true)).toBe('andamento');
  });
});

describe('monitoringEndDate — regra nova', () => {
  it('devolve alta + 10 (o 10º dia)', () => {
    expect(monitoringEndDate(civil('2026-02-10'), true)).toEqual(civil('2026-02-20'));
  });

  it('padrão (sem o parâmetro) continua alta + 9', () => {
    expect(monitoringEndDate(civil('2026-02-10'))).toEqual(monitoringEndDate(civil('2026-02-10'), false));
  });
});

describe('monitoringNotStartedYet', () => {
  it('alta hoje → true', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(monitoringNotStartedYet(isoOffset(hoje, 0))).toBe(true);
  });

  it('alta futura → true', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(monitoringNotStartedYet(isoOffset(hoje, 2))).toBe(true);
  });

  it('alta ontem → false', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(monitoringNotStartedYet(isoOffset(hoje, -1))).toBe(false);
  });

  it('alta há 11 dias → false', () => {
    const hoje = fixarHoje('2026-02-10');
    expect(monitoringNotStartedYet(isoOffset(hoje, -11))).toBe(false);
  });

  it('alta nula → false', () => {
    fixarHoje('2026-02-10');
    expect(monitoringNotStartedYet(null)).toBe(false);
    expect(monitoringNotStartedYet(undefined)).toBe(false);
  });

  it('alta hoje, às 22h de São Paulo (01:00 UTC do dia seguinte) → true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-11T01:00:00.000Z')); // 10/02 22:00 em São Paulo
    expect(monitoringNotStartedYet('2026-02-10')).toBe(true);
  });
});
