/**
 * Janela usada pela Adesão e Completude (adherenceService) — função PURA.
 *
 * `dsd` = `daysSinceDischarge` com a ALTA REAL (dias corridos desde a alta).
 * A partir dele saem os dias que já contam para a adesão (teto de 10) e se a
 * janela de 10 dias já encerrou.
 *
 *   - regra antiga (`startsNextDay = false`): dia 1 = dia da alta, então no dia
 *     da alta já conta 1 dia e a janela fecha em dsd = 10 (alta + 10 está fora).
 *   - regra nova (`startsNextDay = true`, migration 0082): dia 1 = alta + 1,
 *     então no dia da alta conta 0 e a janela segue aberta até dsd = 10.
 */
export function adherenceWindow(
  dsd: number,
  startsNextDay = false,
): { effectiveDays: number; closed: boolean } {
  if (!startsNextDay) {
    const effectiveDays = Math.min(dsd + 1, 10);
    const monitoringWindowClosed = dsd >= 10;
    return { effectiveDays, closed: monitoringWindowClosed };
  }
  return { effectiveDays: Math.min(dsd, 10), closed: dsd > 10 };
}
