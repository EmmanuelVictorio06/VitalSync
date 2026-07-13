/**
 * Painel de equipe(s) — UI compartilhada por "Minha Equipe" (Cirurgião Principal)
 * e "Minhas Equipes" (Médico Associado). A diferença entre os perfis fica em
 * `roleLabel` (texto do papel no card da equipe) e `currentUserId` (destaca
 * "Você" na lista de médicos); o restante (cards de resumo, médicos, pacientes
 * prioritários, carrossel) é idêntico.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, BellRing, Calendar, ChevronRight, Eye, Mail,
  MessageCircle, ShieldAlert, ShieldCheck, Stethoscope, Users, X,
} from 'lucide-react';
import { formatCivilDate, formatPhoneBR } from '@vitalsync/shared';
import { Button, ProfessionalTag, StatusBadge, cn } from './ui';
import { TeamCarousel } from './TeamCarousel';
import { getPriorityPatients, postOpDay, type TeamDetail, type TeamMemberView, type TeamPatientView } from '../services/teamViewService';

const PREVIEW_DOCTORS = 3;
const PREVIEW_PATIENTS = 5;

interface TeamDashboardProps {
  /** Equipes já carregadas (lista não vazia). */
  teams: TeamDetail[];
  /** Texto do papel do usuário exibido no card da equipe. */
  roleLabel: string;
  /** Id do usuário logado — destaca "Você" na lista de médicos. */
  currentUserId?: string;
  /** Quando fornecido (cirurgião dono), exibe "Gerenciar equipe" no bloco. */
  onManageTeam?: (teamId: string) => void;
}

export function TeamDashboard({ teams, roleLabel, currentUserId, onManageTeam }: TeamDashboardProps) {
  const [active, setActive] = useState(0);
  const current = teams[Math.min(active, teams.length - 1)]!;

  return (
    <>
      {teams.length > 1 && <TeamCarousel teams={teams} activeIndex={active} onSelect={setActive} />}
      <TeamBlock key={current.summary.id} detail={current} roleLabel={roleLabel} currentUserId={currentUserId} onManageTeam={onManageTeam} />
    </>
  );
}

function whatsappUrl(digits: string | null): string | null {
  const clean = (digits ?? '').replace(/\D/g, '');
  return clean ? `https://wa.me/55${clean}` : null;
}

/* ------------------------------ Bloco da equipe --------------------------- */

function TeamBlock({ detail, roleLabel, currentUserId, onManageTeam }: { detail: TeamDetail; roleLabel: string; currentUserId?: string; onManageTeam?: (teamId: string) => void }) {
  const navigate = useNavigate();
  const { summary, members, patients, managers } = detail;
  const teamParam = String(summary.number);
  const associates = useMemo(() => members.filter((m) => !m.isSurgeon && !m.isManager), [members]);
  // Card "Integrantes da Equipe": Responsável → Associados → Gerente (o gerente
  // vem de `managers`, separado de `members` de propósito — não conta como associado).
  const roster = useMemo(() => [...members, ...managers], [members, managers]);

  const [rosterOpen, setRosterOpen] = useState(false);

  const goMonitoring = () => navigate(`/monitoring?team=${teamParam}`);
  const goAlerts = () => navigate(`/alerts?team=${teamParam}`);

  const listed = useMemo(() => getPriorityPatients(patients), [patients]);

  return (
    <div className="space-y-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
        <SummaryCard label="Pacientes" value={summary.stats.monitoring} icon={Users} tone="primary" />
        <SummaryCard label="Estáveis" value={summary.stats.stable} icon={ShieldCheck} tone="stable" />
        <SummaryCard label="Em atenção" value={summary.stats.attention} icon={AlertTriangle} tone="warning" />
        <SummaryCard label="Em alerta" value={summary.stats.alert} icon={ShieldAlert} tone="alert" />
        <SummaryCard label="Alertas não atendidos" value={summary.stats.unattendedAlerts} icon={BellRing} tone="alert" />
      </div>

      {/* Card principal da equipe */}
      <section className="bg-card border border-border rounded-xl shadow-sm border-l-4 border-l-primary p-5 animate-entry [animation-delay:100ms]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Equipe nº {String(summary.number).padStart(2, '0')}
              </p>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border',
                summary.status === 'ACTIVE' ? 'bg-stable/10 text-stable border-stable/20' : 'bg-muted text-muted-foreground border-border',
              )}>
                {summary.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <h3 className="font-bold text-lg leading-tight mt-1 inline-flex items-center gap-1.5">
              <Stethoscope className="size-4 text-primary shrink-0" /> {summary.surgeonName}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">{roleLabel}</p>

            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm">
              <Stat label="médicos associados" value={associates.length} />
              <Stat label="em monitoramento" value={summary.stats.monitoring} />
              <Stat label="em alerta" value={summary.stats.alert} tone="text-alert" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-col gap-2 lg:w-44 shrink-0">
            <Button size="sm" className="justify-center" onClick={goMonitoring}>
              <Activity className="size-3.5" /> Ver pacientes
            </Button>
            <Button variant="secondary" size="sm" className="justify-center" onClick={goAlerts}>
              <BellRing className="size-3.5" /> Ver alertas
            </Button>
            <Button variant="ghost" size="sm" className="justify-center col-span-2 sm:col-span-1" onClick={() => setRosterOpen(true)}>
              <Users className="size-3.5" /> Ver detalhes
            </Button>
            {onManageTeam && (
              <Button variant="secondary" size="sm" className="justify-center col-span-2 sm:col-span-1" onClick={() => onManageTeam(summary.id)}>
                <Users className="size-3.5" /> Gerenciar equipe
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Médicos (preview) */}
        <section className="min-w-0 lg:col-span-2 bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:150ms]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold tracking-tight inline-flex items-center gap-2">
              <Users className="size-4 text-primary" /> Integrantes da Equipe
            </h3>
            <span className="text-xs font-semibold text-muted-foreground">{associates.length} associado(s)</span>
          </div>

          {roster.length === 0 ? (
            <EmptyHint title="Nenhum médico associado" text="Adicione médicos à equipe pelo gerenciamento de equipes." />
          ) : (
            <>
              <ul className="space-y-2">
                {roster.slice(0, PREVIEW_DOCTORS).map((m) => <DoctorRow key={m.id} m={m} isMe={m.id === currentUserId} />)}
              </ul>
              {roster.length > PREVIEW_DOCTORS && (
                <button onClick={() => setRosterOpen(true)} className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors">
                  Ver todos os médicos ({roster.length}) <ChevronRight className="size-3.5" />
                </button>
              )}
            </>
          )}
        </section>

        {/* Pacientes prioritários */}
        <section className="min-w-0 lg:col-span-3 bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:200ms]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-bold tracking-tight inline-flex items-center gap-2">
              <Activity className="size-4 text-primary" /> Pacientes que precisam de atenção
            </h3>
            {listed.length > 0 && (
              <span className="text-xs font-semibold text-muted-foreground">{listed.length} no total</span>
            )}
          </div>

          {listed.length === 0 ? (
            <EmptyHint
              title="Nenhum paciente crítico no momento"
              text="Pacientes em atenção ou alerta aparecerão aqui."
            />
          ) : (
            <ul className="space-y-2.5">
              {listed.slice(0, PREVIEW_PATIENTS).map((p) => (
                <PriorityPatientCard key={p.id} p={p} onOpen={() => navigate(`/patients/${p.id}`)} />
              ))}
            </ul>
          )}

          <button
            onClick={goMonitoring}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-muted hover:bg-muted/70 rounded-md text-sm font-semibold transition-colors"
          >
            Ver todos os pacientes <ChevronRight className="size-4" />
          </button>
        </section>
      </div>

      {rosterOpen && (
        <TeamRosterDrawer
          summaryNumber={summary.number}
          members={members}
          managers={detail.managers}
          currentUserId={currentUserId}
          onClose={() => setRosterOpen(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------- Subcomponentes -------------------------- */

function SummaryCard({
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'primary' | 'stable' | 'warning' | 'alert';
}) {
  const box = {
    primary: 'bg-primary/10 text-primary',
    stable: 'bg-stable/10 text-stable',
    warning: 'bg-warning/10 text-warning',
    alert: 'bg-alert/10 text-alert',
  }[tone];
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex items-center gap-3">
      <span className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', box)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{label}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <strong className={cn('text-base font-extrabold', tone)}>{value}</strong>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function DoctorRow({ m, isMe = false }: { m: TeamMemberView; isMe?: boolean }) {
  const wa = whatsappUrl(m.whatsapp);
  const roleLabel = m.isManager ? 'Gerente' : m.isSurgeon ? 'Responsável' : 'Associado';
  return (
    <li className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate flex items-center gap-1.5 flex-wrap">
          {m.name}
          <span className={cn(
            'text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5',
            m.isManager || m.isSurgeon ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-muted',
          )}>
            {roleLabel}
          </span>
          {isMe && (
            <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 text-primary bg-primary/15">Você</span>
          )}
        </p>
        {m.tag && (
          <div className="mt-0.5">
            <ProfessionalTag tag={m.tag} />
          </div>
        )}
        <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0 mt-0.5">
          <Mail className="size-3 shrink-0" />
          <span className="truncate">{m.email}</span>
          {m.whatsapp && <span className="shrink-0 ml-1 tabular-nums">{formatPhoneBR(m.whatsapp)}</span>}
        </p>
      </div>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="size-8 rounded-md border border-border text-[#25D366] hover:bg-muted flex items-center justify-center shrink-0" aria-label={`WhatsApp de ${m.name}`}>
          <MessageCircle className="size-4" />
        </a>
      )}
    </li>
  );
}

function PriorityPatientCard({ p, onOpen }: { p: TeamPatientView; onOpen: () => void }) {
  const d = postOpDay(p.surgeryDate);
  const alertTone = p.lastAlert?.status === 'RED' ? 'text-alert' : 'text-warning';
  return (
    <li className={cn('bg-card border border-border rounded-lg p-3 border-l-4 flex items-center justify-between gap-3', borderFor(p.status))}>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate">{p.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {p.surgeryType}
          {d !== null && <> · D+{d} pós-op</>}
        </p>
        {p.lastAlert ? (
          <p className={cn('text-[11px] font-semibold mt-0.5 flex items-center gap-1 min-w-0', alertTone)}>
            <AlertTriangle className="size-3 shrink-0" />
            <span className="truncate">{p.lastAlert.type ?? 'Alerta clínico'}</span>
          </p>
        ) : p.dischargeDate ? (
          <p className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
            <Calendar className="size-3" /> Alta {formatCivilDate(p.dischargeDate)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <StatusBadge status={p.status} />
        <button onClick={onOpen} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Eye className="size-3.5" /> Acompanhar
        </button>
      </div>
    </li>
  );
}

function TeamRosterDrawer({
  summaryNumber,
  members,
  managers,
  currentUserId,
  onClose,
}: {
  summaryNumber: number;
  members: TeamMemberView[];
  managers: TeamMemberView[];
  currentUserId?: string;
  onClose: () => void;
}) {
  const all = [...members, ...managers];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-end sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Integrantes da Equipe nº ${String(summaryNumber).padStart(2, '0')}`}
      onClick={onClose}
    >
      <div
        className="bg-card border border-border w-full sm:max-w-md rounded-t-2xl sm:rounded-none shadow-xl max-h-[88vh] sm:max-h-none sm:h-full flex flex-col animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold tracking-tight">Integrantes da Equipe</h2>
            <p className="text-xs text-muted-foreground">Equipe nº {String(summaryNumber).padStart(2, '0')} · {all.length} profissional(is)</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-muted flex items-center justify-center" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </header>
        <ul className="p-5 space-y-2 overflow-y-auto">
          {all.map((m) => <DoctorRow key={m.id} m={m} isMe={m.id === currentUserId} />)}
        </ul>
      </div>
    </div>
  );
}

function EmptyHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="border border-dashed border-border rounded-lg p-6 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{text}</p>
    </div>
  );
}

/** Borda lateral por status — local p/ aceitar a união ClinicalStatus do serviço. */
function borderFor(status: TeamPatientView['status']): string {
  if (status === 'RED') return 'border-l-alert';
  if (status === 'YELLOW') return 'border-l-warning';
  return 'border-l-stable';
}
