/**
 * Calendário de 10 dias do Acompanhamento Individual (lib/monitoringCalendar.ts).
 *
 * O que estes testes protegem:
 *   - as datas saem do mesmo de-para de dia de monitoramento (dia 1 = alta);
 *   - manhã e noite são INDEPENDENTES (um turno pode estar vermelho e o outro
 *     sem registro no mesmo dia);
 *   - a cor vem do `overallStatus` do registro — nada é recalculado aqui;
 *   - "hoje" distingue janela ainda aberta (aguardando) de janela fechada
 *     (sem registro), com a mesma regra do banner de esquecimento;
 *   - a adesão conta SLOTS vencidos, nunca períodos futuros.
 */
import { describe, expect, it } from 'vitest';
import { ClinicalStatus, Period } from '@vitalsync/shared';
import type { VitalRecord } from './dto';
import {
  adherenceFromCalendar,
  buildMonitoringCalendar,
  dayMonth,
  weekdayAbbr,
  type CalendarDay,
} from './monitoringCalendar';

/** Data civil (meia-noite UTC), formato canônico do projeto. */
const civil = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Alta em 2026-03-01 (domingo) → dia 1 = 01/03, dia 10 = 10/03. */
const ALTA = civil(2026, 3, 1);

/**
 * Registro mínimo: o widget só lê monitoringDay, period e overallStatus.
 * O resto do DTO é preenchido com valores neutros.
 */
function rec(monitoringDay: number, period: Period, overallStatus: ClinicalStatus): VitalRecord {
  return {
    id: `r-${monitoringDay}-${period}`,
    monitoringDay,
    period,
    overallStatus,
    statusByVital: {},
  } as unknown as VitalRecord;
}

/**
 * "Agora" = 2026-03-05, 11h no fuso da clínica (14:00Z, UTC-3). Nesse horário
 * a janela da manhã (08–10) JÁ fechou e a da noite (18–20) ainda não abriu.
 */
const AGORA_DIA5 = new Date('2026-03-05T14:00:00Z');

const calendario = (records: VitalRecord[], now = AGORA_DIA5): CalendarDay[] =>
  buildMonitoringCalendar({ dischargeDate: ALTA, records, now });

const dia = (days: CalendarDay[], n: number) => days.find((d) => d.day === n)!;

describe('estrutura dos 10 dias', () => {
  const days = calendario([]);

  it('monta exatamente 10 células, de D1 a D10', () => {
    expect(days).toHaveLength(10);
    expect(days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('dia 1 é o dia da alta e dia 10 é nove dias depois', () => {
    expect(dia(days, 1).date.toISOString()).toBe(ALTA.toISOString());
    expect(dia(days, 10).date.toISOString()).toBe(civil(2026, 3, 10).toISOString());
  });

  it('marca hoje uma única vez, e o futuro depois dele', () => {
    expect(days.filter((d) => d.isToday).map((d) => d.day)).toEqual([5]);
    expect(days.filter((d) => d.isFuture).map((d) => d.day)).toEqual([6, 7, 8, 9, 10]);
  });
});

describe('formatação de data', () => {
  it('sigla PT-BR do dia da semana, sem ponto', () => {
    expect(weekdayAbbr(civil(2026, 3, 1))).toBe('dom');
    expect(weekdayAbbr(civil(2026, 3, 2))).toBe('seg');
    expect(weekdayAbbr(civil(2026, 3, 7))).toBe('sáb');
  });

  it('as siglas acompanham as datas reais dos 10 dias', () => {
    expect(calendario([]).map((d) => weekdayAbbr(d.date))).toEqual([
      'dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom', 'seg', 'ter',
    ]);
  });

  it('data curta em DD/MM com zero à esquerda', () => {
    expect(dayMonth(civil(2026, 3, 1))).toBe('01/03');
    expect(dayMonth(civil(2026, 12, 25))).toBe('25/12');
  });
});

describe('status de cada sub-indicador', () => {
  it('usa o overallStatus do registro, sem recalcular', () => {
    const days = calendario([
      rec(1, Period.MORNING, ClinicalStatus.GREEN),
      rec(2, Period.MORNING, ClinicalStatus.YELLOW),
      rec(3, Period.MORNING, ClinicalStatus.RED),
    ]);
    expect(dia(days, 1).morning).toMatchObject({ state: 'REGISTERED', status: ClinicalStatus.GREEN });
    expect(dia(days, 2).morning).toMatchObject({ state: 'REGISTERED', status: ClinicalStatus.YELLOW });
    expect(dia(days, 3).morning).toMatchObject({ state: 'REGISTERED', status: ClinicalStatus.RED });
  });

  it('manhã e noite são independentes no mesmo dia', () => {
    const days = calendario([rec(2, Period.NIGHT, ClinicalStatus.RED)]);
    expect(dia(days, 2).morning).toMatchObject({ state: 'MISSED', status: null });
    expect(dia(days, 2).night).toMatchObject({ state: 'REGISTERED', status: ClinicalStatus.RED });
  });

  it('dia passado sem medição é "sem registro" nos dois turnos', () => {
    const days = calendario([]);
    expect(dia(days, 1).morning.state).toBe('MISSED');
    expect(dia(days, 1).night.state).toBe('MISSED');
  });

  it('dia futuro fica bloqueado', () => {
    const days = calendario([]);
    expect(dia(days, 6).morning.state).toBe('LOCKED');
    expect(dia(days, 10).night.state).toBe('LOCKED');
  });

  it('guarda o id do registro para quem quiser navegar até ele', () => {
    const days = calendario([rec(4, Period.NIGHT, ClinicalStatus.GREEN)]);
    expect(dia(days, 4).night.recordId).toBe('r-4-NIGHT');
    expect(dia(days, 4).morning.recordId).toBeNull();
  });
});

describe('hoje: janela aberta vs. janela vencida (mesma regra do banner)', () => {
  it('às 11h: manhã vencida (sem registro) e noite ainda aguardando', () => {
    const hoje = dia(calendario([]), 5);
    expect(hoje.morning.state).toBe('MISSED');
    expect(hoje.night.state).toBe('WAITING');
  });

  it('às 7h: os dois turnos ainda aguardando (nenhuma janela abriu)', () => {
    const hoje = dia(calendario([], new Date('2026-03-05T10:00:00Z')), 5);
    expect(hoje.morning.state).toBe('WAITING');
    expect(hoje.night.state).toBe('WAITING');
  });

  it('às 21h: os dois turnos vencidos', () => {
    const hoje = dia(calendario([], new Date('2026-03-06T00:00:00Z')), 5);
    expect(hoje.morning.state).toBe('MISSED');
    expect(hoje.night.state).toBe('MISSED');
  });

  it('turno de hoje já registrado vence a janela', () => {
    const hoje = dia(calendario([rec(5, Period.MORNING, ClinicalStatus.YELLOW)]), 5);
    expect(hoje.morning).toMatchObject({ state: 'REGISTERED', status: ClinicalStatus.YELLOW });
  });
});

describe('adesão em slots', () => {
  it('conta registrados sobre vencidos, ignorando futuros e aguardando', () => {
    // Dias 1-4 vencidos (8 slots) + manhã do dia 5 vencida = 9 slots.
    // Registrados: 7. A noite de hoje está aguardando; D6-D10 são futuros.
    const days = calendario([
      rec(1, Period.MORNING, ClinicalStatus.GREEN), rec(1, Period.NIGHT, ClinicalStatus.GREEN),
      rec(2, Period.MORNING, ClinicalStatus.YELLOW), rec(2, Period.NIGHT, ClinicalStatus.GREEN),
      rec(3, Period.MORNING, ClinicalStatus.RED),
      rec(4, Period.MORNING, ClinicalStatus.GREEN), rec(4, Period.NIGHT, ClinicalStatus.GREEN),
    ]);
    expect(adherenceFromCalendar(days)).toEqual({ done: 7, due: 9, percent: 78 });
  });

  it('sem nenhum registro, adesão é 0 sobre os vencidos', () => {
    expect(adherenceFromCalendar(calendario([]))).toEqual({ done: 0, due: 9, percent: 0 });
  });

  it('percentual é inteiro (nada de casa decimal na tela)', () => {
    const { percent } = adherenceFromCalendar(calendario([rec(1, Period.MORNING, ClinicalStatus.GREEN)]));
    expect(Number.isInteger(percent)).toBe(true);
    expect(percent).toBe(11); // 1/9
  });

  it('no primeiro dia, antes de qualquer janela fechar, nada venceu', () => {
    const days = buildMonitoringCalendar({
      dischargeDate: ALTA,
      records: [],
      now: new Date('2026-03-01T10:00:00Z'), // 07h na clínica, dia 1
    });
    expect(adherenceFromCalendar(days)).toEqual({ done: 0, due: 0, percent: 0 });
  });
});

describe('fora da janela de monitoramento', () => {
  it('antes da alta, os 10 dias são futuros', () => {
    const days = buildMonitoringCalendar({
      dischargeDate: ALTA,
      records: [],
      now: new Date('2026-02-25T14:00:00Z'),
    });
    expect(days.every((d) => d.isFuture)).toBe(true);
    expect(days.every((d) => d.morning.state === 'LOCKED' && d.night.state === 'LOCKED')).toBe(true);
    expect(adherenceFromCalendar(days).due).toBe(0);
  });

  it('depois do dia 10, todos os slots já venceram (20 no total)', () => {
    const days = buildMonitoringCalendar({
      dischargeDate: ALTA,
      records: [rec(10, Period.NIGHT, ClinicalStatus.GREEN)],
      now: new Date('2026-03-20T14:00:00Z'),
    });
    expect(days.some((d) => d.isToday || d.isFuture)).toBe(false);
    expect(adherenceFromCalendar(days)).toEqual({ done: 1, due: 20, percent: 5 });
  });

  it('data de alta inválida não quebra a tela', () => {
    expect(buildMonitoringCalendar({ dischargeDate: '', records: [] })).toEqual([]);
  });
});
