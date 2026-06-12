import { Navigate, Route, Routes } from 'react-router-dom';
import { type ReactElement } from 'react';
import { Role, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { TeamsPage } from './pages/TeamsPage';
import { PatientRegisterPage } from './pages/PatientRegisterPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { VitalsRegisterPage } from './pages/VitalsRegisterPage';

function RequireAuth({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen"><Loading label="Carregando VitalSync…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/monitoring" replace />;
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
        <Route index element={<Navigate to="/monitoring" replace />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/patients/new" element={<PatientRegisterPage />} />
        <Route path="/patients/:id" element={<PatientDashboardPage />} />
        <Route
          path="/teams"
          element={
            <RequireAuth roles={[Role.ADM, Role.SURGEON]}>
              <TeamsPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/monitoring" replace />} />
    </Routes>
  );
}
