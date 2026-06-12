import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardList,
  FileDown,
  HeartPulse,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Role, useAuth } from '../auth/AuthContext';
import {
  AlertListCard,
  DashboardMetricCard,
  PatientCriticalCard,
  QuickActionCard,
  StatusDonutCard,
  WeeklyBarChart,
} from '../components/dashboard';
import { getDashboardData } from '../lib/dashboard-data';

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(Role.ADM);

  // ADM enxerga o sistema inteiro; profissional, somente a própria equipe.
  const data = getDashboardData(isAdmin ? 'system' : 'team');
  const { kpis } = data;

  const quickActions = isAdmin
    ? [
        { to: '/patients/new', label: 'Cadastrar paciente', icon: UserPlus },
        { to: '/teams', label: 'Gerenciar equipes', icon: Users },
        { to: '/monitoring', label: 'Ver pacientes', icon: Activity },
        { to: '/admin/exports', label: 'Exportar dados', icon: FileDown },
      ]
    : [
        { to: '/patients/new', label: 'Cadastrar paciente', icon: UserPlus },
        { to: '/monitoring', label: 'Ver pacientes', icon: Activity },
        { to: '/alerts', label: 'Ver alertas', icon: Bell },
        { to: '/my-care', label: 'Meus atendimentos', icon: ClipboardList },
      ];

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto w-full">
      <div className="animate-entry">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
          Olá, {user?.name?.split(' ')[0] ?? 'Doutor(a)'} 👋
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isAdmin
            ? 'Visão geral de todas as equipes e pacientes do sistema.'
            : 'Visão geral dos pacientes monitorados pela sua equipe.'}
        </p>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 animate-entry [animation-delay:50ms]">
        <DashboardMetricCard label="Em monitoramento" value={kpis.monitoring} icon={Activity} tone="primary" />
        <DashboardMetricCard label="Estáveis" value={kpis.stable} icon={CheckCircle2} tone="stable" />
        <DashboardMetricCard label="Atenção" value={kpis.attention} icon={AlertTriangle} tone="warning" />
        <DashboardMetricCard label="Alerta" value={kpis.alert} icon={HeartPulse} tone="alert" />
        <DashboardMetricCard label="Alertas não atendidos" value={kpis.unattendedAlerts} icon={Bell} tone="alert" />
        <DashboardMetricCard label="Registros hoje" value={kpis.recordsToday} icon={ClipboardList} tone="primary" />
      </section>

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-6 animate-entry [animation-delay:100ms]">
          <WeeklyBarChart data={data.weekly} growth={data.weeklyGrowth} />

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Lista Crítica de Monitoramento
              </h2>
              <Link
                to="/monitoring"
                className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                Ver todos <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {data.critical.map((p) => (
                <PatientCriticalCard key={p.id} patient={p} />
              ))}
            </div>
          </section>
        </div>

        {/* Coluna lateral */}
        <aside className="space-y-6 animate-entry [animation-delay:200ms]">
          <StatusDonutCard stable={kpis.stable} attention={kpis.attention} alert={kpis.alert} />
          <AlertListCard alerts={data.alerts} />
          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Atalhos Rápidos
            </h2>
            <div className="grid gap-2">
              {quickActions.map((s) => (
                <QuickActionCard key={s.to} to={s.to} label={s.label} icon={s.icon} />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
