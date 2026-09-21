/**
 * Ordenação e rotulagem dos registros de sinais vitais para navegação
 * cronológica (carrossel de "Indicadores do registro", no Acompanhamento
 * Individual).
 *
 * Não busca nada: opera sobre os MESMOS `records` que já alimentam os gráficos
 * e a seção de fotos. Só lógica (sem JSX), porque os testes do projeto rodam
 * sem jsdom.
 */
import { Period } from '@vitalsync/shared';
import type { VitalRecord } from './dto';

/** Manhã vem antes da noite no dia; então a noite é o registro "mais recente". */
const PERIOD_ORDER: Record<Period, number> = {
  [Period.MORNING]: 0,
  [Period.NIGHT]: 1,
};

/** Rótulo curto do período, como o cabeçalho da seção já escrevia. */
export function periodLabel(period: Period): string {
  return period === Period.MORNING ? 'manhã' : 'noite';
}

/** Identificação do registro no cabeçalho/slide: "6º dia · manhã". */
export function recordSlideLabel(record: VitalRecord): string {
  return `${record.monitoringDay}º dia · ${periodLabel(record.period)}`;
}

/** Chave estável de um registro (dia + período são únicos por paciente). */
export function recordKey(record: VitalRecord): string {
  return `${record.monitoringDay}-${record.period}`;
}

/**
 * Registros do MAIS RECENTE para o mais antigo.
 *
 * A ordenação é explícita de propósito: a query do painel ordena por
 * `record_date`, que é uma coluna DATE — manhã e noite do mesmo dia EMPATAM, e
 * o desempate fica por conta do banco. Por isso "o último registro" não podia
 * ser `records[records.length - 1]`: num empate ele podia devolver a manhã
 * mesmo já havendo a noite. Aqui o dia de monitoramento e o período decidem.
 */
export function recordsNewestFirst(records: VitalRecord[]): VitalRecord[] {
  return [...records].sort((a, b) => {
    if (a.monitoringDay !== b.monitoringDay) return b.monitoringDay - a.monitoringDay;
    return (PERIOD_ORDER[b.period] ?? 0) - (PERIOD_ORDER[a.period] ?? 0);
  });
}

/** O registro mais recente, ou null quando não há nenhum. */
export function latestRecord(records: VitalRecord[]): VitalRecord | null {
  return recordsNewestFirst(records)[0] ?? null;
}
