import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Heart, LogOut, Menu, Plus, Search, Stethoscope, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRoleMenus, type NavItem } from './RoleBasedSidebar';
import { canRegisterPatients } from '../lib/permissions';
import { storageService } from '../services/storageService';
import { initials } from './profile';
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
  { match: (p) => p.startsWith('/admin/users'), title: 'Gerenciar Usuários' },
  { match: (p) => p.startsWith('/admin/teams'), title: 'Gerenciar Equipes' },
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

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
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

function SidebarUserAvatar({ name, avatarPath }: { name?: string; avatarPath?: string | null }) {
  const url = avatarPath ? storageService.getProfileAvatarUrl(avatarPath) : null;
  return (
    <div className="size-9 rounded-full overflow-hidden bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-border">
      {url ? (
        <img src={url} alt={`Avatar de ${name ?? ''}`} className="size-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

/** Conteúdo da navegação (logo + menus + usuário). Reutilizado na sidebar fixa
 *  do desktop e no drawer mobile, evitando duplicação. */
function SidebarContent({
  main,
  admin,
  user,
  onLogout,
  onNavigate,
}: {
  main: NavItem[];
  admin: NavItem[];
  user: ReturnType<typeof useAuth>['user'];
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="p-5 flex items-center gap-3">
        <div className="size-9 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shrink-0">
          <Heart className="size-5" fill="currentColor" />
        </div>
        <div className="leading-tight min-w-0">
          <span className="font-extrabold tracking-tight text-lg block truncate">
            Vital<span className="font-normal text-muted-foreground">Sync</span>
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Post-Op Care</span>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto" aria-label="Navegação principal">
        {main.map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}

        {admin.length > 0 && (
          <>
            <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Administração
            </div>
            {admin.map((item) => (
              <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 p-2 bg-muted/60 rounded-lg">
          <SidebarUserAvatar name={user?.name} avatarPath={user?.avatarUrl} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{user?.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{ROLE_LABEL[user?.role ?? ''] ?? ''}</p>
          </div>
          <Stethoscope className="size-4 text-muted-foreground shrink-0" />
        </div>
        <button
          onClick={onLogout}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-xs font-semibold text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="size-3.5" /> Sair
        </button>
      </div>
    </>
  );
}

/** Layout padrão do painel (reutilizado por todas as telas internas). */
export function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const title = PAGE_TITLES.find((t) => t.match(pathname))?.title ?? 'VitalSync';
  const { main, admin } = useRoleMenus();

  // Fecha o drawer ao trocar de rota e ao apertar Escape; trava o scroll do fundo.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/monitoring${query ? `?search=${encodeURIComponent(query)}` : ''}`);
  }

  // Atalhos da barra inferior (mobile): principais (Dashboard/Pacientes/Alertas).
  const mobileItems = main.filter((i) => ['/dashboard', '/monitoring', '/alerts'].includes(i.to));

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card sticky top-0 h-screen">
        <SidebarContent main={main} admin={admin} user={user} onLogout={logout} />
      </aside>

      {/* Drawer (mobile/tablet) */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu de navegação">
          <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85%] bg-card border-r border-border shadow-xl flex flex-col animate-entry">
            <button
              onClick={() => setMenuOpen(false)}
              className="absolute top-4 right-3 size-9 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center z-10"
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </button>
            <SidebarContent main={main} admin={admin} user={user} onLogout={logout} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Topbar */}
        <header className="h-16 border-b border-border bg-card/90 backdrop-blur px-4 md:px-8 flex items-center gap-2 sm:gap-3 sticky top-0 z-20">
          <button
            onClick={() => setMenuOpen(true)}
            className="lg:hidden size-9 -ml-1 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center shrink-0"
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            <Menu className="size-5" />
          </button>
          <h1 className="text-base md:text-lg font-semibold tracking-tight truncate flex-1 min-w-0">{title}</h1>

          <form
            onSubmit={submitSearch}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-sm w-48 lg:w-64"
          >
            <Search className="size-4 shrink-0" />
            <input
              className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted-foreground"
              placeholder="Buscar paciente..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>

          {canRegisterPatients(user?.role) && (
            <Link
              to="/patients/new"
              className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shrink-0"
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

      {/* Bottom nav (mobile): atalhos + acesso ao menu completo */}
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
              onClick={() => setMenuOpen(true)}
              className="w-full flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold text-muted-foreground"
              aria-label="Abrir menu"
            >
              <Menu className="size-5" />
              Menu
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
