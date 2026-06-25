/**
 * "Meu Perfil" — disponível a Administrador, Cirurgião Principal e Médico
 * Associado (o paciente não tem login). Permite ver/editar dados pessoais,
 * trocar e-mail e senha (via Supabase Auth), foto, preferências de notificação,
 * ver as equipes vinculadas e solicitar a desativação da conta.
 *
 * Segurança: o usuário NUNCA altera a própria role/status (protegido por RLS +
 * trigger no banco); senha só no Auth; sem service_role no frontend.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BellRing,
  KeyRound,
  LogOut,
  Mail,
  MonitorSmartphone,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, ConfirmModal, Field, PageContainer, PageHeader, PhoneInput, TextInput } from '../components/ui';
import { ErrorState, LoadingState, SettingsSection, ToggleSwitch } from '../components/admin';
import { AccessDenied } from '../components/teams-admin';
import {
  AvatarUpload,
  PasswordInput,
  PasswordStrengthMeter,
  ProfileSummaryCard,
  ROLE_LABEL_PT,
  passwordScore,
} from '../components/profile';
import { authService } from '../services/authService';
import { permissionService } from '../services/permissionService';
import { profileService } from '../services/profileService';
import { storageService } from '../services/storageService';
import type { TeamSummary } from '../services/teamViewService';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type Profile } from '../services/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function MyProfilePage() {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setProfile(null);
    try {
      const [p, u] = await Promise.all([profileService.getMyProfile(), authService.getCurrentUser()]);
      setProfile(p);
      setAuthUser(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar seus dados. Tente novamente.');
    }
  }, []);

  useEffect(() => {
    if (permissionService.canAccessMyProfile(user)) void load();
  }, [load, user]);

  if (!permissionService.canAccessMyProfile(user)) return <AccessDenied />;

  const avatarUrl = profile?.avatar_url ? storageService.getProfileAvatarUrl(profile.avatar_url) : null;
  const roleLabel = ROLE_LABEL_PT[user?.role ?? ''] ?? 'Usuário';

  return (
    <PageContainer>
      <PageHeader
        title="Meu Perfil"
        subtitle="Gerencie suas informações pessoais, dados de acesso e preferências de conta."
      />

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : profile === null ? (
        <LoadingState label="Carregando seu perfil..." />
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-6 items-start">
          {/* Coluna esquerda: resumo (fixo no desktop) */}
          <div className="lg:sticky lg:top-20 space-y-6">
            <ProfileSummaryCard
              name={profile.name}
              email={profile.email}
              roleLabel={roleLabel}
              status={profile.status}
              avatarUrl={avatarUrl}
              createdAt={authUser?.created_at ?? profile.created_at}
              lastSignInAt={authUser?.last_sign_in_at}
            />
          </div>

          {/* Coluna direita: seções */}
          <div className="space-y-6 min-w-0">
            <PersonalDataCard profile={profile} avatarUrl={avatarUrl} onChanged={load} />
            <AccessDataCard profile={profile} onChanged={load} />
            <ChangePasswordCard />
            <NotificationsCard profile={profile} onChanged={load} />
            {permissionService.canSeeOwnTeams(user) && <MyTeamsProfileSection />}
            <SecurityCard authUser={authUser} profile={profile} />
            <AccountActionsCard onLogout={logout} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

/* ============================ Dados pessoais ============================ */
function PersonalDataCard({ profile, avatarUrl, onChanged }: { profile: Profile; avatarUrl: string | null; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(profile.name);
  const [whatsapp, setWhatsapp] = useState(profile.whatsapp ?? '');
  const [specialty, setSpecialty] = useState(profile.specialty ?? '');
  const [crm, setCrm] = useState(profile.crm ?? '');
  const [notes, setNotes] = useState(profile.notes ?? '');
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Informe um nome válido.');
      return;
    }
    const digits = onlyDigits(whatsapp);
    if (digits && (digits.length < 10 || digits.length > 11)) {
      toast.error('Telefone inválido.');
      return;
    }
    setSaving(true);
    try {
      await profileService.updateMyProfile({
        name: name.trim(),
        whatsapp: digits || null,
        specialty: specialty.trim() || null,
        crm: crm.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success('Dados atualizados com sucesso.');
      await onChanged();
    } catch {
      toast.error('Não foi possível atualizar seus dados. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    try {
      await profileService.updateAvatar(file);
      toast.success('Foto de perfil atualizada.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a foto.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      await profileService.removeAvatar();
      toast.success('Foto removida.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível remover a foto.');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <SettingsSection title="Dados pessoais" description="Mantenha seu nome e contato atualizados — o WhatsApp é usado para os alertas da equipe.">
      <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-start">
        <AvatarUpload name={profile.name} currentUrl={avatarUrl} onUpload={uploadAvatar} onRemove={removeAvatar} busy={avatarBusy} onError={toast.error} />
        <form onSubmit={save} className="space-y-4 min-w-0">
          <TextInput label="Nome completo" required value={name} error={nameError} onChange={(e) => { setName(e.target.value); setNameError(''); }} />
          <div className="grid sm:grid-cols-2 gap-4">
            <PhoneInput label="WhatsApp / Telefone" value={whatsapp} onChange={setWhatsapp} />
            <TextInput label="Cargo ou especialidade" placeholder="Ex. Cirurgia geral" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextInput label="CRM" placeholder="Ex. CRM/PR 12345" value={crm} onChange={(e) => setCrm(e.target.value)} />
          </div>
          <Field label="Observações profissionais">
            <textarea className="input min-h-20 resize-y" placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>Salvar alterações</Button>
          </div>
        </form>
      </div>
    </SettingsSection>
  );
}

/* ============================ Dados de acesso ============================ */
function AccessDataCard({ profile, onChanged }: { profile: Profile; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate(): string | null {
    if (!EMAIL_RE.test(newEmail.trim())) return 'Informe um e-mail válido.';
    if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) return 'Os e-mails não coincidem.';
    if (newEmail.trim().toLowerCase() === profile.email.toLowerCase()) return 'O novo e-mail é igual ao atual.';
    return null;
  }

  function requestChange(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) return toast.error(err);
    setConfirming(true);
  }

  async function doChange() {
    setBusy(true);
    try {
      const { pending } = await authService.updateEmail(newEmail.trim());
      if (pending) {
        toast.info('Solicitação de alteração de e-mail enviada. Verifique seu novo e-mail para confirmar a alteração.');
      } else {
        toast.success('E-mail atualizado com sucesso.');
      }
      setNewEmail('');
      setConfirmEmail('');
      setConfirming(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar o e-mail. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Dados de acesso" description="Seu e-mail é usado para entrar no sistema. A alteração é confirmada pelo Supabase Auth.">
      <dl className="grid sm:grid-cols-3 gap-3 text-sm">
        <InfoItem label="E-mail atual" value={profile.email} />
        <InfoItem label="Perfil de acesso" value={ROLE_LABEL_PT[roleKey(profile.role)] ?? profile.role} />
        <InfoItem label="Status da conta" value={profile.status === 'ACTIVE' ? 'Ativa' : 'Inativa'} />
      </dl>

      <form onSubmit={requestChange} className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
        <TextInput label="Novo e-mail" type="email" placeholder="novo@email.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <TextInput label="Confirmar novo e-mail" type="email" placeholder="novo@email.com" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={!newEmail || !confirmEmail}>
            <Mail className="size-4" /> Atualizar e-mail
          </Button>
        </div>
      </form>

      {confirming && (
        <ConfirmModal
          title="Alterar e-mail de acesso?"
          message={`O e-mail de login passará a ser ${newEmail.trim().toLowerCase()}. Dependendo da configuração, você precisará confirmar pelo novo e-mail antes da troca ter efeito.`}
          confirmLabel="Confirmar alteração"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={doChange}
        />
      )}
    </SettingsSection>
  );
}

/* ============================ Alterar senha ============================ */
function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 6) return toast.error('A nova senha deve ter pelo menos 6 caracteres.');
    if (next !== confirm) return toast.error('As senhas não coincidem.');
    if (!current) return toast.error('Informe sua senha atual.');
    setBusy(true);
    try {
      await authService.updatePassword(current, next);
      toast.success('Senha alterada com sucesso.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar a senha. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Alterar senha" description="Por segurança, confirme sua senha atual antes de definir uma nova. A senha é gerida apenas pelo Supabase Auth.">
      <form onSubmit={submit} className="space-y-4 max-w-md">
        <PasswordInput label="Senha atual" value={current} onChange={setCurrent} required autoComplete="current-password" />
        <div>
          <PasswordInput label="Nova senha" value={next} onChange={setNext} hint="Mínimo 6 caracteres." required autoComplete="new-password" />
          <PasswordStrengthMeter value={next} />
        </div>
        <PasswordInput
          label="Confirmar nova senha"
          value={confirm}
          onChange={setConfirm}
          error={confirm && confirm !== next ? 'As senhas não coincidem.' : undefined}
          required
          autoComplete="new-password"
        />
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!current || !next || passwordScore(next) === 0}>
            <KeyRound className="size-4" /> Alterar senha
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

/* ============================ Notificações ============================ */
function NotificationsCard({ profile, onChanged }: { profile: Profile; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const initial = useMemo<NotificationPrefs>(() => ({ ...DEFAULT_NOTIFICATION_PREFS, ...(profile.notification_prefs ?? {}) }), [profile.notification_prefs]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [busy, setBusy] = useState(false);
  const hasPhone = !!onlyDigits(profile.whatsapp ?? '');

  function set<K extends keyof NotificationPrefs>(k: K, v: boolean) {
    if (k === 'whatsapp_alerts_enabled' && v && !hasPhone) {
      toast.error('Cadastre um número de WhatsApp antes de ativar esta opção.');
      return;
    }
    setPrefs((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setBusy(true);
    try {
      await profileService.updateNotificationPreferences(prefs);
      toast.success('Preferências de notificação atualizadas com sucesso.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar as preferências.');
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<{ key: keyof NotificationPrefs; label: string; hint?: string }> = [
    { key: 'whatsapp_alerts_enabled', label: 'Receber alertas pelo WhatsApp', hint: hasPhone ? undefined : 'Cadastre um WhatsApp para ativar.' },
    { key: 'email_alerts_enabled', label: 'Receber alertas por e-mail' },
    { key: 'yellow_alerts_enabled', label: 'Pacientes em atenção (amarelo)' },
    { key: 'red_alerts_enabled', label: 'Pacientes em alerta (vermelho)' },
    { key: 'pending_attendance_enabled', label: 'Lembretes de atendimento pendente' },
  ];

  return (
    <SettingsSection title="Preferências de notificação" description="Escolha como deseja ser avisado sobre os pacientes da sua equipe.">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.label}</p>
              {r.hint && <p className="text-xs text-warning mt-0.5">{r.hint}</p>}
            </div>
            <ToggleSwitch checked={prefs[r.key]} onChange={(v) => set(r.key, v)} />
          </li>
        ))}
      </ul>
      <div className="flex justify-end pt-2">
        <Button onClick={save} loading={busy}>Salvar preferências</Button>
      </div>
    </SettingsSection>
  );
}

/* ============================ Minhas equipes ============================ */
function MyTeamsProfileSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    profileService
      .getMyTeams()
      .then((t) => active && setTeams(t))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Erro ao carregar equipes.'));
    return () => {
      active = false;
    };
  }, []);

  const isSurgeon = user?.role === 'SURGEON';

  return (
    <SettingsSection title="Minhas equipes" description="Equipes em que você atua. A gestão de equipes é feita pelo administrador.">
      {error ? (
        <p className="text-sm text-alert">{error}</p>
      ) : teams === null ? (
        <p className="text-sm text-muted-foreground animate-pulse">Carregando suas equipes…</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não está vinculado a nenhuma equipe.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {teams.map((t) => (
            <article key={t.id} className="border border-border rounded-xl p-4 flex flex-col gap-3 border-l-4 border-l-primary">
              <header>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Equipe nº {String(t.number).padStart(2, '0')}</p>
                <h4 className="font-bold mt-0.5 inline-flex items-center gap-1.5">
                  <Stethoscope className="size-4 text-primary shrink-0" /> {t.surgeonName}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sua função: {t.myRole === 'MAIN_SURGEON' ? 'Cirurgião Principal' : 'Médico Associado'}
                </p>
              </header>
              <ul className="text-xs space-y-1 border-y border-border py-2">
                <li className="flex items-center gap-1.5"><Activity className="size-3.5 text-primary" /> {t.stats.monitoring} em monitoramento</li>
                <li className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-3.5" /> {t.stats.attention} em atenção</li>
                <li className="flex items-center gap-1.5 text-alert"><ShieldAlert className="size-3.5" /> {t.stats.alert} em alerta</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => navigate(`/monitoring?team=${t.number}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90">
                  <Activity className="size-3.5" /> Ver pacientes
                </button>
                <button onClick={() => navigate(`/alerts?team=${t.number}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-semibold hover:bg-muted">
                  <BellRing className="size-3.5" /> Ver alertas
                </button>
                {isSurgeon && t.myRole === 'MAIN_SURGEON' && (
                  <Link to="/my-team" className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 text-primary rounded-md text-xs font-semibold hover:bg-accent">
                    <Users className="size-3.5" /> Minha Equipe
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

/* ============================ Segurança ============================ */
function SecurityCard({ authUser, profile }: { authUser: User | null; profile: Profile }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const emailVerified = !!(authUser?.email_confirmed_at ?? authUser?.confirmed_at);

  async function resetByEmail() {
    if (!profile.email) return;
    setBusy(true);
    try {
      await authService.sendPasswordResetEmail(profile.email);
      toast.success('Enviamos um link de redefinição de senha para o seu e-mail.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar o e-mail.');
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    try {
      await authService.signOutEverywhere();
      // o onAuthStateChange leva ao login automaticamente
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível sair dos dispositivos.');
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Segurança da conta" description="Para proteger sua conta, mantenha seus dados atualizados e não compartilhe sua senha.">
      <dl className="grid sm:grid-cols-2 gap-3 text-sm">
        <InfoItem label="Último login" value={authUser?.last_sign_in_at ? new Date(authUser.last_sign_in_at).toLocaleString('pt-BR') : '—'} />
        <InfoItem label="E-mail verificado" value={emailVerified ? 'Sim' : 'Não'} tone={emailVerified ? 'stable' : 'warning'} />
        <InfoItem label="Conta criada em" value={new Date(authUser?.created_at ?? profile.created_at).toLocaleDateString('pt-BR')} />
        <InfoItem label="Perfil de acesso" value={ROLE_LABEL_PT[roleKey(profile.role)] ?? profile.role} />
      </dl>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button variant="secondary" onClick={resetByEmail} loading={busy}>
          <Mail className="size-4" /> Redefinir senha por e-mail
        </Button>
        <Button variant="ghost" onClick={signOutEverywhere} loading={busy}>
          <MonitorSmartphone className="size-4" /> Sair de todos os dispositivos
        </Button>
      </div>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-stable" /> Você não pode alterar seu próprio perfil de acesso — isso é feito pela administração.
      </p>
    </SettingsSection>
  );
}

/* ============================ Sessão e conta ============================ */
function AccountActionsCard({ onLogout }: { onLogout: () => Promise<void> }) {
  const { user } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [soleAdmin, setSoleAdmin] = useState(false);

  useEffect(() => {
    if (user?.role !== 'ADM') return;
    profileService.countActiveAdmins().then((n) => setSoleAdmin(n <= 1)).catch(() => {});
  }, [user?.role]);

  async function requestDeactivation() {
    setBusy(true);
    try {
      await profileService.requestAccountDeactivation();
      toast.success('Solicitação enviada. Um administrador irá analisá-la.');
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setBusy(false);
    }
  }

  const canDeactivate = permissionService.canRequestAccountDeactivation(user) && !soleAdmin;

  return (
    <SettingsSection title="Sessão e conta" description="Encerre sua sessão ou solicite a desativação da conta. Os dados clínicos são sempre preservados.">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => void onLogout()}>
          <LogOut className="size-4" /> Sair da conta
        </Button>
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={!canDeactivate}>
          <ShieldAlert className="size-4" /> Solicitar desativação da conta
        </Button>
      </div>
      {soleAdmin && user?.role === 'ADM' && (
        <p className="text-xs text-warning">
          Você é o único administrador ativo. Cadastre outro administrador antes de solicitar a desativação da sua conta.
        </p>
      )}

      {confirming && (
        <ConfirmModal
          title="Solicitar desativação da conta"
          message="Sua conta pode estar vinculada a equipes, pacientes e registros clínicos. Por segurança, a desativação será analisada por um administrador."
          confirmLabel="Solicitar desativação"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={requestDeactivation}
        />
      )}
    </SettingsSection>
  );
}

/* ============================ Auxiliares ============================ */
function InfoItem({ label, value, tone }: { label: string; value: string; tone?: 'stable' | 'warning' }) {
  const cls = tone === 'stable' ? 'text-stable' : tone === 'warning' ? 'text-warning' : 'text-foreground';
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`font-semibold mt-0.5 truncate ${cls}`}>{value}</dd>
    </div>
  );
}

/** Converte UserRole do banco (ADMIN/...) na chave de ROLE_LABEL_PT (ADM/...). */
function roleKey(role: string): string {
  return role === 'ADMIN' ? 'ADM' : role === 'MAIN_SURGEON' ? 'SURGEON' : role === 'ASSOCIATED_DOCTOR' ? 'ASSOCIATE' : role;
}
