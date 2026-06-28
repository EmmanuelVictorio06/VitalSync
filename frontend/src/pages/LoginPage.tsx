import { useCallback, useState, type FormEvent, type MouseEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Activity, Lock, Mail, ShieldCheck, Stethoscope } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { homeRouteFor } from '../lib/permissions';
import { BackToHomeButton } from '../components/BackToHomeButton';
import { VitalSyncLogo } from '../components/VitalSyncLogo';
import { useToast } from '../components/Toast';
import { Button, cn } from '../components/ui';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const navigateHome = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      if (leaving) return;

      if (prefersReducedMotion()) {
        navigate('/');
        return;
      }

      setLeaving(true);
      window.setTimeout(() => navigate('/'), 180);
    },
    [leaving, navigate],
  );

  if (user) return <Navigate to={homeRouteFor(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('Bem-vindo(a) ao VitalSync!');
      navigate('/dashboard');
    } catch (err) {
      // Mensagem clara, sem termos técnicos (heurística de Nielsen).
      const msg = err instanceof Error ? err.message : '';
      toast.error(
        /invalid login credentials/i.test(msg)
          ? 'E-mail ou senha incorretos.'
          : msg || 'Não foi possível entrar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'min-h-screen grid bg-background transition-all duration-200 ease-out lg:grid-cols-2',
        leaving ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0',
      )}
    >
      {/* Lado da marca */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2), transparent 50%)',
          }}
        />
        <VitalSyncLogo tone="onPrimary" onNavigate={navigateHome} className="relative" />
        <div className="relative space-y-6 max-w-md">
          <p className="text-xs font-bold uppercase tracking-[0.3em] opacity-80">HealthTech</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-balance leading-tight">
            Monitoramento pós-operatório domiciliar em tempo real.
          </h1>
          <p className="text-base opacity-80 text-pretty">
            Acompanhe sinais vitais, alertas clínicos e a recuperação dos seus pacientes com segurança, em qualquer
            lugar.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {[
              { icon: ShieldCheck, label: 'Seguro' },
              { icon: Activity, label: 'Tempo real' },
              { icon: Stethoscope, label: 'Clínico' },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-xl bg-white/10 backdrop-blur px-3 py-4 flex flex-col items-center gap-2 text-xs font-semibold"
              >
                <f.icon className="size-5" />
                {f.label}
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs opacity-70">© 2026 VitalSync. Todos os direitos reservados.</p>
      </aside>

      {/* Formulário de login */}
      <main className="relative flex min-h-screen flex-col justify-center p-6 pt-24 md:p-12 md:pt-24">
        <BackToHomeButton
          onNavigate={navigateHome}
          className="absolute left-6 top-6 md:left-10 md:top-10 lg:left-12 lg:top-12"
        />

        <div className="w-full max-w-md mx-auto animate-entry">
          <VitalSyncLogo size="sm" onNavigate={navigateHome} className="mb-8 lg:hidden" />

          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Entrar</h2>
          <p className="text-sm text-muted-foreground mt-1">Acesse o painel para acompanhar seus pacientes.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground" htmlFor="login-email">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@hospital.com"
                  required
                  className="w-full bg-card border border-border rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                htmlFor="login-password"
              >
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-card border border-border rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <Button type="submit" block loading={busy}>
              Entrar
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Acesso restrito a profissionais cadastrados. Pacientes acessam pelo link enviado por WhatsApp.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
