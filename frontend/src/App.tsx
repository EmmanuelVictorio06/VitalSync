import { Navigate, Route, Routes } from 'react-router-dom';
import { Role } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { PermissionGuard } from './components/PermissionGuard';
import { adminRoles } from './lib/permissions';
import { AlertsPage } from './pages/AlertsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { MyTeamPage } from './pages/MyTeamPage';
import { MyTeamsPage } from './pages/MyTeamsPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { PatientRegisterPage } from './pages/PatientRegisterPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { TeamsPage } from './pages/TeamsPage';
import { VitalsRegisterPage } from './pages/VitalsRegisterPage';
import { ExportsPage } from './pages/admin/ExportsPage';
import { HospitalsPage } from './pages/admin/HospitalsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { SurgeryTypesPage } from './pages/admin/SurgeryTypesPage';

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
          <PermissionGuard>
            <Layout />
          </PermissionGuard>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        {/* Cadastro de pacientes: Administrador e Cirurgião Principal */}
        <Route
          path="/patients/new"
          element={
            <PermissionGuard roles={[Role.ADM, Role.SURGEON]}>
              <PatientRegisterPage />
            </PermissionGuard>
          }
        />
        <Route path="/patients/:id" element={<PatientDashboardPage />} />
        <Route path="/alerts" element={<AlertsPage />} />

        {/* Gerenciar Equipes — exclusivo do Administrador (todas as equipes) */}
        <Route
          path="/teams"
          element={
            <PermissionGuard roles={[Role.ADM]}>
              <TeamsPage />
            </PermissionGuard>
          }
        />

        {/* Minha Equipe — exclusivo do Cirurgião Principal (a própria equipe) */}
        <Route
          path="/my-team"
          element={
            <PermissionGuard roles={[Role.SURGEON]}>
              <MyTeamPage />
            </PermissionGuard>
          }
        />

        {/* Minhas Equipes — exclusivo do Médico Associado (somente leitura) */}
        <Route
          path="/my-teams"
          element={
            <PermissionGuard roles={[Role.ASSOCIATE]}>
              <MyTeamsPage />
            </PermissionGuard>
          }
        />

        {/* Área do profissional */}
        <Route
          path="/my-care"
          element={
            <PermissionGuard roles={[Role.SURGEON, Role.ASSOCIATE]}>
              <PlaceholderPage
                title="Meus Atendimentos"
                description="Histórico dos pacientes atendidos por você, com data, status e medições relacionadas."
              />
            </PermissionGuard>
          }
        />
        <Route
          path="/profile"
          element={
            <PermissionGuard roles={[Role.SURGEON, Role.ASSOCIATE]}>
              <PlaceholderPage
                title="Meu Perfil"
                description="Seus dados profissionais, contato de WhatsApp para alertas e preferências de notificação."
              />
            </PermissionGuard>
          }
        />

        {/* Administração — papéis definidos em lib/permissions (backend revalida) */}
        <Route
          path="/admin/hospitals"
          element={
            <PermissionGuard roles={adminRoles()}>
              <HospitalsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="/admin/surgery-types"
          element={
            <PermissionGuard roles={adminRoles()}>
              <SurgeryTypesPage />
            </PermissionGuard>
          }
        />
        <Route
          path="/admin/exports"
          element={
            <PermissionGuard roles={[Role.ADM]}>
              <ExportsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <PermissionGuard roles={adminRoles()}>
              <SettingsPage />
            </PermissionGuard>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
