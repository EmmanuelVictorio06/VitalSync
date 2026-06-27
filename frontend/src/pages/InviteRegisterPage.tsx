/**
 * Auto-cadastro do profissional por convite (rota pública /convite/:token).
 * Fora do Layout/login. O profissional define a própria senha; a conta é criada
 * na Edge Function accept-invite.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Stethoscope } from 'lucide-react';
import { formatCpf, validateCpf } from '../lib/cpfUtils';
import {
  professionalInviteService,
  type AcceptInviteInput,
  type InviteInfo,
} from '../services/professionalInviteService';

const ROLE_LABEL: Record<InviteInfo['role'], string> = {
  MAIN_SURGEON: 'Cirurgião Principal',
  ASSOCIATED_DOCTOR: 'Médico Associado',
};

type Form = Omit<AcceptInviteInput, 'token'> & { confirm: string };
const EMPTY: Form = { name: '', email: '', phone: '', cpf: '', crm: '', password: '', confirm: '' };

export function InviteRegisterPage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    professionalInviteService
      .getByToken(token)
      .then((i) => {
        if (!i) setInvalid(true);
        else {
          setInvite(i);
          setForm((f) => ({ ...f, email: i.invited_email ?? '', phone: i.invited_phone ?? '' }));
        }
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (form.name.trim().length < 3) return setError('Informe o nome completo.');
    if (!validateCpf(form.cpf)) return setError('CPF inválido. Verifique os dígitos.');
    if (!form.crm.trim()) return setError('Informe o CRM.');
    if (form.phone.replace(/\D/g, '').length < 10) return setError('Informe um telefone válido com DDD.');
    if (form.password.length < 6) return setError('A senha deve ter ao menos 6 caracteres.');
    if (form.password !== form.confirm) return setError('As senhas não coincidem.');

    setBusy(true);
    try {
      await professionalInviteService.accept({ token: token!, ...stripConfirm(form) });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir o cadastro.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Centered>Abrindo seu convite…</Centered>;
  }
  if (invalid) {
    return (
      <Centered>
        <div className="size-14 rounded-full bg-alert/10 text-alert flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="size-7" />
        </div>
        <h2 className="text-lg font-extrabold tracking-tight">Convite indisponível</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Este convite é inválido, já foi usado ou expirou. Solicite um novo à equipe.
        </p>
      </Centered>
    );
  }
  if (done) {
    return (
      <Centered>
        <div className="size-16 rounded-full bg-stable/10 text-stable flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="size-8" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight">Cadastro concluído!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Sua conta foi criada. Use seu e-mail e senha para entrar.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-block w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90"
        >
          Ir para o login
        </Link>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center p-6">
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 w-full max-w-md animate-entry">
        <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <Stethoscope className="size-7" />
        </div>
        <h2 className="text-lg font-extrabold tracking-tight text-center">Cadastro de profissional</h2>
        <p className="text-sm text-muted-foreground mt-1 text-center">
          Convite para <strong>{ROLE_LABEL[invite!.role]}</strong>
          {invite!.team_number != null && ` · Equipe ${String(invite!.team_number).padStart(2, '0')}`}
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <Input label="Nome completo" value={form.name} onChange={(v) => set('name', v)} />
          <Input label="CPF" value={form.cpf} onChange={(v) => set('cpf', formatCpf(v))} inputMode="numeric" placeholder="000.000.000-00" />
          <Input label="CRM" value={form.crm} onChange={(v) => set('crm', v)} />
          <Input label="E-mail" type="email" value={form.email} onChange={(v) => set('email', v)} />
          <Input label="Telefone (WhatsApp)" value={form.phone} onChange={(v) => set('phone', v)} inputMode="numeric" />
          <Input label="Senha" type="password" value={form.password} onChange={(v) => set('password', v)} />
          <Input label="Confirmar senha" type="password" value={form.confirm} onChange={(v) => set('confirm', v)} />

          {error && <p className="text-sm text-alert font-semibold text-center">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 disabled:opacity-55"
          >
            {busy ? 'Concluindo…' : 'Concluir cadastro'}
          </button>
        </form>
      </div>
    </div>
  );
}

function stripConfirm(form: Form): Omit<AcceptInviteInput, 'token'> {
  const { confirm: _confirm, ...rest } = form;
  return rest;
}

function Input({
  label, value, onChange, type = 'text', inputMode, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: 'numeric' | 'text' | 'email';
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-foreground mb-1 block">{label}</span>
      <input
        value={value}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-muted/60 border border-border rounded-xl px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background grid place-items-center p-6">
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 w-full max-w-sm text-center animate-entry">
        {children}
      </div>
    </div>
  );
}
