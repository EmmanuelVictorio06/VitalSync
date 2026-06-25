/**
 * Helpers de formatação e regras de filtro da aba "Meus Atendimentos".
 *
 * Regras de negócio centralizadas e sem efeitos colaterais, facilitando testes
 * e reaproveitamento entre busca, cards rápidos e filtros avançados.
 */
import { formatCivilDate } from '@vitalsync/shared';
import type { AttendanceRow } from '../../services/attendanceService';
import type { AttendanceFiltersState, QuickKey } from './types';
import { EMPTY_FILTERS } from './types';

export const observationPreview = (row: AttendanceRow): string =>
  row.observation?.trim() ? row.observation.trim() : 'Sem observação registrada.';

/** Valor que disparou o alerta relacionado (a partir do registro de sinais). */
export function triggerValue(row: AttendanceRow): string {
  const r = row.vital_record;
  const type = row.related_vital_sign;
  if (!r || !type) return '—';
  switch (type) {
    case 'Temperatura':
      return r.temperature != null ? `${r.temperature}°C` : '—';
    case 'Saturação':
      return r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—';
    case 'Dor':
      return r.pain_level != null ? `${r.pain_level}/10` : '—';
    case 'Sangramento':
      return r.has_bleeding ? 'Presente' : '—';
    default:
      return '—';
  }
}

/** Faixa de referência / regra clínica aplicada (texto curto e didático). */
export function clinicalRule(row: AttendanceRow): string {
  const red = row.alert?.status === 'RED';
  switch (row.related_vital_sign) {
    case 'Temperatura':
      return red ? 'Temperatura ≥ 38,5 °C' : 'Temperatura ≥ 37,8 °C';
    case 'Saturação':
      return red ? 'Saturação < 92%' : 'Saturação < 94%';
    case 'Dor':
      return red ? 'Dor ≥ 8/10' : 'Dor ≥ 5/10';
    case 'Sangramento':
      return 'Sangramento relatado';
    default:
      return '—';
  }
}

export const fmtDate = (v: string | null | undefined) => (v ? formatCivilDate(v) : '—');

export const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('pt-BR') : '—';

/** Data/hora amigável: "25/06/2026 às 01:02". */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export const teamLabel = (n: number | null | undefined) =>
  n != null ? `Equipe ${String(n).padStart(2, '0')}` : '—';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isYesterday(iso: string): boolean {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
}

/** Texto pesquisável agregado de um atendimento finalizado. */
export function searchableText(row: AttendanceRow): string {
  return [
    row.patient?.name,
    teamLabel(row.team?.team_number),
    row.surgeon_name,
    row.professional_name,
    row.observation,
    row.patient?.surgery_type?.name,
    row.patient?.hospital?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesQuick(row: AttendanceRow, quick: QuickKey): boolean {
  switch (quick) {
    case 'ALL':
      return true;
    case 'TODAY':
      return isToday(row.created_at);
    case 'RED':
      return row.alert_level === 'RED';
    case 'YELLOW':
      return row.alert_level === 'YELLOW';
  }
}

/** Aplica o card rápido; clicar no que já estava ativo volta para "Todos". */
export function applyQuickCard(f: AttendanceFiltersState, key: QuickKey): AttendanceFiltersState {
  return { ...f, quick: f.quick === key ? 'ALL' : key };
}

/** Conta os filtros avançados ativos (não inclui busca nem card rápido). */
export function countAdvancedFilters(f: AttendanceFiltersState): number {
  let n = 0;
  if (f.period !== 'ALL') n++;
  if (f.status !== 'ALL') n++;
  if (f.origin !== 'ALL') n++;
  if (f.level !== 'ALL') n++;
  if (f.signal !== 'ALL') n++;
  if (f.team !== 'ALL') n++;
  if (f.patient !== 'ALL') n++;
  if (f.surgeryType !== 'ALL') n++;
  return n;
}

/** Aplica busca + card rápido + filtros avançados (RLS já limitou o escopo). */
export function applyAttendanceFilters(
  rows: AttendanceRow[],
  f: AttendanceFiltersState,
): AttendanceRow[] {
  const now = Date.now();
  const within: Record<string, number> = { '7D': 7, '30D': 30 };
  const term = f.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (term && !searchableText(row).includes(term)) return false;
    if (!matchesQuick(row, f.quick)) return false;
    if (f.status !== 'ALL' && row.status !== f.status) return false;
    if (f.origin !== 'ALL' && row.origin !== f.origin) return false;
    if (f.level !== 'ALL') {
      if (f.level === 'NONE' ? row.alert != null : row.alert?.status !== f.level) return false;
    }
    if (f.signal !== 'ALL' && (row.related_vital_sign ?? '').toLowerCase() !== f.signal.toLowerCase())
      return false;
    if (f.team !== 'ALL' && String(row.team?.team_number ?? '') !== f.team) return false;
    if (f.patient !== 'ALL' && row.patient?.id !== f.patient) return false;
    if (f.surgeryType !== 'ALL' && (row.patient?.surgery_type?.name ?? '') !== f.surgeryType)
      return false;
    if (f.period !== 'ALL') {
      if (f.period === 'TODAY' && !isToday(row.created_at)) return false;
      if (f.period === 'YESTERDAY' && !isYesterday(row.created_at)) return false;
      const days = within[f.period];
      if (days && now - new Date(row.created_at).getTime() > days * 86_400_000) return false;
    }
    return true;
  });
}

/** Ordena: mais recentes primeiro. */
export function sortAttendances(rows: AttendanceRow[]): AttendanceRow[] {
  return [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** Retorna o card rápido ativo considerando filtros compatíveis (usado para UI). */
export function activeQuickCard(f: AttendanceFiltersState): QuickKey | null {
  return f.quick;
}

/** Limpa filtros avançados mantendo busca e card rápido. */
export function clearAdvancedFilters(
  f: AttendanceFiltersState,
): AttendanceFiltersState {
  return { ...EMPTY_FILTERS, search: f.search, quick: f.quick };
}
