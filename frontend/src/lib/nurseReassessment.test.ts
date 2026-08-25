import { describe, expect, it } from 'vitest';
import { dueLabel, minutesUntil } from '../services/nurseReassessmentService';

const AGORA = new Date('2026-08-25T12:00:00.000Z');
const em = (min: number) => new Date(AGORA.getTime() + min * 60000).toISOString();

describe('minutesUntil', () => {
  it('conta minutos que faltam', () => {
    expect(minutesUntil(em(120), AGORA)).toBe(120);
    expect(minutesUntil(em(15), AGORA)).toBe(15);
  });

  it('fica negativo quando o prazo passou', () => {
    expect(minutesUntil(em(-40), AGORA)).toBe(-40);
  });

  it('zero no instante do prazo', () => {
    expect(minutesUntil(em(0), AGORA)).toBe(0);
  });
});

describe('dueLabel', () => {
  it('minutos quando falta menos de uma hora', () => {
    expect(dueLabel(em(15), AGORA)).toBe('em 15 min');
  });

  it('horas e minutos quando falta mais de uma hora', () => {
    expect(dueLabel(em(120), AGORA)).toBe('em 2h00');
    expect(dueLabel(em(80), AGORA)).toBe('em 1h20');
  });

  it('marca atraso em minutos', () => {
    expect(dueLabel(em(-40), AGORA)).toBe('atrasada há 40 min');
  });

  it('marca atraso em horas', () => {
    expect(dueLabel(em(-125), AGORA)).toBe('atrasada há 2h05');
  });

  it('no instante do prazo diz "agora"', () => {
    expect(dueLabel(em(0), AGORA)).toBe('agora');
  });
});
