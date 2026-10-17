import { describe, expect, it } from 'vitest';
import { adherenceWindow } from './adherenceWindow';

describe('adherenceWindow — regra antiga (padrão)', () => {
  it('para dsd de 0 a 15 é IDÊNTICO às duas linhas antigas do adherenceService', () => {
    for (let dsd = 0; dsd <= 15; dsd++) {
      // As duas linhas que existiam no service, escritas aqui como referência:
      const effectiveDays = Math.min(dsd + 1, 10);
      const monitoringWindowClosed = dsd >= 10;
      expect(adherenceWindow(dsd), `dsd ${dsd}`).toEqual({ effectiveDays, closed: monitoringWindowClosed });
      expect(adherenceWindow(dsd, false), `dsd ${dsd}`).toEqual({ effectiveDays, closed: monitoringWindowClosed });
    }
  });
});

describe('adherenceWindow — regra nova (startsNextDay = true)', () => {
  it('dsd 0 (dia da alta) → 0 dias, aberta', () => {
    expect(adherenceWindow(0, true)).toEqual({ effectiveDays: 0, closed: false });
  });

  it('dsd 1 → 1 dia', () => {
    expect(adherenceWindow(1, true)).toEqual({ effectiveDays: 1, closed: false });
  });

  it('dsd 10 → 10 dias, ainda aberta (último dia)', () => {
    expect(adherenceWindow(10, true)).toEqual({ effectiveDays: 10, closed: false });
  });

  it('dsd 11 → fechada, teto de 10 dias', () => {
    expect(adherenceWindow(11, true)).toEqual({ effectiveDays: 10, closed: true });
  });
});
