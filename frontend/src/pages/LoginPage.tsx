import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, TextInput } from '../components/ui';
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
      toast.success('Bem-vindo(a) ao VitalSync!');
      navigate('/monitoring');
    } catch (err) {
      // Mensagem clara, sem termos técnicos (heurística de Nielsen).
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)' }}>VitalSync</div>
          <p className="subtext" style={{ margin: '4px 0 0' }}>
            Monitoramento domiciliar pós-operatório
          </p>
        </div>
        <form onSubmit={onSubmit}>
          <TextInput
            label="E-mail"
            type="email"
            autoComplete="username"
            placeholder="seu.email@hospital.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextInput
            label="Senha"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" block size="lg" loading={busy}>
            Entrar
          </Button>
        </form>
        <p className="muted" style={{ fontSize: '.78rem', textAlign: 'center', marginTop: 14 }}>
          Acesso restrito a profissionais cadastrados. Pacientes acessam pelo link enviado por WhatsApp.
        </p>
      </div>
    </div>
  );
}
