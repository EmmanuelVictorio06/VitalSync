import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  addMonths,
  buildMonthGrid,
  daysInMonth,
  formatIsoAsTyped,
  isValidDateParts,
  isWithinRange,
  maskDateInput,
  parseIsoDate,
  parseTypedDate,
  shiftDay,
  toIsoDate,
  todayIso,
} from './dateField';

describe('parseIsoDate / toIsoDate', () => {
  it('faz o parse de uma data ISO válida em partes numéricas', () => {
    expect(parseIsoDate('2026-08-14')).toEqual({ ano: 2026, mes: 8, dia: 14 });
  });

  it('rejeita formato mal formado', () => {
    expect(parseIsoDate('14/08/2026')).toBeNull();
    expect(parseIsoDate('2026-8-14')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('não é data')).toBeNull();
  });

  it('rejeita data de calendário inexistente (31 de fevereiro)', () => {
    expect(parseIsoDate('2026-02-31')).toBeNull();
  });

  it('ida e volta toIsoDate(parseIsoDate(x)) === x', () => {
    for (const x of ['2026-08-14', '1990-01-01', '2000-12-31', '2024-02-29']) {
      const parts = parseIsoDate(x);
      expect(parts).not.toBeNull();
      expect(toIsoDate(parts!.ano, parts!.mes, parts!.dia)).toBe(x);
    }
  });

  it('preenche com zero à esquerda em toIsoDate', () => {
    expect(toIsoDate(2026, 1, 5)).toBe('2026-01-05');
  });
});

describe('isValidDateParts / daysInMonth — ano bissexto e meses de 30/31 dias', () => {
  it('29/02/2024 é válido (2024 é bissexto)', () => {
    expect(isValidDateParts(2024, 2, 29)).toBe(true);
  });

  it('29/02/2025 é inválido (2025 não é bissexto)', () => {
    expect(isValidDateParts(2025, 2, 29)).toBe(false);
  });

  it('2000 é bissexto (divisível por 400) e 1900 não é (divisível por 100, não por 400)', () => {
    expect(isValidDateParts(2000, 2, 29)).toBe(true);
    expect(isValidDateParts(1900, 2, 29)).toBe(false);
  });

  it('mês de 30 dias rejeita dia 31 (ex.: abril)', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(isValidDateParts(2026, 4, 31)).toBe(false);
    expect(isValidDateParts(2026, 4, 30)).toBe(true);
  });

  it('mês de 31 dias aceita dia 31 (ex.: agosto)', () => {
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(isValidDateParts(2026, 8, 31)).toBe(true);
  });

  it('rejeita mês fora de 1-12 e dia 0', () => {
    expect(isValidDateParts(2026, 0, 10)).toBe(false);
    expect(isValidDateParts(2026, 13, 10)).toBe(false);
    expect(isValidDateParts(2026, 8, 0)).toBe(false);
  });
});

describe('maskDateInput', () => {
  it('formata progressivamente enquanto o usuário digita', () => {
    expect(maskDateInput('1')).toBe('1');
    expect(maskDateInput('14')).toBe('14');
    expect(maskDateInput('140')).toBe('14/0');
    expect(maskDateInput('1408')).toBe('14/08');
    expect(maskDateInput('14082')).toBe('14/08/2');
    expect(maskDateInput('14082026')).toBe('14/08/2026');
  });

  it('ignora caracteres não numéricos e trunca em 8 dígitos', () => {
    expect(maskDateInput('14/08/2026')).toBe('14/08/2026');
    expect(maskDateInput('140820269999')).toBe('14/08/2026');
  });
});

describe('parseTypedDate', () => {
  it('aceita dd/mm/aaaa completo e válido', () => {
    expect(parseTypedDate('14/08/2026')).toBe('2026-08-14');
  });

  it('rejeita data digitada incompleta', () => {
    expect(parseTypedDate('14/08')).toBeNull();
    expect(parseTypedDate('14/08/20')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });

  it('rejeita 31/02/2026 (fevereiro não tem 31 dias)', () => {
    expect(parseTypedDate('31/02/2026')).toBeNull();
  });

  it('rejeita 00/00/0000', () => {
    expect(parseTypedDate('00/00/0000')).toBeNull();
  });

  it('rejeita ano com 3 dígitos (não completa o padrão dd/mm/aaaa)', () => {
    expect(parseTypedDate('14/08/202')).toBeNull();
  });
});

describe('buildMonthGrid', () => {
  it('semana começa no domingo', () => {
    // agosto/2026 começa num sábado — a primeira célula da 1ª semana é do mês anterior
    const grid = buildMonthGrid(2026, 8);
    expect(grid[0][0].outside).toBe(true); // preenchimento de julho
    // 01/08/2026 é sábado → cai na última coluna (índice 6) da 1ª semana
    const firstRealDay = grid[0].find((c) => !c.outside && c.day === 1);
    expect(firstRealDay?.iso).toBe('2026-08-01');
  });

  it('dias fora do mês são marcados como outside e pertencem ao mês vizinho correto', () => {
    const grid = buildMonthGrid(2026, 8);
    const leading = grid[0].filter((c) => c.outside);
    for (const cell of leading) {
      expect(cell.iso.startsWith('2026-07')).toBe(true);
    }
  });

  it('grade com 4 semanas (fevereiro não bissexto começando no domingo)', () => {
    // fevereiro/2026 tem 28 dias e começa num domingo
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0][0].outside).toBe(false);
    expect(grid[0][0].iso).toBe('2026-02-01');
    expect(grid.length).toBe(4);
  });

  it('grade com 5 semanas (mês comum)', () => {
    const grid = buildMonthGrid(2026, 1); // janeiro/2026: 31 dias começando numa quinta-feira
    expect(grid.length).toBe(5);
  });

  it('grade com 6 semanas (mês de 31 dias começando no sábado)', () => {
    const grid = buildMonthGrid(2026, 8); // agosto/2026: 31 dias começando no sábado
    expect(grid.length).toBe(6);
  });

  it('primeiro dia do mês caindo no domingo não gera preenchimento à esquerda', () => {
    const grid = buildMonthGrid(2026, 2); // fevereiro/2026 começa no domingo
    expect(grid[0].every((c) => !c.outside)).toBe(true);
  });

  it('último dia do mês caindo no sábado não gera preenchimento à direita', () => {
    // fevereiro/2026 tem 28 dias, começa no domingo e termina no sábado — grade
    // exata de 4 semanas, sem nenhuma célula "fora do mês" em nenhuma ponta.
    const grid = buildMonthGrid(2026, 2);
    const lastWeek = grid[grid.length - 1];
    expect(lastWeek.every((c) => !c.outside)).toBe(true);
  });

  it('mantém a data correta em cada célula sem deslocamento por fuso', () => {
    const grid = buildMonthGrid(2026, 8);
    const all = grid.flat();
    const day14 = all.find((c) => c.iso === '2026-08-14');
    expect(day14).toBeDefined();
    expect(day14?.outside).toBe(false);
    expect(day14?.day).toBe(14);
  });
});

describe('addMonths', () => {
  it('avança e retrocede dentro do mesmo ano', () => {
    expect(addMonths(2026, 8, 1)).toEqual({ ano: 2026, mes: 9 });
    expect(addMonths(2026, 8, -1)).toEqual({ ano: 2026, mes: 7 });
  });

  it('vira o ano ao avançar de dezembro', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 });
  });

  it('vira o ano ao retroceder de janeiro', () => {
    expect(addMonths(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 });
  });
});

describe('shiftDay', () => {
  it('soma dias corridos dentro do mesmo mês', () => {
    expect(shiftDay('2026-08-14', 1)).toBe('2026-08-15');
    expect(shiftDay('2026-08-14', -1)).toBe('2026-08-13');
  });

  it('atravessa virada de mês', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('atravessa virada de ano', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('isWithinRange', () => {
  it('sem min/max, tudo está dentro do intervalo', () => {
    expect(isWithinRange('2026-08-14')).toBe(true);
  });

  it('respeita min e max (comparação lexicográfica de YYYY-MM-DD é cronológica)', () => {
    expect(isWithinRange('2026-08-14', '2026-08-01', '2026-08-31')).toBe(true);
    expect(isWithinRange('2026-07-31', '2026-08-01', '2026-08-31')).toBe(false);
    expect(isWithinRange('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false);
  });
});

describe('formatIsoAsTyped', () => {
  it('formata ISO para dd/mm/aaaa', () => {
    expect(formatIsoAsTyped('2026-08-14')).toBe('14/08/2026');
  });

  it('retorna string vazia para valor vazio ou inválido', () => {
    expect(formatIsoAsTyped('')).toBe('');
    expect(formatIsoAsTyped('data inválida')).toBe('');
  });
});

describe('todayIso — sem deslocamento de fuso horário', () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  it('às 22h em America/Sao_Paulo (UTC-3), "hoje" continua sendo o dia corrente local, não o seguinte em UTC', () => {
    process.env.TZ = 'America/Sao_Paulo';
    vi.useFakeTimers();
    // 22h de 13/08/2026 em BRT (UTC-3) = 01h de 14/08/2026 em UTC.
    vi.setSystemTime(new Date('2026-08-14T01:00:00Z'));
    expect(todayIso()).toBe('2026-08-13');
  });

  it('pouco antes da meia-noite UTC ainda é o mesmo dia local em fuso negativo', () => {
    process.env.TZ = 'America/Sao_Paulo';
    vi.useFakeTimers();
    // 20h59 de 13/08/2026 em BRT = 23h59 de 13/08/2026 em UTC.
    vi.setSystemTime(new Date('2026-08-13T23:59:00Z'));
    expect(todayIso()).toBe('2026-08-13');
  });
});
