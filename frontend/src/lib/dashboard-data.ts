import { ClinicalStatus } from '@vitalsync/shared';
import type { Role } from '@vitalsync/shared';
import { api } from './api';

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

export interface DashboardAdminKpis {
  totalTeams: number;
  totalDoctors: number;
  totalHospitals: number;
  totalSurgeryTypes: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  weeklyGrowth: string;
  weekly: WeeklyPoint[];
  critical: CriticalPatient[];
  alerts: RecentAlert[];
  admin?: DashboardAdminKpis;
}

/** Configuração visual do dashboard por perfil. */
export interface DashboardRoleConfig {
  subtitle: string;
  sectionTitle: string;
  monitoringLabel: string;
  showAdminKpis: boolean;
  showSystemOverview: boolean;
}

export const DASHBOARD_ROLE_CONFIG: Record<Role, DashboardRoleConfig> = {
  ADM: {
    subtitle: 'Visão geral de todas as equipes e pacientes do sistema.',
    sectionTitle: 'Visão Geral do Sistema',
    monitoringLabel: 'Em monitoramento',
    showAdminKpis: true,
    showSystemOverview: true,
  },
  SURGEON: {
    subtitle: 'Visão geral dos pacientes monitorados pelas suas equipes.',
    sectionTitle: 'Resumo das Minhas Equipes',
    monitoringLabel: 'Minha equipe',
    showAdminKpis: false,
    showSystemOverview: false,
  },
  ASSOCIATE: {
    subtitle: 'Visão geral dos pacientes das equipes em que você participa.',
    sectionTitle: 'Resumo dos Meus Pacientes',
    monitoringLabel: 'Acompanhados',
    showAdminKpis: false,
    showSystemOverview: false,
  },
  SUPPORT: {
    subtitle: 'Acompanhamento operacional dos pacientes.',
    sectionTitle: 'Pacientes',
    monitoringLabel: 'Em monitoramento',
    showAdminKpis: false,
    showSystemOverview: false,
  },
  MANAGER: {
    subtitle: 'Visão geral das equipes e pacientes sob sua gestão.',
    sectionTitle: 'Resumo das Equipes Vinculadas',
    monitoringLabel: 'Em monitoramento',
    showAdminKpis: false,
    showSystemOverview: false,
  },
};

/** Painel real: busca dados agregados via backend. */
export function fetchDashboard(): Promise<DashboardData> {
  return api.get<DashboardData>('/dashboard');
}
