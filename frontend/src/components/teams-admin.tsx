/**
 * Componentes da tela "Gerenciar Equipes" (Administrador).
 *
 * Peças apresentacionais e de formulário reutilizadas pela página. A lógica de
 * dados fica nos serviços (teamService/profileService); aqui só UI + validação
 * de formulário. Reaproveita os componentes base de ui.tsx e admin.tsx.
 */
import { type ReactNode } from 'react';
import { Mail, Phone, ShieldAlert } from 'lucide-react';
import { formatPhoneBR } from '@vitalsync/shared';
import { PhoneInput, TextInput } from './ui';

/* ---------------- Card de resumo (topo da tela) ---------------- */
export function SummaryCard({
  label,
  value,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'primary' | 'stable' | 'warning' | 'alert' | 'muted';
}) {
  const TONE: Record<string, string> = {
    primary: 'text-primary bg-primary/10',
    stable: 'text-stable bg-stable/10',
    warning: 'text-warning bg-warning/10',
    alert: 'text-alert bg-alert/10',
    muted: 'text-muted-foreground bg-muted',
  };
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex items-center gap-3">
      <span className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${TONE[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold tracking-tight leading-none">{value}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

/* ---------------- Tela de acesso negado ---------------- */
export function AccessDenied() {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto w-full">
      <div className="bg-card border border-alert/30 rounded-xl shadow-sm p-12 text-center">
        <ShieldAlert className="size-10 mx-auto mb-4 text-alert" />
        <h2 className="text-xl font-extrabold tracking-tight">Acesso restrito</h2>
        <p className="text-muted-foreground mt-2">Você não tem permissão para acessar esta página.</p>
      </div>
    </div>
  );
}

/* ---------------- Linha de contato (e-mail / WhatsApp) ---------------- */
export function ContactLine({ email, whatsapp }: { email?: string | null; whatsapp?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {email && (
        <span className="inline-flex items-center gap-1.5 truncate">
          <Mail className="size-3 shrink-0" /> {email}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <Phone className="size-3 shrink-0" /> {whatsapp ? formatPhoneBR(whatsapp) : '—'}
      </span>
    </div>
  );
}

/* ---------------- Sub-formulário: novo médico ---------------- */
export interface NewDoctorDraft {
  name: string;
  email: string;
  password: string;
  confirm: string;
  whatsapp: string;
}

export const EMPTY_DOCTOR: NewDoctorDraft = { name: '', email: '', password: '', confirm: '', whatsapp: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida os campos de um novo médico. Retorna a mensagem de erro ou null. */
export function validateNewDoctor(d: NewDoctorDraft): string | null {
  if (!d.name.trim()) return 'Informe o nome completo do médico.';
  if (!EMAIL_RE.test(d.email.trim())) return 'Informe um e-mail válido.';
  if (d.password.length < 6) return 'A senha deve ter no mínimo 6 caracteres.';
  if (d.confirm !== d.password) return 'As senhas não conferem.';
  return null;
}

export function NewDoctorFields({
  value,
  onChange,
}: {
  value: NewDoctorDraft;
  onChange: (d: NewDoctorDraft) => void;
}) {
  function set<K extends keyof NewDoctorDraft>(k: K, v: NewDoctorDraft[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <div className="sm:col-span-2">
        <TextInput label="Nome completo" required placeholder="Ex. Dra. Ana Souza" value={value.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <TextInput label="E-mail (login)" type="email" required placeholder="medico@email.com" value={value.email} onChange={(e) => set('email', e.target.value)} />
      <PhoneInput label="WhatsApp" value={value.whatsapp} onChange={(v) => set('whatsapp', v)} />
      <TextInput label="Senha temporária" type="password" required placeholder="••••••••" hint="Mínimo 6 caracteres." value={value.password} onChange={(e) => set('password', e.target.value)} />
      <TextInput label="Confirmar senha" type="password" required placeholder="••••••••" value={value.confirm} onChange={(e) => set('confirm', e.target.value)} />
    </div>
  );
}

/* ---------------- Seletor "existente vs. novo" ---------------- */
export function ModeTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex gap-1 bg-muted rounded-lg p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              active ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Helpers de exibição ---------------- */
export function StatusTeamBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${
        active ? 'bg-stable/10 text-stable border-stable/20' : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      <span className={`size-1.5 rounded-full ${active ? 'bg-stable' : 'bg-muted-foreground'}`} aria-hidden />
      {active ? 'Ativa' : 'Inativa'}
    </span>
  );
}

/** Dia de monitoramento aproximado (dias desde a alta hospitalar). */
export function monitoringDayFrom(dischargeDate: string | null): number | null {
  if (!dischargeDate) return null;
  const d = new Date(dischargeDate);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return diff < 0 ? null : diff + 1;
}

