/**
 * "Gerenciar Usuários" — exclusivo do Administrador. Cuida da IDENTIDADE e do
 * ACESSO dos profissionais (criar conta, editar dados, papel, status, senha).
 *
 * O vínculo com equipes aparece só como RESUMO + link para "Gerenciar Equipes"
 * (sem duplicar o gerenciamento de equipe aqui). Operações sensíveis vão por
 * RPCs SECURITY DEFINER (sem service_role no frontend).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Eye,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Power,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import { onlyDigits } from '@vitalsync/shared';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Button, ConfirmModal, Field, PageContainer, PageHeader, PhoneInput, ProfessionalTag, SelectField, TextInput } from '../../components/ui';
import {
  AdminTable,
  EmptyState,
  ErrorState,
  LoadingState,
  RowActionsMenu,
  RowIconButton,
  StatusPill,
  ToggleSwitch,
} from '../../components/admin';
import { AccessDenied } from '../../components/teams-admin';
import { PasswordInput } from '../../components/profile';
import {
  Drawer,
  EMPTY_USER_FILTERS,
  ModalShell,
  RoleBadge,
  ROLE_META,
  ROLE_OPTIONS,
  UserActiveFilterChips,
  UserAdvancedFilters,
  UserAvatar,
  UserSearchBar,
  UserSummaryQuickFilters,
  activeUserQuickCard,
  applyUserFilters,
  applyUserQuickCard,
  countUserAdvancedFilters,
  type UserFiltersState,
} from '../../components/users-admin';
import { permissionService } from '../../services/permissionService';
import { userService } from '../../services/userService';
import type { EntityStatus, UserOverview, UserRole, UserTeamLink } from '../../services/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<UserOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // filtros (busca geral + cards rápidos + filtros avançados num só estado)
  const [filters, setFilters] = useState<UserFiltersState>(EMPTY_USER_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // modais
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserOverview | null>(null);
  const [details, setDetails] = useState<UserOverview | null>(null);
  const [changingRole, setChangingRole] = useState<UserOverview | null>(null);
  const [toToggle, setToToggle] = useState<UserOverview | null>(null);
  const [toDelete, setToDelete] = useState<UserOverview | null>(null);
  const [toReset, setToReset] = useState<UserOverview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setUsers(null);
    try {
      setUsers(await userService.getUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os usuários. Tente novamente.');
    }
  }, []);

  useEffect(() => {
    if (permissionService.canManageUsers(user)) void load();
  }, [load, user]);

  const summary = useMemo(() => {
    const u = users ?? [];
    return {
      total: u.length,
      admins: u.filter((x) => x.role === 'ADMIN').length,
      surgeons: u.filter((x) => x.role === 'MEDICAL_SURGEON').length,
      associates: u.filter((x) => x.role === 'ASSOCIATED_DOCTOR').length,
      active: u.filter((x) => x.status === 'ACTIVE').length,
      inactive: u.filter((x) => x.status === 'INACTIVE').length,
    };
  }, [users]);

  const activeAdmins = summary.admins ? (users ?? []).filter((x) => x.role === 'ADMIN' && x.status === 'ACTIVE').length : 0;
  const isSoleActiveAdmin = (u: UserOverview) => u.role === 'ADMIN' && u.status === 'ACTIVE' && activeAdmins <= 1;

  const filtered = useMemo(() => applyUserFilters(users ?? [], filters), [users, filters]);
  const activeQuick = useMemo(() => activeUserQuickCard(filters), [filters]);
  const advancedCount = useMemo(() => countUserAdvancedFilters(filters), [filters]);

  async function toggleStatus() {
    if (!toToggle) return;
    const active = toToggle.status === 'ACTIVE';
    setBusy(true);
    try {
      if (active) await userService.inactivateUser(toToggle.id);
      else await userService.activateUser(toToggle.id);
      toast.success(active ? 'Usuário inativado com sucesso.' : 'Usuário ativado com sucesso.');
      setToToggle(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar o status.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await userService.deleteUserIfAllowed(toDelete.id);
      if (res.kind === 'deleted') toast.success('Usuário excluído.');
      else toast.info(res.reason);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível excluir o usuário.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!toReset) return;
    setBusy(true);
    try {
      await userService.sendPasswordReset(toReset.email);
      toast.success('E-mail de redefinição de senha enviado.');
      setToReset(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a redefinição.');
    } finally {
      setBusy(false);
    }
  }

  if (!permissionService.canManageUsers(user)) return <AccessDenied />;

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Gerenciar Usuários"
        subtitle="Cadastre, edite e controle os usuários com acesso ao sistema."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Novo usuário
          </Button>
        }
      />

      {/* Cards de filtro rápido */}
      {users && !error && (
        <UserSummaryQuickFilters
          summary={summary}
          active={activeQuick}
          onSelect={(key) => setFilters((f) => applyUserQuickCard(f, key))}
        />
      )}

      {/* Busca + filtros */}
      <UserSearchBar
        search={filters.search}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        onOpenFilters={() => setFiltersOpen(true)}
        activeFilterCount={advancedCount}
      />

      <UserActiveFilterChips
        filters={filters}
        onRemove={(key) => setFilters((f) => ({ ...f, [key]: EMPTY_USER_FILTERS[key] }))}
        onClear={() => setFilters((f) => ({ ...EMPTY_USER_FILTERS, search: f.search }))}
      />

      {/* Listagem */}
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : users === null ? (
        <LoadingState label="Carregando usuários..." />
      ) : users.length === 0 ? (
        <EmptyState title="Nenhum usuário cadastrado." hint="Clique em “Novo usuário” para começar." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum usuário encontrado para os filtros selecionados." hint="Ajuste a busca ou os filtros para ver outros usuários." />
      ) : (
        <div className="animate-entry [animation-delay:150ms]">
          <AdminTable
            rows={filtered}
            keyFor={(u) => u.id}
            columns={[
              {
                header: 'Usuário',
                render: (u) => (
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar name={u.name} avatarPath={u.avatar_url} />
                    <div className="min-w-0">
                      <p className="font-semibold truncate flex items-center gap-1.5">
                        <span className="truncate">{u.name}</span>
                        {u.professional_tag && <ProfessionalTag tag={u.professional_tag} className="shrink-0" />}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                ),
              },
              { header: 'WhatsApp', render: (u) => <span className="text-muted-foreground whitespace-nowrap">{u.whatsapp ? formatPhone(u.whatsapp) : '—'}</span> },
              { header: 'Papel', render: (u) => <RoleBadge role={u.role} /> },
              { header: 'Status', render: (u) => <StatusPill status={u.status} /> },
              { header: 'Equipes', render: (u) => <span className="font-semibold">{u.team_count}</span> },
              { header: 'Último acesso', render: (u) => <span className="text-muted-foreground text-xs whitespace-nowrap">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('pt-BR') : '—'}</span> },
              { header: 'Cadastro', hideOnMobile: true, render: (u) => <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">{u.created_at.slice(0, 10)}</span> },
            ]}
            actions={(u) => (
              <>
                {/* Só as 2 ações principais ficam na linha; o resto vai p/ "Mais
                    ações" (menu via portal) — evita coluna larga e botões cortados. */}
                <RowIconButton label="Ver detalhes" onClick={() => setDetails(u)}><Eye className="size-4" /></RowIconButton>
                <RowIconButton label="Editar" onClick={() => setEditing(u)}><Pencil className="size-4" /></RowIconButton>
                <RowActionsMenu
                  actions={[
                    { label: 'Alterar papel', icon: <UserCog className="size-4" />, onClick: () => setChangingRole(u) },
                    { label: 'Redefinir senha', icon: <KeyRound className="size-4" />, onClick: () => setToReset(u) },
                    {
                      label: u.status === 'ACTIVE' ? 'Inativar usuário' : 'Ativar usuário',
                      icon: <Power className="size-4" />,
                      onClick: () => setToToggle(u),
                    },
                    { label: 'Excluir usuário', icon: <Trash2 className="size-4" />, onClick: () => setToDelete(u), danger: true },
                  ]}
                />
              </>
            )}
          />
        </div>
      )}

      {/* Filtros avançados (bottom sheet no mobile, modal no desktop) */}
      {filtersOpen && (
        <UserAdvancedFilters
          value={filters}
          onApply={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* Modais */}
      {creating && (
        <UserFormModal
          onClose={() => setCreating(false)}
          onSaved={async () => { setCreating(false); toast.success('Usuário criado com sucesso.'); await load(); }}
        />
      )}
      {editing && (
        <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {changingRole && (
        <ChangeUserRoleModal user={changingRole} onClose={() => setChangingRole(null)} onSaved={async () => { setChangingRole(null); toast.success('Papel alterado com sucesso.'); await load(); }} />
      )}
      {details && <UserDetailsDrawer user={details} onClose={() => setDetails(null)} />}

      {toToggle && (
        <ConfirmModal
          title={toToggle.status === 'ACTIVE' ? `Inativar ${toToggle.name}?` : `Ativar ${toToggle.name}?`}
          message={
            toToggle.status === 'ACTIVE'
              ? isSoleActiveAdmin(toToggle)
                ? 'Este é o único administrador ativo do sistema. Cadastre outro administrador antes de inativá-lo.'
                : 'Tem certeza que deseja inativar este usuário? Ele não poderá acessar o sistema, mas seus registros históricos serão preservados.'
              : 'O usuário voltará a ter acesso ao sistema.'
          }
          confirmLabel={toToggle.status === 'ACTIVE' ? 'Inativar usuário' : 'Ativar usuário'}
          busy={busy}
          onCancel={() => setToToggle(null)}
          onConfirm={toggleStatus}
        />
      )}
      {toDelete && (
        <ConfirmModal
          title={`Excluir ${toDelete.name}?`}
          message="Esta ação não poderá ser desfeita. Se o usuário possuir vínculos ou registros no sistema, por segurança ele será apenas inativado."
          confirmLabel="Excluir usuário"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
      {toReset && (
        <ConfirmModal
          title={`Redefinir senha de ${toReset.name}?`}
          message={`Enviaremos um link de redefinição de senha para ${toReset.email}.`}
          confirmLabel="Enviar redefinição"
          busy={busy}
          onCancel={() => setToReset(null)}
          onConfirm={resetPassword}
        />
      )}
    </PageContainer>
  );
}

function formatPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

/* ============================ Novo usuário ============================ */
function UserFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [role, setRole] = useState<UserRole>('ASSOCIATED_DOCTOR');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<EntityStatus>('ACTIVE');
  const [specialty, setSpecialty] = useState('');
  const [crm, setCrm] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Informe o nome completo.');
    if (!EMAIL_RE.test(email.trim())) return toast.error('Informe um e-mail válido.');
    if (password.length < 6) return toast.error('A senha temporária deve ter pelo menos 6 caracteres.');
    if (password !== confirm) return toast.error('As senhas não coincidem.');

    setBusy(true);
    try {
      await userService.createUser({
        name: name.trim(), email: email.trim(), password, whatsapp: onlyDigits(whatsapp), role, status,
        specialty: specialty.trim() || undefined, crm: crm.trim() || undefined, notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar o usuário.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Novo Usuário" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextInput label="Nome completo" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Dra. Ana Souza" />
          <TextInput label="E-mail (login)" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@email.com" />
          <PhoneInput label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
          <SelectField label="Papel / perfil" required value={role} onChange={(e) => setRole(e.target.value as UserRole)} options={ROLE_OPTIONS} placeholder="Selecione…" />
          <PasswordInput label="Senha temporária" value={password} onChange={setPassword} hint="Mínimo 6 caracteres." required autoComplete="new-password" />
          <PasswordInput label="Confirmar senha" value={confirm} onChange={setConfirm} error={confirm && confirm !== password ? 'As senhas não coincidem.' : undefined} required autoComplete="new-password" />
          <TextInput label="Especialidade" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Opcional" />
          <TextInput label="CRM" value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="Opcional" />
        </div>
        <Field label="Observações"><textarea className="input min-h-16 resize-y" placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Status inicial">
          <ToggleSwitch checked={status === 'ACTIVE'} onChange={(v) => setStatus(v ? 'ACTIVE' : 'INACTIVE')} label={status === 'ACTIVE' ? 'Ativo' : 'Inativo'} />
        </Field>
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Criar usuário</Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ============================ Editar usuário ============================ */
function EditUserModal({ user, onClose, onSaved }: { user: UserOverview; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [whatsapp, setWhatsapp] = useState(user.whatsapp ?? '');
  const [specialty, setSpecialty] = useState(user.specialty ?? '');
  const [crm, setCrm] = useState(user.crm ?? '');
  const [notes, setNotes] = useState(user.notes ?? '');
  const [status, setStatus] = useState<EntityStatus>(user.status);
  const [saving, setSaving] = useState(false);

  // e-mail
  const [newEmail, setNewEmail] = useState('');
  const [confirmingEmail, setConfirmingEmail] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  // senha temporária
  const [tempPwd, setTempPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  async function saveBasics(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Informe um nome válido.');
    setSaving(true);
    try {
      await userService.updateUser(user.id, {
        name: name.trim(), whatsapp: onlyDigits(whatsapp) || null, specialty: specialty.trim() || null,
        crm: crm.trim() || null, notes: notes.trim() || null, status,
      });
      toast.success('Usuário atualizado com sucesso.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function changeEmail() {
    setEmailBusy(true);
    try {
      await userService.updateUserEmail(user.id, newEmail.trim());
      toast.success('E-mail atualizado com sucesso.');
      setNewEmail('');
      setConfirmingEmail(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar o e-mail.');
    } finally {
      setEmailBusy(false);
    }
  }

  async function sendReset() {
    setPwdBusy(true);
    try {
      await userService.sendPasswordReset(user.email);
      toast.success('E-mail de redefinição de senha enviado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a redefinição.');
    } finally {
      setPwdBusy(false);
    }
  }

  async function setTemp() {
    if (tempPwd.length < 6) return toast.error('A senha temporária deve ter pelo menos 6 caracteres.');
    setPwdBusy(true);
    try {
      await userService.setTemporaryPassword(user.id, tempPwd);
      toast.success('Senha temporária definida.');
      setTempPwd('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível definir a senha.');
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <ModalShell title={`Editar ${user.name}`} onClose={onClose} wide>
      <form onSubmit={saveBasics} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextInput label="Nome completo" required value={name} onChange={(e) => setName(e.target.value)} />
          <PhoneInput label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
          <TextInput label="Especialidade" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Opcional" />
          <TextInput label="CRM" value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="Opcional" />
        </div>
        <Field label="Observações"><textarea className="input min-h-16 resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Status">
          <ToggleSwitch checked={status === 'ACTIVE'} onChange={(v) => setStatus(v ? 'ACTIVE' : 'INACTIVE')} label={status === 'ACTIVE' ? 'Ativo' : 'Inativo'} />
        </Field>
        <p className="text-xs text-muted-foreground">O papel é alterado pela ação “Alterar papel”. A senha nunca é exibida.</p>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Salvar alterações</Button>
        </div>
      </form>

      {/* E-mail */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="text-sm font-bold">E-mail de acesso</h3>
        <p className="text-xs text-muted-foreground">Atual: <span className="font-medium text-foreground">{user.email}</span></p>
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 sm:items-end">
          <TextInput label="Novo e-mail" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="novo@email.com" />
          <Button type="button" onClick={() => { if (!EMAIL_RE.test(newEmail.trim())) return toast.error('Informe um e-mail válido.'); setConfirmingEmail(true); }} disabled={!newEmail}>
            <Mail className="size-4" /> Atualizar e-mail
          </Button>
        </div>
      </div>

      {/* Senha */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="text-sm font-bold">Senha</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={sendReset} loading={pwdBusy}><Mail className="size-4" /> Enviar redefinição de senha</Button>
        </div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 sm:items-end">
          <PasswordInput label="Definir senha temporária (opcional)" value={tempPwd} onChange={setTempPwd} hint="Mínimo 6 caracteres." autoComplete="new-password" />
          <Button type="button" variant="ghost" onClick={setTemp} loading={pwdBusy} disabled={!tempPwd}>Definir senha</Button>
        </div>
      </div>

      {confirmingEmail && (
        <ConfirmModal
          title="Alterar e-mail de acesso?"
          message={`O login deste usuário passará a ser ${newEmail.trim().toLowerCase()}.`}
          confirmLabel="Confirmar alteração"
          busy={emailBusy}
          onCancel={() => setConfirmingEmail(false)}
          onConfirm={changeEmail}
        />
      )}
    </ModalShell>
  );
}

/* ============================ Alterar papel ============================ */
function ChangeUserRoleModal({ user, onClose, onSaved }: { user: UserOverview; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [newRole, setNewRole] = useState<UserRole>(user.role);
  const [links, setLinks] = useState<UserTeamLink[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    userService.getUserTeamLinks(user.id).then(setLinks).catch(() => setLinks([]));
  }, [user.id]);

  const mainSurgeonOf = (links ?? []).filter((l) => l.roleInTeam === 'MAIN_SURGEON');
  const losingSurgeonRole = user.role === 'MEDICAL_SURGEON' && newRole !== 'MEDICAL_SURGEON' && mainSurgeonOf.length > 0;
  const noChange = newRole === user.role;

  async function submit() {
    setBusy(true);
    try {
      await userService.updateUserRole(user.id, newRole);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar o papel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Alterar papel do usuário" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="font-semibold">{user.name}</p>
          <p className="text-xs text-muted-foreground">Papel atual: {ROLE_META[user.role].label}</p>
        </div>
        <SelectField label="Novo papel" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} options={ROLE_OPTIONS} placeholder="Selecione…" />

        {losingSurgeonRole && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs font-medium p-3">
            Este usuário é cirurgião principal de {mainSurgeonOf.length} equipe(s). Altere o responsável dessas equipes em
            “Gerenciar Equipes” antes de remover este papel.
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={noChange || losingSurgeonRole}>Alterar papel</Button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ============================ Detalhes (drawer) ============================ */
function UserDetailsDrawer({ user, onClose }: { user: UserOverview; onClose: () => void }) {
  const [links, setLinks] = useState<UserTeamLink[] | null>(null);

  useEffect(() => {
    userService.getUserTeamLinks(user.id).then(setLinks).catch(() => setLinks([]));
  }, [user.id]);

  return (
    <Drawer title="Detalhes do usuário" onClose={onClose}>
      {/* Dados */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <UserAvatar name={user.name} avatarPath={user.avatar_url} size={14} />
          <div className="min-w-0">
            <p className="font-bold truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Info label="WhatsApp" value={user.whatsapp ? formatPhone(user.whatsapp) : '—'} />
          <Info label="Papel" value={ROLE_META[user.role].label} />
          <Info label="Status" value={user.status === 'ACTIVE' ? 'Ativo' : 'Inativo'} />
          <Info label="Equipes" value={String(user.team_count)} />
          <Info label="Cadastro" value={user.created_at.slice(0, 10)} />
          <Info label="Último acesso" value={user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : '—'} />
        </dl>
        {(user.specialty || user.crm) && (
          <p className="text-xs text-muted-foreground">
            {user.specialty && <>Especialidade: <span className="text-foreground font-medium">{user.specialty}</span>. </>}
            {user.crm && <>CRM: <span className="text-foreground font-medium">{user.crm}</span>.</>}
          </p>
        )}
      </section>

      {/* Vínculos */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold flex items-center gap-1.5"><Users className="size-4 text-primary" /> Equipes vinculadas</h3>
        {links === null ? (
          <p className="text-sm text-muted-foreground animate-pulse">Carregando vínculos…</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este usuário não está vinculado a nenhuma equipe.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.teamId} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Equipe nº {String(l.teamNumber).padStart(2, '0')}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {l.roleInTeam === 'MAIN_SURGEON' ? 'Cirurgião Principal' : 'Médico Associado'} · {l.patientCount} paciente(s)
                  </p>
                </div>
                <Link to={`/admin/teams/${l.teamId}`} className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                  Abrir equipe
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">O gerenciamento de equipes é feito na aba “Gerenciar Equipes”.</p>
      </section>

      {/* Atividades */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold flex items-center gap-1.5"><Activity className="size-4 text-primary" /> Atividades</h3>
        <p className="text-sm text-muted-foreground">
          As ações administrativas e os atendimentos deste usuário ficam registrados em
          {' '}<Link to="/admin/settings" className="text-primary font-semibold hover:underline">Configurações → Auditoria</Link>.
        </p>
      </section>
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="font-semibold mt-0.5 truncate">{value}</dd>
    </div>
  );
}
