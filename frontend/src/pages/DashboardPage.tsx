import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Role, useAuth } from '../auth/AuthContext';
import {
  AlertListCard,
  DashboardMetricCard,
  PatientCriticalCard,
  StatusDonutCard,
  WeeklyBarChart,
} from '../components/dashboard';
import { NurseDashboard } from '../components/NurseDashboard';
import { PageContainer } from '../components/ui';
import { dashboardService } from '../services/dashboardService';
import type { DashboardData } from '../lib/dashboard-data';

function DashboardSkeleton() {
  return (
    <PageContainer size="wide">
      <div className="animate-entry space-y-6">
        <div>
          <div className="h-7 w-48 bg-muted rounded animate-pulse" />
          <div className="h-4 w-72 bg-muted rounded mt-2 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-64 bg-muted rounded-xl animate-pulse" />
          <div className="h-64 bg-muted rounded-xl animate-pulse" />
        </div>
      </div>
    </PageContainer>
  );
}

function DashboardError() {
  return (
    <PageContainer size="wide">
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <HeartPulse className="size-12 mx-auto text-muted-foreground opacity-40" />
        <p className="font-semibold mt-4">Não foi possível carregar o painel.</p>
        <p className="text-sm text-muted-foreground mt-1">Verifique sua conexão e tente novamente.</p>
      </div>
    </PageContainer>
  );
}

/** Cabeçalho e subtítulo por perfil. TODOS os papéis precisam de uma entrada aqui. */
const PROFILE_LABEL: Record<Role, { subtitle: string; sectionTitle: string }> = {
  [Role.ADM]: { subtitle: 'Visão geral de todas as equipes e pacientes do sistema.', sectionTitle: 'Visão Geral do Sistema' },
  [Role.SURGEON]: { subtitle: 'Visão geral dos pacientes monitorados pelas suas equipes.', sectionTitle: 'Resumo das Minhas Equipes' },
  [Role.ASSOCIATE]: { subtitle: 'Visão geral dos pacientes das equipes em que você participa.', sectionTitle: 'Resumo dos Meus Pacientes' },
  [Role.SUPPORT]: { subtitle: 'Acompanhamento operacional dos pacientes.', sectionTitle: 'Pacientes' },
  [Role.MANAGER]: { subtitle: 'Visão geral das equipes e pacientes sob sua gestão.', sectionTitle: 'Resumo das Equipes Vinculadas' },
  [Role.NURSE]: {
    subtitle: 'Triagem, contato ativo e acompanhamento dos pacientes das suas equipes.',
    sectionTitle: 'Central de Enfermagem',
  },
};

function profileLabelFor(role: Role | undefined) {
  return PROFILE_LABEL[role ?? Role.ASSOCIATE] ?? PROFILE_LABEL[Role.ASSOCIATE];
}

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasRole(Role.ADM);
  const isSurgeon = hasRole(Role.SURGEON);
  const isAssociate = hasRole(Role.ASSOCIATE);
  const isNurse = hasRole(Role.NURSE);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A Central de Enfermagem não usa os KPIs genéricos — evita a query extra.
    if (isNurse) {
      setLoading(false);
      return;
    }
    let alive = true;
    dashboardService
      .getDashboard()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [isNurse]);

  function handleSegmentClick(param: string) {
    navigate(`/monitoring?status=${param}`);
  }

  // Profissional de Enfermagem tem um painel operacional próprio (triagem,
  // reaferições, contato ativo) — os demais papéis seguem o painel gerencial.
  if (isNurse) {
    const nurseLabel = profileLabelFor(Role.NURSE);
    return (
      <PageContainer size="wide">
        <div className="animate-entry">
          <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
            Olá, {user?.name?.split(' ')[0] ?? 'Enfermeiro(a)'}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{nurseLabel.subtitle}</p>
        </div>
        <NurseDashboard />
      </PageContainer>
    );
  }

  if (loading) return <DashboardSkeleton />;
  if (!data) return <DashboardError />;

  const { kpis, admin } = data;

  // Lista crítica ordenada: RED primeiro, depois YELLOW (sem GREEN).
  const sortedCritical = [...data.critical].sort((a, b) => {
    if (a.status === 'RED' && b.status !== 'RED') return -1;
    if (a.status !== 'RED' && b.status === 'RED') return 1;
    return a.postOpDay - b.postOpDay;
  });

  const profileLabel = profileLabelFor(user?.role);

  return (
    <PageContainer size="wide">
      {/* Saudação personalizada */}
      <div className="animate-entry">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
          Olá, {user?.name?.split(' ')[0] ?? 'Doutor(a)'}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">{profileLabel.subtitle}</p>
      </div>

      {/* Cards de resumo */}
      <section className="animate-entry [animation-delay:50ms]">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          {profileLabel.sectionTitle}
        </h3>

        {isAdmin && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
              <DashboardMetricCard label="Em monitoramento" value={kpis.monitoring} icon={Activity} tone="primary" />
              <DashboardMetricCard label="Estáveis" value={kpis.stable} icon={CheckCircle2} tone="stable" />
              <DashboardMetricCard label="Atenção" value={kpis.attention} icon={AlertTriangle} tone="warning" />
              <DashboardMetricCard label="Alerta" value={kpis.alert} icon={HeartPulse} tone="alert" />
              <DashboardMetricCard label="Alertas não atendidos" value={kpis.unattendedAlerts} icon={Bell} tone="alert" />
              <DashboardMetricCard label="Registros hoje" value={kpis.recordsToday} icon={ClipboardList} tone="primary" />
            </div>

            {admin && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-3">
                <DashboardMetricCard label="Equipes ativas" value={admin.totalTeams} icon={Users} tone="primary" />
                <DashboardMetricCard label="Médicos cadastrados" value={admin.totalDoctors} icon={Users} tone="primary" />
                <DashboardMetricCard label="Hospitais" value={admin.totalHospitals} icon={Building} tone="stable" />
                <DashboardMetricCard label="Tipos de cirurgia" value={admin.totalSurgeryTypes} icon={HeartPulse} tone="stable" />
              </div>
            )}
          </>
        )}

        {isSurgeon && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <DashboardMetricCard label="Minha equipe" value={kpis.monitoring} icon={Activity} tone="primary" />
            <DashboardMetricCard label="Estáveis" value={kpis.stable} icon={CheckCircle2} tone="stable" />
            <DashboardMetricCard label="Atenção" value={kpis.attention} icon={AlertTriangle} tone="warning" />
            <DashboardMetricCard label="Alerta" value={kpis.alert} icon={HeartPulse} tone="alert" />
            <DashboardMetricCard label="Alertas não atendidos" value={kpis.unattendedAlerts} icon={Bell} tone="alert" />
            <DashboardMetricCard label="Registros hoje" value={kpis.recordsToday} icon={ClipboardList} tone="primary" />
          </div>
        )}

        {isAssociate && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <DashboardMetricCard label="Acompanhados" value={kpis.monitoring} icon={Activity} tone="primary" />
            <DashboardMetricCard label="Estáveis" value={kpis.stable} icon={CheckCircle2} tone="stable" />
            <DashboardMetricCard label="Atenção" value={kpis.attention} icon={AlertTriangle} tone="warning" />
            <DashboardMetricCard label="Alerta" value={kpis.alert} icon={HeartPulse} tone="alert" />
            <DashboardMetricCard label="Alertas não atendidos" value={kpis.unattendedAlerts} icon={Bell} tone="alert" />
            <DashboardMetricCard label="Registros hoje" value={kpis.recordsToday} icon={ClipboardList} tone="primary" />
          </div>
        )}
      </section>

      {/* Layout principal: coluna esquerda (gráfico + lista crítica) | coluna direita (status + alertas) */}
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-6 animate-entry [animation-delay:100ms]">
          <WeeklyBarChart data={data.weekly} growth={data.weeklyGrowth} />

          {/* Lista Crítica de Monitoramento */}
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
            {sortedCritical.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
                <CheckCircle2 className="size-10 mx-auto opacity-30" />
                <p className="font-semibold mt-3">Nenhum paciente crítico no momento.</p>
                <p className="text-sm mt-1">Pacientes em atenção ou alerta aparecerão aqui.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedCritical.map((p) => (
                  <PatientCriticalCard key={p.id} patient={p} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Coluna lateral */}
        <aside className="space-y-6 animate-entry [animation-delay:200ms]">
          <StatusDonutCard
            stable={kpis.stable}
            attention={kpis.attention}
            alert={kpis.alert}
            onSegmentClick={handleSegmentClick}
          />

          <AlertListCard alerts={data.alerts} />
        </aside>
      </div>
    </PageContainer>
  );
}
