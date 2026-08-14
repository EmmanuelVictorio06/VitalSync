/**
 * Lógica pura do `DateField` (frontend/src/components/ui.tsx).
 *
 * Regra de ouro do arquivo inteiro: NUNCA usar `new Date(stringIso)` + getters
 * locais (`getDate()`, `getMonth()`...). `new Date('2026-08-14')` é interpretado
 * como meia-noite UTC — em horário de Brasília (UTC-3) isso é 21h do dia 13, e
 * ler com getters locais mostra a data errada. Toda aritmética de calendário
 * aqui é feita por partes numéricas (ano/mês/dia) ou com `Date.UTC(...)` lido
 * de volta SEMPRE pelos getters UTC (`getUTCFullYear`, `getUTCMonth`,
 * `getUTCDate`) — nunca mistura UTC na escrita com local na leitura.
 * A única exceção proposital é `todayIso`, que precisa do dia civil LOCAL do
 * usuário (por isso usa `getFullYear`/`getMonth`/`getDate`, sem passar por UTC).
 */

export interface DateParts {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

export interface MonthGridCell {
  /** Data em YYYY-MM-DD desta célula (pode ser de mês anterior/seguinte). */
  iso: string;
  /** Número do dia dentro do PRÓPRIO mês da célula. */
  day: number;
  /** true quando a célula pertence ao mês anterior ou seguinte (fora do mês exibido). */
  outside: boolean;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TYPED_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const WEEKDAY_LABELS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

function isLeapYear(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Quantidade de dias do mês (1-12), tratando fevereiro em ano bissexto. */
export function daysInMonth(ano: number, mes: number): number {
  const DAYS = [31, isLeapYear(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return DAYS[mes - 1] ?? 0;
}

/** Valida uma data de calendário real (mês 1-12, dia dentro do mês/ano dados). */
export function isValidDateParts(ano: number, mes: number, dia: number): boolean {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return false;
  if (mes < 1 || mes > 12) return false;
  if (dia < 1 || dia > daysInMonth(ano, mes)) return false;
  return true;
}

/** 'YYYY-MM-DD' → partes numéricas, ou null se mal formado/inválido. Parse por string, sem Date. */
export function parseIsoDate(value: string): DateParts | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!isValidDateParts(ano, mes, dia)) return null;
  return { ano, mes, dia };
}

export function toIsoDate(ano: number, mes: number, dia: number): string {
  const y = String(ano).padStart(4, '0');
  const m = String(mes).padStart(2, '0');
  const d = String(dia).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' → 'dd/mm/aaaa' para exibição; '' se vazio/inválido. */
export function formatIsoAsTyped(value: string): string {
  const parts = parseIsoDate(value);
  if (!parts) return '';
  return `${String(parts.dia).padStart(2, '0')}/${String(parts.mes).padStart(2, '0')}/${String(parts.ano).padStart(4, '0')}`;
}

/** Máscara progressiva dd/mm/aaaa a partir de dígitos digitados livremente. */
export function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  let out = day;
  if (month) out += `/${month}`;
  if (year) out += `/${year}`;
  return out;
}

/** 'dd/mm/aaaa' COMPLETO → 'YYYY-MM-DD', ou null se incompleto/mal formado/inválido. */
export function parseTypedDate(typed: string): string | null {
  const m = TYPED_RE.exec(typed);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (!isValidDateParts(ano, mes, dia)) return null;
  return toIsoDate(ano, mes, dia);
}

/** Data civil de HOJE no fuso LOCAL do usuário — nunca passa por UTC. */
export function todayIso(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Soma/subtrai meses (delta pode ser negativo), rolando o ano corretamente. */
export function addMonths(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) + delta;
  const newAno = Math.floor(total / 12);
  const newMes = ((total % 12) + 12) % 12 + 1;
  return { ano: newAno, mes: newMes };
}

/**
 * Soma dias corridos a uma data ISO (delta pode ser negativo), atravessando
 * mês/ano se preciso. Aritmética 100% em UTC (escrita e leitura), então não
 * sofre o deslocamento de fuso descrito no cabeçalho do arquivo.
 */
export function shiftDay(iso: string, deltaDays: number): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  const ms = Date.UTC(parts.ano, parts.mes - 1, parts.dia) + deltaDays * 86400000;
  const d = new Date(ms);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** true se `iso` estiver dentro de [min, max] (limites opcionais, inclusivos). */
export function isWithinRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

/**
 * Grade do mês em semanas (domingo primeiro), com dias do mês anterior/seguinte
 * preenchendo só o necessário para completar a primeira e a última semana —
 * sem forçar sempre 6 linhas.
 */
export function buildMonthGrid(ano: number, mes: number): MonthGridCell[][] {
  const firstWeekday = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay(); // 0=domingo
  const monthDays = daysInMonth(ano, mes);
  const totalCells = firstWeekday + monthDays;
  const weeks = Math.ceil(totalCells / 7);

  const prev = addMonths(ano, mes, -1);
  const prevDays = daysInMonth(prev.ano, prev.mes);
  const next = addMonths(ano, mes, 1);

  const cells: MonthGridCell[] = [];

  for (let i = 0; i < firstWeekday; i++) {
    const day = prevDays - firstWeekday + 1 + i;
    cells.push({ iso: toIsoDate(prev.ano, prev.mes, day), day, outside: true });
  }
  for (let day = 1; day <= monthDays; day++) {
    cells.push({ iso: toIsoDate(ano, mes, day), day, outside: false });
  }
  let nextDay = 1;
  while (cells.length < weeks * 7) {
    cells.push({ iso: toIsoDate(next.ano, next.mes, nextDay), day: nextDay, outside: true });
    nextDay++;
  }

  const grid: MonthGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) grid.push(cells.slice(i, i + 7));
  return grid;
}
