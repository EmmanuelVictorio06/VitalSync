import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Heart, LogOut, Plus, Stethoscope, UserPlus, Users } from 'lucide-react';
import { Role, useAuth } from '../auth/AuthContext';
import { cn } from './ui';

const ROLE_LABEL: Record<string, string> = {
  ADM: 'Administrador',
  SURGEON: 'Cirurgião responsável',
  ASSOCIATE: 'Médico associado',
};

const PAGE_TITLES: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (p) => p.startsWith('/monitoring'), title: 'Pacientes em Monitoramento' },
  { match: (p) => p === '/patients/new', title: 'Cadastro de Pacientes' },
  { match: (p) => p.startsWith('/patients/'), title: 'Acompanhamento Individual' },
  { match: (p) => p.startsWith('/teams'), title: 'Equipes Médicas' },
];

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/** Layout padrão do painel (reutilizado por todas as telas internas). */
export function Layout() {
  const { user, logout, hasRole } = useAuth();
  const { pathname } = useLocation();
  const title = PAGE_TITLES.find((t) => t.match(pathname))?.title ?? 'VitalSync';

  const navItems = [
    { to: '/monitoring', label: 'Pacientes em Monitoramento', short: 'Pacientes', icon: Activity, show: true },
    { to: '/patients/new', label: 'Cadastro de Pacientes', short: 'Cadastrar', icon: UserPlus, show: true },
    { to: '/teams', label: 'Gerenciar Equipes', short: 'Equipes', icon: Users, show: hasRole(Role.ADM, Role.SURGEON) },
  ].filter((i) => i.show);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card sticky top-0 h-screen">
        <div className="p-6 flex items-center gap-3">
          <div className="size-9 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
            <Heart className="size-5" fill="currentColor" />
          </div>
          <div className="leading-tight">
            <span className="font-extrabold tracking-tight text-lg block">
              VITAL<span className="font-normal text-muted-foreground">SYNC</span>
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Post-Op Care</span>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto" aria-label="Navegação principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 p-2 bg-muted/60 rounded-lg">
            <div className="size-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm">
              {initials(user?.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{user?.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{ROLE_LABEL[user?.role ?? ''] ?? ''}</p>
            </div>
            <Stethoscope className="size-4 text-muted-foreground" />
          </div>
          <button
            onClick={logout}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="size-3.5" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Header */}
        <header className="h-16 border-b border-border bg-card/90 backdrop-blur px-4 md:px-8 flex items-center gap-3 sticky top-0 z-20">
          <div className="lg:hidden size-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shrink-0">
            <Heart className="size-4" fill="currentColor" />
          </div>
          <h1 className="text-base md:text-lg font-semibold tracking-tight truncate flex-1 min-w-0">{title}</h1>
          <Link
            to="/patients/new"
            className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Novo Paciente</span>
          </Link>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border">
        <ul className={cn('grid', navItems.length === 3 ? 'grid-cols-4' : 'grid-cols-3')}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <Icon className="size-5" />
                  {item.short}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button
              onClick={logout}
              className="w-full flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold text-muted-foreground"
            >
              <LogOut className="size-5" />
              Sair
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
