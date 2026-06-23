import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Heart, LogOut, Plus, Search, Stethoscope } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRoleMenus, type NavItem } from './RoleBasedSidebar';
import { canRegisterPatients } from '../lib/permissions';
import { cn } from './ui';

const ROLE_LABEL: Record<string, string> = {
  ADM: 'Administrador Geral',
  SURGEON: 'Cirurgião Principal',
  ASSOCIATE: 'Médico Associado',
};

const PAGE_TITLES: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (p) => p.startsWith('/dashboard'), title: 'Painel de Monitoramento' },
  { match: (p) => p.startsWith('/monitoring'), title: 'Pacientes em Monitoramento' },
  { match: (p) => p === '/patients/new', title: 'Cadastro de Pacientes' },
  { match: (p) => p.startsWith('/patients/'), title: 'Acompanhamento Individual' },
  { match: (p) => p.startsWith('/teams'), title: 'Gerenciar Equipes' },
  { match: (p) => p.startsWith('/my-teams'), title: 'Minhas Equipes' },
  { match: (p) => p.startsWith('/my-team'), title: 'Minha Equipe' },
  { match: (p) => p.startsWith('/alerts'), title: 'Alertas' },
  { match: (p) => p.startsWith('/my-care'), title: 'Meus Atendimentos' },
  { match: (p) => p.startsWith('/profile'), title: 'Meu Perfil' },
  { match: (p) => p.startsWith('/admin/hospitals'), title: 'Hospitais' },
  { match: (p) => p.startsWith('/admin/surgery-types'), title: 'Tipos de Cirurgia' },
  { match: (p) => p.startsWith('/admin/exports'), title: 'Exportações' },
  { match: (p) => p.startsWith('/admin/settings'), title: 'Configurações' },
];

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
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
      {item.badge ? (
        <span className="ml-auto bg-alert text-alert-foreground text-[10px] px-1.5 py-0.5 rounded-full pulse-alert font-bold">
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  );
}

/** Layout padrão do painel (reutilizado por todas as telas internas). */
export function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const title = PAGE_TITLES.find((t) => t.match(pathname))?.title ?? 'CuraPath';
  const { main, admin } = useRoleMenus();

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/monitoring${query ? `?search=${encodeURIComponent(query)}` : ''}`);
  }

  // Itens da barra inferior (mobile): principais + Sair.
  const mobileItems = main.filter((i) => ['/dashboard', '/monitoring', '/alerts'].includes(i.to));

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
              CURA<span className="font-normal text-muted-foreground">PATH</span>
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Post-Op Care</span>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto" aria-label="Navegação principal">
          {main.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}

          {admin.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Administração
              </div>
              {admin.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </>
          )}
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
        {/* Topbar */}
        <header className="h-16 border-b border-border bg-card/90 backdrop-blur px-4 md:px-8 flex items-center gap-3 sticky top-0 z-20">
          <div className="lg:hidden size-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shrink-0">
            <Heart className="size-4" fill="currentColor" />
          </div>
          <h1 className="text-base md:text-lg font-semibold tracking-tight truncate flex-1 min-w-0">{title}</h1>

          <form
            onSubmit={submitSearch}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-sm w-64"
          >
            <Search className="size-4" />
            <input
              className="bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
              placeholder="Buscar paciente..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>

          {canRegisterPatients(user?.role) && (
            <Link
              to="/patients/new"
              className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Novo Paciente</span>
            </Link>
          )}
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border">
        <ul className="grid grid-cols-4">
          {mobileItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'relative flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <span className="relative">
                    <Icon className="size-5" />
                    {item.badge ? (
                      <span className="absolute -top-1.5 -right-2 bg-alert text-alert-foreground text-[9px] px-1 py-px rounded-full font-bold">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
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
