import { NavLink, Outlet } from 'react-router-dom';
import { Role, useAuth } from '../auth/AuthContext';
import { Button } from './ui';

const ROLE_LABEL: Record<string, string> = {
  ADM: 'Administrador',
  SURGEON: 'Cirurgião responsável',
  ASSOCIATE: 'Médico associado',
};

/** Layout padrão do painel (reutilizado por todas as telas internas). */
export function Layout() {
  const { user, logout, hasRole } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          VitalSync <small>· pós-operatório</small>
        </div>
        <nav className="nav" aria-label="Navegação principal">
          <NavLink to="/monitoring">Monitoramento</NavLink>
          <NavLink to="/patients/new">Cadastrar paciente</NavLink>
          {hasRole(Role.ADM, Role.SURGEON) && <NavLink to="/teams">Equipes</NavLink>}
        </nav>
        <span className="spacer" />
        <div style={{ textAlign: 'right', fontSize: '.82rem', lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700 }}>{user?.name}</div>
          <div style={{ opacity: 0.85 }}>{ROLE_LABEL[user?.role ?? ''] ?? ''}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>
          Sair
        </Button>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
