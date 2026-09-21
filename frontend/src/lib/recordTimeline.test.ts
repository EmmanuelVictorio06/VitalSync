/**
 * Ordem e rótulo dos registros no carrossel de indicadores
 * (lib/recordTimeline.ts).
 *
 * O que estes testes protegem:
 *   - "mais recente" é decidido por dia + período, não pela ordem que o banco
 *     devolveu: a query ordena por `record_date` (DATE), e manhã/noite do
 *     mesmo dia EMPATAM — era como `records[length - 1]` podia devolver a
 *     manhã mesmo já existindo a noite;
 *   - manhã e noite continuam sendo registros separados (um slide cada);
 *   - o rótulo do cabeçalho é o mesmo texto que a seção já usava.
 */
import { describe, expect, it } from 'vitest';
import { Period } from '@vitalsync/shared';
import type { VitalRecord } from './dto';
import { latestRecord, periodLabel, recordKey, recordSlideLabel, recordsNewestFirst } from './recordTimeline';

/** O carrossel só lê dia e período; o resto do DTO não importa aqui. */
const rec = (monitoringDay: number, period: Period): VitalRecord =>
  ({ id: `${monitoringDay}-${period}`, monitoringDay, period }) as unknown as VitalRecord;

const chaves = (records: VitalRecord[]) => recordsNewestFirst(records).map(recordKey);

describe('recordsNewestFirst', () => {
  it('ordena do dia mais alto para o mais baixo', () => {
    const entrada = [rec(1, Period.MORNING), rec(3, Period.MORNING), rec(2, Period.MORNING)];
    expect(chaves(entrada)).toEqual(['3-MORNING', '2-MORNING', '1-MORNING']);
  });

  it('no mesmo dia, a NOITE vem antes da manhã (é mais recente)', () => {
    expect(chaves([rec(4, Period.MORNING), rec(4, Period.NIGHT)])).toEqual(['4-NIGHT', '4-MORNING']);
  });

  it('desempata igual mesmo quando o banco devolve a noite primeiro', () => {
    // A query ordena por record_date (DATE): a ordem dentro do dia é arbitrária.
    expect(chaves([rec(4, Period.NIGHT), rec(4, Period.MORNING)])).toEqual(['4-NIGHT', '4-MORNING']);
  });

  it('intercala dias e períodos na ordem cronológica inversa', () => {
    const entrada = [
      rec(1, Period.MORNING), rec(1, Period.NIGHT),
      rec(2, Period.MORNING), rec(2, Period.NIGHT),
      rec(3, Period.MORNING),
    ];
    expect(chaves(entrada)).toEqual(['3-MORNING', '2-NIGHT', '2-MORNING', '1-NIGHT', '1-MORNING']);
  });

  it('não muta o array recebido (é o mesmo que alimenta os gráficos)', () => {
    const entrada = [rec(1, Period.MORNING), rec(2, Period.NIGHT)];
    const copia = [...entrada];
    recordsNewestFirst(entrada);
    expect(entrada).toEqual(copia);
  });

  it('lista vazia não quebra', () => {
    expect(recordsNewestFirst([])).toEqual([]);
  });
});

describe('latestRecord', () => {
  it('é a noite quando os dois períodos do último dia existem', () => {
    const r = latestRecord([rec(5, Period.MORNING), rec(5, Period.NIGHT), rec(4, Period.NIGHT)]);
    expect(recordKey(r!)).toBe('5-NIGHT');
  });

  it('é a manhã quando só ela foi registrada no último dia', () => {
    const r = latestRecord([rec(4, Period.NIGHT), rec(5, Period.MORNING)]);
    expect(recordKey(r!)).toBe('5-MORNING');
  });

  it('sem registros, é null', () => {
    expect(latestRecord([])).toBeNull();
  });
});

describe('rótulos', () => {
  it('período em PT-BR minúsculo, como o cabeçalho já escrevia', () => {
    expect(periodLabel(Period.MORNING)).toBe('manhã');
    expect(periodLabel(Period.NIGHT)).toBe('noite');
  });

  it('rótulo do slide junta dia e período', () => {
    expect(recordSlideLabel(rec(6, Period.MORNING))).toBe('6º dia · manhã');
    expect(recordSlideLabel(rec(10, Period.NIGHT))).toBe('10º dia · noite');
  });

  it('a chave distingue manhã e noite do mesmo dia', () => {
    expect(recordKey(rec(6, Period.MORNING))).not.toBe(recordKey(rec(6, Period.NIGHT)));
  });
});
