/**
 * Agrupamento da tela de Monitoramento em "Em andamento" x "Concluídos".
 * Função PURA — a lista vem de `patientService.list()` e é só dividida aqui.
 *
 * Regra (a mesma do @vitalsync/shared, sem segunda versão):
 *   concluído = tem data de alta E daysSinceDischarge(alta) >= MONITORING_DAYS
 * Todo o resto é "em andamento": alta nula, alta futura e alta de até 9 dias
 * atrás (dia da alta = dia 1, então o 10º e último dia é alta + 9).
 *
 * Datas civis no fuso da clínica via `startOfToday`/`daysSinceDischarge`.
 *
 * Regra nova (`startsNextDay = true`, migration 0082): o dia 1 é alta + 1, então
 * o último dia é alta + 10 e o paciente só conclui a partir de alta + 11. O
 * padrão `false` é a regra antiga acima, sem nenhuma mudança.
 */
import {
  MONITORING_DAYS,
  daysSinceDischarge,
  monitoringAnchor,
  monitoringDayDate,
  startOfToday,
} from '@vitalsync/shared';

export type MonitoringGroup = 'andamento' | 'concluidos';

/** Grupo do paciente a partir de `hospital_discharge_date` ('YYYY-MM-DD'). */
export function patientGroup(
  hospitalDischargeDate: string | null | undefined,
  startsNextDay = false,
): MonitoringGroup {
  if (!hospitalDischargeDate) return 'andamento';
  if (startsNextDay) {
    // Concluído = hoje já passou do último dia da janela (âncora + 9 = alta + 10).
    // `daysSinceDischarge` fica só com a alta real, no ramo antigo.
    const fim = monitoringEndDate(new Date(hospitalDischargeDate), true);
    return fim && startOfToday().getTime() > fim.getTime() ? 'concluidos' : 'andamento';
  }
  return daysSinceDischarge(new Date(hospitalDischargeDate), startOfToday()) >= MONITORING_DAYS
    ? 'concluidos'
    : 'andamento';
}

/**
 * Último dia do monitoramento, para exibir "Concluído em dd/mm/aaaa":
 * alta + 9 na regra antiga, alta + 10 na nova.
 */
export function monitoringEndDate(alta: Date, startsNextDay = false): Date | null {
  return monitoringDayDate(monitoringAnchor(alta, startsNextDay), MONITORING_DAYS);
}

/**
 * true quando há data de alta e hoje (dia civil de São Paulo) ainda é o dia da
 * alta ou anterior a ele — o monitoramento ainda não começou.
 *
 * Na tela do paciente (VitalsRegisterPage) ela só é consultada quando
 * `within_window` é false, e nesse ponto só pode ser verdadeira para paciente da
 * REGRA NOVA (dia 1 = alta + 1): para a regra antiga, a `get_patient_by_token`
 * não tem limite inferior na janela, então antes da alta o `within_window` dele é
 * true e a tela mostra o formulário, como sempre mostrou.
 */
export function monitoringNotStartedYet(hospitalDischargeDate: string | null | undefined): boolean {
  if (!hospitalDischargeDate) return false;
  return daysSinceDischarge(new Date(hospitalDischargeDate.slice(0, 10))) === 0;
}
