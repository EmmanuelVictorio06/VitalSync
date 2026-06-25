import { Navigate, Route, Routes } from 'react-router-dom';
import { Role } from './auth/AuthContext';
import { AlertCountProvider } from './components/AlertCount';
import { Layout } from './components/Layout';
import { PermissionGuard } from './components/PermissionGuard';
import { adminRoles } from './lib/permissions';
import { AlertsPage } from './pages/AlertsPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { MyProfilePage } from './pages/MyProfilePage';
import { MyTeamPage } from './pages/MyTeamPage';
import { MyTeamsPage } from './pages/MyTeamsPage';
import { MyAttendancesPage } from './pages/MyAttendancesPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { PatientRegisterPage } from './pages/PatientRegisterPage';
import { TeamsPage } from './pages/TeamsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { VitalsRegisterPage } from './pages/VitalsRegisterPage';
import { ExportsPage } from './pages/admin/ExportsPage';
import { HospitalsPage } from './pages/admin/HospitalsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { SurgeryTypesPage } from './pages/admin/SurgeryTypesPage';

export function App() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth" element={<Navigate to="/login" replace />} />
      {/* Tela do paciente — acesso público SOMENTE via link com token (sem login).
          Fica FORA do Layout/PermissionGuard, então nunca exige autenticação nem
          redireciona para /login. Rota clara `/registro-sinais/:token`; o alias
          curto `/r/:token` é mantido para os links já enviados pelo WhatsApp. */}
      <Route path="/registro-sinais/:token" element={<VitalsRegisterPage />} />
      <Route path="/r/:token" element={<VitalsRegisterPage />} />

      {/* Internas (autenticadas) */}
      <Route
        element={
          <PermissionGuard>
            <AlertCountProvider>
              <Layout />
            </AlertCountProvider>
          </PermissionGuard>
        }
      >
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

        {/* Gerenciar Usuários — exclusivo do Administrador */}
        <Route
          path="/admin/users"
          element={
            <PermissionGuard roles={[Role.ADM]}>
              <UsersPage />
            </PermissionGuard>
          }
        />

        {/* Gerenciar Equipes — exclusivo do Administrador (todas as equipes).
            /admin/teams/:teamId abre os detalhes de uma equipe (deep-link). */}
        <Route
          path="/teams"
          element={
            <PermissionGuard roles={[Role.ADM]}>
              <TeamsPage />
            </PermissionGuard>
          }
        />
        <Route
          path="/admin/teams/:teamId"
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
              <MyAttendancesPage />
            </PermissionGuard>
          }
        />
        {/* Meu Perfil — Administrador, Cirurgião Principal e Médico Associado */}
        <Route
          path="/profile"
          element={
            <PermissionGuard roles={[Role.ADM, Role.SURGEON, Role.ASSOCIATE]}>
              <MyProfilePage />
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
