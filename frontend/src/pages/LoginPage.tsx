import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Activity, Heart, Lock, Mail, ShieldCheck, Stethoscope } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/monitoring" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('Bem-vindo(a) ao CuraPath!');
      navigate('/monitoring');
    } catch (err) {
      // Mensagem clara, sem termos técnicos (heurística de Nielsen).
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Lado da marca */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2), transparent 50%)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="size-10 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center">
            <Heart className="size-5" fill="currentColor" />
          </div>
          <span className="text-xl font-extrabold tracking-tight">
            CURA<span className="font-normal opacity-70">PATH</span>
          </span>
        </div>
        <div className="relative space-y-6 max-w-md">
          <p className="text-xs font-bold uppercase tracking-[0.3em] opacity-80">HealthTech</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-balance leading-tight">
            Monitoramento pós-operatório domiciliar em tempo real.
          </h1>
          <p className="text-base opacity-80 text-pretty">
            Acompanhe sinais vitais, alertas clínicos e a recuperação dos seus pacientes com segurança, em
            qualquer lugar.
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
        <p className="relative text-xs opacity-70">© 2026 CuraPath. Todos os direitos reservados.</p>
      </aside>

      {/* Formulário de login */}
      <main className="flex flex-col justify-center p-6 md:p-12">
        <div className="w-full max-w-md mx-auto animate-entry">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="size-9 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
              <Heart className="size-5" fill="currentColor" />
            </div>
            <span className="text-lg font-extrabold tracking-tight">
              CURA<span className="font-normal text-muted-foreground">PATH</span>
            </span>
          </div>

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
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground" htmlFor="login-password">
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

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-semibold text-sm hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-55 disabled:cursor-not-allowed"
            >
              {busy ? 'Aguarde…' : 'Entrar'}
            </button>

            <p className="text-xs text-muted-foreground text-center">
              Acesso restrito a profissionais cadastrados. Pacientes acessam pelo link enviado por WhatsApp.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
