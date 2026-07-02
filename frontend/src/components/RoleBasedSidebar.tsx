/**
 * Definição dos menus por PERFIL (renderização condicional da navegação).
 *
 * Cada perfil enxerga apenas o que pertence à sua função:
 *   - Administrador: gestão completa + seção Administração.
 *   - Cirurgião Principal: pacientes/alertas da equipe + "Minha Equipe".
 *   - Médico Associado: pacientes/alertas + "Minhas Equipes" (somente leitura).
 *
 * O backend revalida as permissões a cada requisição (ver PermissionGuard).
 */
import {
  Activity,
  Bell,
  Building2,
  ClipboardList,
  FileDown,
  LayoutDashboard,
  Scissors,
  Send,
  Settings,
  User,
  UserCog,
  UserPlus,
  Users,
  Users2,
} from 'lucide-react';
import { Role, useAuth } from '../auth/AuthContext';
import { useAlertCount } from './AlertCount';
import { canAccessAdmin } from '../lib/permissions';

type IconType = React.ComponentType<{ className?: string }>;

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: IconType;
  badge?: number;
}

/** Menus principais + seção Administração, conforme o perfil do usuário. */
export function useRoleMenus(): { main: NavItem[]; admin: NavItem[] } {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(Role.ADM);
  // Contagem REAL de alertas não atendidos (Supabase, escopo por RLS).
  const { count: unattended } = useAlertCount();

  // Seção Administração: ADM sempre; cirurgião apenas se autorizado (ver
  // lib/permissions). Exportações gerais continuam exclusivas do ADM.
  const admin: NavItem[] = canAccessAdmin(user?.role)
    ? [
        { to: '/admin/hospitals', label: 'Hospitais', short: 'Hospitais', icon: Building2 },
        { to: '/admin/surgery-types', label: 'Tipos de Cirurgia', short: 'Cirurgias', icon: Scissors },
        ...(isAdmin
          ? [{ to: '/admin/exports', label: 'Exportações', short: 'Exportar', icon: FileDown } satisfies NavItem]
          : []),
        { to: '/admin/settings', label: 'Configurações', short: 'Config.', icon: Settings },
      ]
    : [];

  // Administrador: gestão de todo o sistema.
  if (isAdmin) {
    return {
      main: [
        { to: '/dashboard', label: 'Dashboard', short: 'Início', icon: LayoutDashboard },
        { to: '/admin/users', label: 'Gerenciar Usuários', short: 'Usuários', icon: UserCog },
        { to: '/invites', label: 'Convidar Profissional', short: 'Convites', icon: Send },
        { to: '/teams', label: 'Gerenciar Equipes', short: 'Equipes', icon: Users },
        { to: '/patients/new', label: 'Cadastro de Pacientes', short: 'Cadastrar', icon: UserPlus },
        { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity },
        { to: '/alerts', label: 'Alertas', short: 'Alertas', icon: Bell, badge: unattended },
        { to: '/profile', label: 'Meu Perfil', short: 'Perfil', icon: User },
      ],
      admin,
    };
  }

  // Cirurgião Principal: foco na própria equipe. Cadastro de pacientes é do
  // Gerente de Equipe/Admin (a rota /patients/new também não o aceita).
  if (hasRole(Role.SURGEON)) {
    return {
      main: [
        { to: '/dashboard', label: 'Dashboard', short: 'Início', icon: LayoutDashboard },
        { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity },
        { to: '/alerts', label: 'Alertas', short: 'Alertas', icon: Bell, badge: unattended },
        { to: '/my-team', label: 'Minhas Equipes', short: 'Equipes', icon: Users },
        { to: '/my-care', label: 'Meus Atendimentos', short: 'Atendim.', icon: ClipboardList },
        { to: '/profile', label: 'Meu Perfil', short: 'Perfil', icon: User },
      ],
      admin, // vazio, salvo autorização específica
    };
  }

  // Gerente de Equipe: gestão administrativa das equipes dos cirurgiões vinculados.
  if (hasRole(Role.MANAGER)) {
    return {
      main: [
        { to: '/dashboard', label: 'Dashboard', short: 'Início', icon: LayoutDashboard },
        { to: '/patients/new', label: 'Cadastro de Pacientes', short: 'Cadastrar', icon: UserPlus },
        { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity },
        { to: '/alerts', label: 'Alertas', short: 'Alertas', icon: Bell, badge: unattended },
        { to: '/manager-teams', label: 'Equipes Vinculadas', short: 'Equipes', icon: Users },
        { to: '/profile', label: 'Meu Perfil', short: 'Perfil', icon: User },
      ],
      admin: [],
    };
  }

  // Suporte: perfil operacional (não clínico) — pacientes e perfil.
  if (hasRole(Role.SUPPORT)) {
    return {
      main: [
        { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity },
        { to: '/invites', label: 'Convidar Profissional', short: 'Convites', icon: Send },
        { to: '/profile', label: 'Meu Perfil', short: 'Perfil', icon: User },
      ],
      admin: [],
    };
  }

  // Médico Associado: somente visualização das equipes em que participa.
  return {
    main: [
      { to: '/dashboard', label: 'Dashboard', short: 'Início', icon: LayoutDashboard },
      { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity },
      { to: '/alerts', label: 'Alertas', short: 'Alertas', icon: Bell, badge: unattended },
      { to: '/my-teams', label: 'Minhas Equipes', short: 'Equipes', icon: Users2 },
      { to: '/my-care', label: 'Meus Atendimentos', short: 'Atendim.', icon: ClipboardList },
      { to: '/profile', label: 'Meu Perfil', short: 'Perfil', icon: User },
    ],
    admin: [],
  };
}
