import { Navigate, Route, Routes } from 'react-router-dom';
import { type ReactElement } from 'react';
import { Role, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { adminRoles } from './lib/permissions';
import { AlertsPage } from './pages/AlertsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { PatientRegisterPage } from './pages/PatientRegisterPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { TeamsPage } from './pages/TeamsPage';
import { VitalsRegisterPage } from './pages/VitalsRegisterPage';
import { ExportsPage } from './pages/admin/ExportsPage';
import { HospitalsPage } from './pages/admin/HospitalsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { SurgeryTypesPage } from './pages/admin/SurgeryTypesPage';

function RequireAuth({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center bg-background"><Loading label="Carregando CuraPath…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login" element={<LoginPage />} />
      {/* Tela do paciente — acesso somente via link com token (sem login) */}
      <Route path="/r/:token" element={<VitalsRegisterPage />} />

      {/* Internas (autenticadas) */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/patients/new" element={<PatientRegisterPage />} />
        <Route path="/patients/:id" element={<PatientDashboardPage />} />
        <Route path="/alerts" element={<AlertsPage />} />

        {/* Equipes: ADM gerencia todas; cirurgião principal vê a sua ("Minha Equipe") */}
        <Route
          path="/teams"
          element={
            <RequireAuth roles={[Role.ADM, Role.SURGEON]}>
              <TeamsPage />
            </RequireAuth>
          }
        />

        {/* Área do profissional */}
        <Route
          path="/my-care"
          element={
            <RequireAuth roles={[Role.SURGEON, Role.ASSOCIATE]}>
              <PlaceholderPage
                title="Meus Atendimentos"
                description="Histórico dos pacientes atendidos por você, com data, status e medições relacionadas."
              />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth roles={[Role.SURGEON, Role.ASSOCIATE]}>
              <PlaceholderPage
                title="Meu Perfil"
                description="Seus dados profissionais, contato de WhatsApp para alertas e preferências de notificação."
              />
            </RequireAuth>
          }
        />

        {/* Administração — papéis definidos em lib/permissions (backend revalida) */}
        <Route
          path="/admin/hospitals"
          element={
            <RequireAuth roles={adminRoles()}>
              <HospitalsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/surgery-types"
          element={
            <RequireAuth roles={adminRoles()}>
              <SurgeryTypesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/exports"
          element={
            <RequireAuth roles={[Role.ADM]}>
              <ExportsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAuth roles={adminRoles()}>
              <SettingsPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
