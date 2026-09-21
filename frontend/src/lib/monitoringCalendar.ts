/**
 * Calendário dos 10 dias de monitoramento — modelo PURO do widget de adesão
 * ("streak") do topo da aba Visão geral (components/MonitoringStreak.tsx).
 *
 * Nada aqui busca dado: recebe os MESMOS `records` que já alimentam os
 * gráficos e a MESMA data de alta do cabeçalho. As três regras que o widget
 * precisa vêm de fontes que já existem, nenhuma reimplementada:
 *
 *   - numeração/datas dos dias → `monitoringDayDate` (inverso de
 *     `monitoringDay`, em @vitalsync/shared);
 *   - estado do período de HOJE → `classifyPeriodEntry` (o mesmo que decide o
 *     banner "medição da manhã ainda não registrada");
 *   - severidade da medição → `record.overallStatus`, que o banco calculou e
 *     os cards já exibem. NÃO recalculamos status aqui.
 *
 * Só lógica (sem JSX): os testes do projeto rodam sem jsdom.
 */
import {
  ClinicalStatus,
  MONITORING_DAYS,
  Period,
  classifyPeriodEntry,
  monitoringDayDate,
  startOfToday,
} from '@vitalsync/shared';
import type { VitalRecord } from './dto';

/**
 * Estado de UM sub-indicador (manhã ou noite). Os três primeiros são
 * severidade clínica (vêm de `overallStatus`); os três últimos são ausência,
 * e por isso não têm cor de semáforo.
 */
export type SlotState =
  /** Medição registrada — a cor sai do `status`. */
  | 'REGISTERED'
  /** Janela fechada e nada registrado (dia passado, ou hoje já vencido). */
  | 'MISSED'
  /** Período de HOJE ainda aberto (ou nem abriu): ainda dá tempo. */
  | 'WAITING'
  /** Dia futuro: nem chegou a vez. */
  | 'LOCKED';

export interface CalendarSlot {
  period: Period;
  state: SlotState;
  /** Severidade da medição; null quando não há registro. */
  status: ClinicalStatus | null;
  /** Id do registro, para quem quiser navegar até ele. */
  recordId: string | null;
}

export interface CalendarDay {
  /** 1..10 */
  day: number;
  /** Data civil (meia-noite UTC), no formato canônico do projeto. */
  date: Date;
  isToday: boolean;
  isFuture: boolean;
  morning: CalendarSlot;
  night: CalendarSlot;
}

/** Siglas PT-BR indexadas por `getUTCDay()` (0 = domingo). */
const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/**
 * Sigla do dia da semana de uma data civil. Constante em vez de
 * `toLocaleDateString('pt-BR', { weekday: 'short' })` porque o ICU devolve a
 * sigla com ponto ("dom.") e varia entre versões de navegador — aqui o texto
 * é determinístico e testável.
 */
export function weekdayAbbr(date: Date): string {
  return WEEKDAY_ABBR[date.getUTCDay()] ?? '';
}

/** Data civil como DD/MM (o dia completo fica no tooltip). */
export function dayMonth(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

/** Comparação por data civil, ignorando hora (o projeto usa meia-noite UTC). */
function civilMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function slot(
  period: Period,
  record: VitalRecord | undefined,
  posicao: 'PAST' | 'TODAY' | 'FUTURE',
  now: Date,
): CalendarSlot {
  if (record) {
    return { period, state: 'REGISTERED', status: record.overallStatus, recordId: record.id };
  }
  if (posicao === 'FUTURE') return { period, state: 'LOCKED', status: null, recordId: null };
  if (posicao === 'PAST') return { period, state: 'MISSED', status: null, recordId: null };

  // HOJE sem registro: a mesma classificação do banner de esquecimento.
  // NOT_YET_OPEN e OPEN são "ainda dá tempo"; MISSED é janela fechada.
  const estado = classifyPeriodEntry({ period, hasRecord: false, now });
  return {
    period,
    state: estado === 'MISSED' ? 'MISSED' : 'WAITING',
    status: null,
    recordId: null,
  };
}

/**
 * Monta os 10 dias. `records` é a lista já carregada pelo painel; `now` e
 * `today` são injetáveis para teste (default = agora, no fuso da clínica).
 *
 * Fora da janela de monitoramento o widget não quebra: se hoje é anterior à
 * alta, todos os dias saem como futuros; se já passou do dia 10, todos saem
 * como passados. Por isso a posição é decidida comparando DATAS, e não pelo
 * `monitoringDay` (que é null fora de 1..10).
 */
export function buildMonitoringCalendar(input: {
  dischargeDate: Date | string;
  records: VitalRecord[];
  now?: Date;
}): CalendarDay[] {
  const { records, now = new Date() } = input;
  const discharge = typeof input.dischargeDate === 'string' ? new Date(input.dischargeDate) : input.dischargeDate;
  if (Number.isNaN(discharge.getTime())) return [];

  const hojeMs = civilMs(startOfToday(now));

  // Indexa por dia/período — mesma estratégia do `byDay` dos gráficos.
  const porDia = new Map<number, { morning?: VitalRecord; night?: VitalRecord }>();
  for (const r of records) {
    const e = porDia.get(r.monitoringDay) ?? {};
    if (r.period === Period.MORNING) e.morning = r;
    else e.night = r;
    porDia.set(r.monitoringDay, e);
  }

  const dias: CalendarDay[] = [];
  for (let day = 1; day <= MONITORING_DAYS; day++) {
    const date = monitoringDayDate(discharge, day);
    if (!date) continue;
    const ms = civilMs(date);
    const posicao = ms < hojeMs ? 'PAST' : ms > hojeMs ? 'FUTURE' : 'TODAY';
    const doDia = porDia.get(day) ?? {};
    dias.push({
      day,
      date,
      isToday: posicao === 'TODAY',
      isFuture: posicao === 'FUTURE',
      morning: slot(Period.MORNING, doDia.morning, posicao, now),
      night: slot(Period.NIGHT, doDia.night, posicao, now),
    });
  }
  return dias;
}

export interface Adherence {
  /** Sub-indicadores com medição registrada. */
  done: number;
  /** Sub-indicadores que já venceram (registrados + esquecidos). */
  due: number;
  /** Percentual inteiro de `done/due`; 0 quando nada venceu ainda. */
  percent: number;
}

/**
 * Adesão em SLOTS (manhã + noite), não em dias: "11 de 14 medições".
 * Períodos futuros e os de hoje ainda abertos ("aguardando") não entram no
 * denominador — só conta o que já venceu.
 */
export function adherenceFromCalendar(days: CalendarDay[]): Adherence {
  let done = 0;
  let due = 0;
  for (const d of days) {
    for (const s of [d.morning, d.night]) {
      if (s.state === 'REGISTERED') {
        done++;
        due++;
      } else if (s.state === 'MISSED') {
        due++;
      }
    }
  }
  return { done, due, percent: due === 0 ? 0 : Math.round((done / due) * 100) };
}
