/**
 * Proteção de rota por autenticação e perfil.
 *
 * Centraliza a renderização condicional: redireciona para o login quem não
 * está autenticado e para o dashboard quem não tem o perfil exigido. As mesmas
 * regras DEVEM ser revalidadas no backend — o guard é apenas a camada de UI.
 */
import { Navigate } from 'react-router-dom';
import { type ReactElement } from 'react';
import { Role, useAuth } from '../auth/AuthContext';
import { Loading } from './ui';

export function PermissionGuard({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loading label="Carregando VitalSync…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}
