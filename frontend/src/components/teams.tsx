/**
 * Componentes reutilizáveis da área "Minhas Equipes" (perfil profissional).
 *
 * Somente LEITURA: o médico associado visualiza equipes, pacientes e alertas,
 * sem ações administrativas (editar/excluir equipe, gerir membros).
 */
import { useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  BellRing,
  Calendar,
  Eye,
  Mail,
  MessageCircle,
  Pencil,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ClinicalStatus, formatCivilDate, formatPhoneBR } from '@vitalsync/shared';
import { StatusPill } from './admin';
import { StatusBadge, cn, statusBorder } from './ui';
import {
  ROLE_IN_TEAM_LABEL,
  type MyTeam,
  type MyTeamsSummary,
  type PatientStatusFilter,
  type TeamAlert,
  type TeamDoctor,
  type TeamPatient,
} from '../lib/teams-types';

/** Monta o link de conversa do WhatsApp (DDI Brasil + dígitos). */
function whatsappUrl(digits: string | null): string | null {
  if (!digits) return null;
  const clean = digits.replace(/\D/g, '');
  return clean ? `https://wa.me/55${clean}` : null;
}

/* ---------------- AlertBadge ---------------- */
/** Selo de alertas não atendidos. Verde quando não há pendências. */
export function AlertBadge({ count }: { count: number }) {
  const none = count === 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
        none ? 'bg-stable/10 text-stable border-stable/20' : 'bg-alert/10 text-alert border-alert/20',
      )}
    >
      <BellRing className={cn('size-3', !none && 'pulse-alert')} />
      {none ? 'Sem pendências' : `${count} não atendido${count > 1 ? 's' : ''}`}
    </span>
  );
}

/* ---------------- TeamStatusSummary ---------------- */
interface SummaryItem {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'primary' | 'stable' | 'warning' | 'alert';
}

const TONE_CLS: Record<SummaryItem['tone'], string> = {
  primary: 'bg-primary/10 text-primary',
  stable: 'bg-stable/10 text-stable',
  warning: 'bg-warning/10 text-warning',
  alert: 'bg-alert/10 text-alert',
};

/** Cards horizontais de resumo — somam apenas as equipes do médico logado. */
export function TeamStatusSummary({ summary }: { summary: MyTeamsSummary }) {
  const items: SummaryItem[] = [
    { label: 'Equipes vinculadas', value: summary.teams, icon: Users, tone: 'primary' },
    { label: 'Pacientes em monitoramento', value: summary.monitoring, icon: Activity, tone: 'primary' },
    { label: 'Pacientes em atenção', value: summary.attention, icon: AlertTriangle, tone: 'warning' },
    { label: 'Pacientes em alerta', value: summary.alert, icon: ShieldAlert, tone: 'alert' },
    { label: 'Alertas não atendidos', value: summary.unattendedAlerts, icon: BellRing, tone: 'alert' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={it.label} className="bg-card border border-border rounded-xl shadow-sm p-4 flex items-center gap-3">
            <span className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', TONE_CLS[it.tone])}>
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-extrabold leading-none">{it.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{it.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- TeamFilterBar ---------------- */
const STATUS_OPTIONS: Array<{ value: PatientStatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: ClinicalStatus.GREEN, label: 'Estável' },
  { value: ClinicalStatus.YELLOW, label: 'Atenção' },
  { value: ClinicalStatus.RED, label: 'Alerta' },
];

export interface TeamFilters {
  number: string;
  surgeon: string;
  status: PatientStatusFilter;
  onlyUnattended: boolean;
}

export function TeamFilterBar({
  filters,
  onChange,
}: {
  filters: TeamFilters;
  onChange: (patch: Partial<TeamFilters>) => void;
}) {
  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-3 animate-entry [animation-delay:100ms]">
      <input
        value={filters.number}
        inputMode="numeric"
        onChange={(e) => onChange({ number: e.target.value })}
        placeholder="Buscar por nº da equipe…"
        className="input !w-auto lg:w-44"
        aria-label="Buscar por número da equipe"
      />
      <input
        value={filters.surgeon}
        onChange={(e) => onChange({ surgeon: e.target.value })}
        placeholder="Buscar por cirurgião responsável…"
        className="input flex-1"
        aria-label="Buscar por cirurgião responsável"
      />
      <div className="flex gap-1 bg-muted rounded-lg p-1 self-start lg:self-auto">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.value}
            onClick={() => onChange({ status: s.value })}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
              filters.status === s.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none self-start lg:self-auto">
        <input
          type="checkbox"
          className="accent-[#2563eb] size-4"
          checked={filters.onlyUnattended}
          onChange={(e) => onChange({ onlyUnattended: e.target.checked })}
        />
        Só com alertas não atendidos
      </label>
    </div>
  );
}

/* ---------------- Linha de estatística ---------------- */
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'stable' | 'warning' | 'alert' }) {
  const toneCls =
    tone === 'stable' ? 'text-stable' : tone === 'warning' ? 'text-warning' : tone === 'alert' ? 'text-alert' : 'text-foreground';
  return (
    <div className="flex flex-col">
      <span className={cn('text-lg font-extrabold leading-none', toneCls)}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</span>
    </div>
  );
}

/* ---------------- TeamCard (simplificado — somente leitura) ----------------
   Apenas o essencial, para não poluir a tela do Médico Associado. */
export function TeamCard({
  team,
  onViewPatients,
  onViewAlerts,
}: {
  team: MyTeam;
  onViewPatients: () => void;
  onViewAlerts: () => void;
}) {
  const s = team.stats;
  return (
    <article className="bg-card border border-border rounded-xl shadow-sm p-5 flex flex-col gap-4 border-l-4 border-l-primary">
      <header className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Equipe nº {String(team.number).padStart(2, '0')}
        </p>
        <h3 className="font-bold text-lg leading-tight mt-0.5 inline-flex items-center gap-1.5">
          <Stethoscope className="size-4 text-primary shrink-0" />
          {team.surgeonName}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">Você é {ROLE_IN_TEAM_LABEL[team.myRole]}</p>
      </header>

      <ul className="text-sm space-y-1.5 border-y border-border py-3">
        <li className="flex items-center gap-2">
          <Activity className="size-4 text-primary shrink-0" />
          <span>
            <strong className="font-extrabold">{s.monitoring}</strong> pacientes em monitoramento
          </span>
        </li>
        <li className="flex items-center gap-2 text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <strong className="font-extrabold">{s.attention}</strong> em atenção
          </span>
        </li>
        <li className="flex items-center gap-2 text-alert">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            <strong className="font-extrabold">{s.alert}</strong> em alerta
          </span>
        </li>
      </ul>

      <AlertBadge count={s.unattendedAlerts} />

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={onViewPatients}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          <Activity className="size-3.5" /> Ver pacientes
        </button>
        <button
          onClick={onViewAlerts}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors"
        >
          <BellRing className="size-3.5" /> Ver alertas
        </button>
      </div>
    </article>
  );
}

/* ---------------- TeamMemberList (gestão na tela "Minha Equipe") ----------------
   Lista os médicos com status ativo/inativo e ações de edição/remoção quando o
   cirurgião tem permissão. O cirurgião responsável é protegido contra remoção. */
export function TeamMemberList({
  members,
  canManage,
  onEdit,
  onRemove,
}: {
  members: TeamDoctor[];
  canManage: boolean;
  onEdit: (m: TeamDoctor) => void;
  onRemove: (m: TeamDoctor) => void;
}) {
  if (members.length === 0) return <p className="text-sm text-muted-foreground">Nenhum médico associado.</p>;
  return (
    <ul className="space-y-2">
      {members.map((d) => {
        const wa = whatsappUrl(d.whatsapp);
        const isSurgeon = d.roleInTeam === 'MAIN_SURGEON';
        return (
          <li key={d.id} className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                {d.name}
                {isSurgeon && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">
                    Responsável
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground truncate inline-flex items-center gap-1">
                <Mail className="size-3" /> {d.email}
                {d.whatsapp && <span className="ml-2">{formatPhoneBR(d.whatsapp)}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="size-8 rounded-md border border-border text-[#25D366] hover:bg-muted flex items-center justify-center"
                  aria-label={`WhatsApp de ${d.name}`}
                >
                  <MessageCircle className="size-4" />
                </a>
              )}
              {canManage && !isSurgeon && (
                <>
                  <button
                    onClick={() => onEdit(d)}
                    className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center"
                    aria-label={`Editar ${d.name}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => onRemove(d)}
                    className="size-8 rounded-md border border-alert/30 text-alert hover:bg-alert/5 flex items-center justify-center"
                    aria-label={`Remover ${d.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- DoctorList ---------------- */
export function DoctorList({ doctors }: { doctors: TeamDoctor[] }) {
  if (doctors.length === 0) return <p className="text-sm text-muted-foreground">Nenhum médico cadastrado.</p>;
  return (
    <ul className="space-y-2">
      {doctors.map((d) => {
        const wa = whatsappUrl(d.whatsapp);
        return (
          <li key={d.id} className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                {d.name}
                {d.roleInTeam === 'MAIN_SURGEON' && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">
                    Responsável
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground truncate inline-flex items-center gap-1">
                <Mail className="size-3" /> {d.email}
                {d.whatsapp && <span className="ml-2">{formatPhoneBR(d.whatsapp)}</span>}
              </p>
            </div>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 size-8 rounded-md border border-border text-[#25D366] hover:bg-muted flex items-center justify-center"
                aria-label={`Abrir WhatsApp de ${d.name}`}
              >
                <MessageCircle className="size-4" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- TeamPatientList ---------------- */
export function TeamPatientList({
  patients,
  onFollowPatient,
}: {
  patients: TeamPatient[];
  onFollowPatient: (p: TeamPatient) => void;
}) {
  if (patients.length === 0) return <p className="text-sm text-muted-foreground">Nenhum paciente vinculado.</p>;
  return (
    <ul className="space-y-2">
      {patients.map((p) => (
        <li
          key={p.id}
          className={cn('flex items-center justify-between gap-3 bg-card border border-border rounded-lg p-3 border-l-4', statusBorder(p.status))}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground truncate">{p.surgeryType}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" /> Alta {formatCivilDate(p.dischargeDate)}
              </span>
              <span className="font-semibold">D+{p.monitoringDay}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={p.status} />
            <button
              onClick={() => onFollowPatient(p)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90"
            >
              <Eye className="size-3.5" /> Acompanhar
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Alertas recentes (lista compacta) ---------------- */
function RecentAlerts({ alerts }: { alerts: TeamAlert[] }) {
  if (alerts.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum alerta pendente nas suas equipes.</p>;
  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={cn(
            'bg-card border border-border rounded-lg p-3 flex items-center gap-3 border-l-4',
            a.severity === 'RED' ? 'border-l-alert' : 'border-l-warning',
          )}
        >
          <span className={cn('size-2.5 rounded-full shrink-0', a.severity === 'RED' ? 'bg-alert pulse-alert' : 'bg-warning')} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{a.patientName}</p>
            <p className="text-xs text-muted-foreground truncate">{a.description}</p>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono hidden sm:block">{a.datetime}</span>
          {a.attended ? (
            <span className="text-[10px] font-bold uppercase text-stable">Atendido</span>
          ) : (
            <span className="text-[10px] font-bold uppercase text-alert">Pendente</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- TeamDetailsModal ---------------- */
export function TeamDetailsModal({
  team,
  onClose,
  onFollowPatient,
}: {
  team: MyTeam;
  onClose: () => void;
  onFollowPatient: (p: TeamPatient) => void;
}) {
  // Fecha com ESC e trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = team.stats;
  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalhes da equipe ${team.number}`}
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-2xl my-8 animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <header className="flex items-start justify-between gap-3 p-6 border-b border-border sticky top-0 bg-card rounded-t-xl">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Detalhes da Equipe</p>
            <h2 className="text-xl font-extrabold tracking-tight mt-0.5">Equipe nº {String(team.number).padStart(2, '0')}</h2>
            <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5 mt-1">
              <Stethoscope className="size-4 text-primary" /> {team.surgeonName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={team.status} />
            <button
              onClick={onClose}
              className="size-8 rounded-md border border-border hover:bg-muted flex items-center justify-center text-muted-foreground"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="p-6 space-y-6">
          {/* Resumo clínico */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Resumo clínico</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 bg-muted/40 rounded-lg p-4">
              <Stat label="Pacientes" value={s.monitoring} />
              <Stat label="Estáveis" value={s.stable} tone="stable" />
              <Stat label="Atenção" value={s.attention} tone="warning" />
              <Stat label="Alerta" value={s.alert} tone="alert" />
              <Stat label="Não atend." value={s.unattendedAlerts} tone="alert" />
            </div>
          </section>

          {/* Médicos associados */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Médicos associados ({team.doctors.length})
            </h3>
            <DoctorList doctors={team.doctors} />
          </section>

          {/* Pacientes vinculados */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Pacientes em monitoramento
            </h3>
            <TeamPatientList patients={team.patients} onFollowPatient={onFollowPatient} />
          </section>

          {/* Alertas recentes */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Alertas recentes</h3>
            <RecentAlerts alerts={team.recentAlerts} />
          </section>
        </div>
      </div>
    </div>
  );
}
