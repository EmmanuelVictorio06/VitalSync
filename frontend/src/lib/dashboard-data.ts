/**
 * Dados do Painel de Monitoramento.
 *
 * Mock tipado e separado por escopo de permissão:
 *   - 'system': visão do Administrador (todo o sistema)
 *   - 'team':   visão do Profissional/Médico (somente a equipe dele)
 *
 * Quando o backend expuser os endpoints de agregação (ex.: GET /api/dashboard),
 * basta substituir `getDashboardData` por uma chamada à API mantendo os tipos.
 */
import { ClinicalStatus } from '@vitalsync/shared';

export type DashboardScope = 'system' | 'team';

export interface DashboardKpis {
  monitoring: number;
  stable: number;
  attention: number;
  alert: number;
  unattendedAlerts: number;
  recordsToday: number;
}

export interface WeeklyPoint {
  day: string;
  count: number;
}

export interface CriticalPatient {
  id: string;
  name: string;
  surgeryType: string;
  postOpDay: number;
  vitalValue: string;
  vitalLabel: string;
  status: ClinicalStatus;
}

export type AlertSeverity = 'RED' | 'YELLOW';

export interface RecentAlert {
  id: string;
  patientName: string;
  description: string;
  datetime: string;
  severity: AlertSeverity;
}

export interface DashboardData {
  kpis: DashboardKpis;
  weeklyGrowth: string;
  weekly: WeeklyPoint[];
  critical: CriticalPatient[];
  alerts: RecentAlert[];
}

const SYSTEM: DashboardData = {
  kpis: { monitoring: 542, stable: 498, attention: 32, alert: 12, unattendedAlerts: 7, recordsToday: 318 },
  weeklyGrowth: '+8.2%',
  weekly: [
    { day: 'Seg', count: 280 },
    { day: 'Ter', count: 312 },
    { day: 'Qua', count: 298 },
    { day: 'Qui', count: 340 },
    { day: 'Sex', count: 318 },
    { day: 'Sáb', count: 220 },
    { day: 'Dom', count: 190 },
  ],
  critical: [
    { id: 'p1', name: 'Marcos Oliveira', surgeryType: 'Bariátrica', postOpDay: 3, vitalValue: '38,9°C', vitalLabel: 'Febre', status: ClinicalStatus.RED },
    { id: 'p2', name: 'Elena Ricci', surgeryType: 'Ortopédica — Joelho', postOpDay: 1, vitalValue: '89%', vitalLabel: 'Saturação', status: ClinicalStatus.YELLOW },
    { id: 'p3', name: 'Julian Bass', surgeryType: 'Cardiovascular', postOpDay: 5, vitalValue: '120/80', vitalLabel: 'PA', status: ClinicalStatus.GREEN },
    { id: 'p4', name: 'Beatriz Silva', surgeryType: 'Artroplastia de Quadril', postOpDay: 4, vitalValue: '72 bpm', vitalLabel: 'FC', status: ClinicalStatus.GREEN },
  ],
  alerts: [
    { id: 'a1', patientName: 'Marcos Oliveira', description: 'Febre alta (38,9°C)', datetime: '2026-06-12 09:14', severity: 'RED' },
    { id: 'a2', patientName: 'Ricardo Alves', description: 'Dor reportada 9/10', datetime: '2026-06-12 08:42', severity: 'RED' },
    { id: 'a3', patientName: 'Elena Ricci', description: 'Saturação baixa (89%)', datetime: '2026-06-12 07:55', severity: 'YELLOW' },
    { id: 'a4', patientName: 'Clara Nunes', description: 'Temperatura limítrofe (37,8°C)', datetime: '2026-06-11 22:20', severity: 'YELLOW' },
  ],
};

const TEAM: DashboardData = {
  kpis: { monitoring: 36, stable: 31, attention: 3, alert: 2, unattendedAlerts: 2, recordsToday: 22 },
  weeklyGrowth: '+4.6%',
  weekly: [
    { day: 'Seg', count: 18 },
    { day: 'Ter', count: 24 },
    { day: 'Qua', count: 20 },
    { day: 'Qui', count: 26 },
    { day: 'Sex', count: 22 },
    { day: 'Sáb', count: 14 },
    { day: 'Dom', count: 12 },
  ],
  critical: [
    { id: 't1', name: 'Ana Souza', surgeryType: 'Apendicectomia', postOpDay: 4, vitalValue: '38,7°C', vitalLabel: 'Febre', status: ClinicalStatus.RED },
    { id: 't2', name: 'Carlos Lima', surgeryType: 'Artroplastia de joelho', postOpDay: 6, vitalValue: '91%', vitalLabel: 'Saturação', status: ClinicalStatus.YELLOW },
    { id: 't3', name: 'Beatriz Rocha', surgeryType: 'Cesariana', postOpDay: 7, vitalValue: '7/10', vitalLabel: 'Dor', status: ClinicalStatus.YELLOW },
    { id: 't4', name: 'João Pereira', surgeryType: 'Colecistectomia', postOpDay: 10, vitalValue: '36,6°C', vitalLabel: 'Temp.', status: ClinicalStatus.GREEN },
  ],
  alerts: [
    { id: 'b1', patientName: 'Ana Souza', description: 'Febre alta (38,7°C)', datetime: '2026-06-12 08:50', severity: 'RED' },
    { id: 'b2', patientName: 'Carlos Lima', description: 'Saturação baixa (91%)', datetime: '2026-06-12 07:30', severity: 'RED' },
    { id: 'b3', patientName: 'Beatriz Rocha', description: 'Dor reportada 7/10', datetime: '2026-06-11 21:40', severity: 'YELLOW' },
    { id: 'b4', patientName: 'João Pereira', description: 'Diurese reduzida (3x)', datetime: '2026-06-11 20:05', severity: 'YELLOW' },
  ],
};

export function getDashboardData(scope: DashboardScope): DashboardData {
  return scope === 'system' ? SYSTEM : TEAM;
}
