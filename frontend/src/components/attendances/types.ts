/**
 * Tipagens e estado dos filtros da aba "Meus Atendimentos".
 *
 * Mantêm contratos claros entre a página, os cards, a busca e o drawer de
 * filtros. Os filtros são aplicados sempre sobre atendimentos já finalizados
 * (a fonte de dados garante isso via service).
 */
import type { AttendanceStatus } from '../../services/attendanceService';

export type QuickKey = 'ALL' | 'TODAY' | 'RED' | 'YELLOW';

export interface AttendanceFiltersState {
  search: string;
  /** Card rápido ativo (dimensão própria, aplicada junto com os demais filtros). */
  quick: QuickKey;
  period: 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D';
  status: 'ALL' | AttendanceStatus;
  origin: 'ALL' | 'ALERT' | 'MANUAL_REVIEW';
  level: 'ALL' | 'RED' | 'YELLOW' | 'NONE';
  signal: string; // 'ALL' | label
  team: string; // 'ALL' | team_number
  patient: string; // 'ALL' | patient id
  surgeryType: string; // 'ALL' | nome do tipo
}

export const EMPTY_FILTERS: AttendanceFiltersState = {
  search: '',
  quick: 'ALL',
  period: 'ALL',
  status: 'ALL',
  origin: 'ALL',
  level: 'ALL',
  signal: 'ALL',
  team: 'ALL',
  patient: 'ALL',
  surgeryType: 'ALL',
};

export const SIGNAL_OPTIONS = [
  'Temperatura',
  'Saturação',
  'Pressão',
  'Frequência Cardíaca',
  'Dor',
  'Dispneia',
  'Diurese',
  'Vômitos',
  'Sangramento',
  'Passos',
];
