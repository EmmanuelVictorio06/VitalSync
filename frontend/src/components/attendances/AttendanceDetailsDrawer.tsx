import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  MessageCircle,
  Pencil,
  Stethoscope,
  Thermometer,
  Users,
  Wind,
  X,
} from 'lucide-react';
import { calculateAge, Period, whatsappLink } from '@vitalsync/shared';
import type { AttendanceConfirmation } from '../../services/types';
import type { AttendanceRow } from '../../services/attendanceService';
import { attendanceService } from '../../services/attendanceService';
import { storageService } from '../../services/storageService';
import { Button, cn, Loading } from '../ui';
import { AttendanceClinicalBadge } from './AttendanceClinicalBadge';
import { AttendanceOriginBadge } from './AttendanceOriginBadge';
import { AttendanceStatusBadge } from './AttendanceStatusBadge';
import { clinicalRule, fmtDate, fmtDateTime, teamLabel, triggerValue } from './utils';

const SIGNAL_ICON: Record<string, typeof Stethoscope> = {
  Temperatura: Thermometer,
  Saturação: Wind,
  Dor: AlertCircle,
  Sangramento: Activity,
};

export function AttendanceDetailsDrawer({
  row,
  canEdit,
  onClose,
  onEditObservation,
}: {
  row: AttendanceRow;
  canEdit: boolean;
  onClose: () => void;
  onEditObservation: () => void;
}) {
  const [timeline, setTimeline] = useState<AttendanceConfirmation[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [drainPhotoUrl, setDrainPhotoUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const r = row.vital_record;
  const TypeIcon = (row.related_vital_sign && SIGNAL_ICON[row.related_vital_sign]) || Stethoscope;

  useEffect(() => {
    let active = true;
    attendanceService.getTimeline(row).then((t) => active && setTimeline(t)).catch(() => active && setTimeline([]));
    if (r?.wound_photo_path) {
      storageService.getPatientPhotoUrl(r.wound_photo_path).then((u) => active && setPhotoUrl(u)).catch(() => {});
    }
    if (r?.drain_photo_path) {
      storageService.getPatientPhotoUrl(r.drain_photo_path).then((u) => active && setDrainPhotoUrl(u)).catch(() => {});
    }
    return () => { active = false; };
  }, [row, r?.wound_photo_path, r?.drain_photo_path]);

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhes do atendimento"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-lg h-full overflow-y-auto shadow-xl animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center gap-3 z-10">
          <span className="size-9 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <TypeIcon className="size-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold tracking-tight">Detalhes do Atendimento</h2>
            <p className="text-xs text-muted-foreground truncate">{row.patient?.name ?? '—'}</p>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* 1. Paciente */}
          <DSection title="Dados do paciente" icon={Users}>
            <DGrid
              items={[
                ['Nome', row.patient?.name ?? '—'],
                ['Idade', row.patient?.birth_date ? `${calculateAge(new Date(row.patient.birth_date))} anos` : '—'],
                ['Telefone', row.patient?.phone ?? '—'],
                ['Equipe', teamLabel(row.team?.team_number)],
                ['Tipo de cirurgia', row.patient?.surgery_type?.name ?? '—'],
                ['Hospital', row.patient?.hospital?.name ?? '—'],
                ['Data da cirurgia', fmtDate(row.patient?.surgery_date)],
                ['Data da alta', fmtDate(row.patient?.hospital_discharge_date)],
                ['Dia de monitoramento', r?.monitoring_day ? `D+${r.monitoring_day}` : '—'],
              ]}
            />
          </DSection>

          {/* 2. Atendimento */}
          <DSection title="Dados do atendimento" icon={ClipboardList}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <AttendanceStatusBadge status={row.status} />
              <AttendanceOriginBadge origin={row.origin} />
            </div>
            <DGrid
              items={[
                ['Profissional', row.professional_name ?? '—'],
                ['Perfil', roleLabel(row.professional_role)],
                ['Finalizado em', fmtDateTime(row.created_at)],
                ['Equipe', teamLabel(row.team?.team_number)],
                ['Cirurgião responsável', row.surgeon_name ?? '—'],
              ]}
            />
            <div className="mt-3 bg-muted rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Observação / conduta
              </p>
              <p className="text-sm whitespace-pre-line">{row.observation?.trim() || 'Sem observação registrada.'}</p>
            </div>
          </DSection>

          {/* 3. Dados clínicos relacionados */}
          {row.alert && (
            <DSection title="Alerta original" icon={TypeIcon}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <AttendanceClinicalBadge status={row.alert.status} />
              </div>
              <DGrid
                items={[
                  ['Sinal vital', row.related_vital_sign ?? '—'],
                  ['Valor registrado', triggerValue(row)],
                  ['Faixa de referência', clinicalRule(row)],
                  ['Nível do alerta', row.alert.status === 'RED' ? 'Vermelho' : 'Amarelo'],
                  ['Período', r?.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
                  ['Data/hora da medição', fmtDateTime(row.alert.created_at)],
                ]}
              />
              {row.alert.ignored_reason && (
                <p className="text-xs text-muted-foreground mt-2 bg-muted rounded-lg p-2">
                  <span className="font-bold uppercase">Justificativa: </span>
                  {row.alert.ignored_reason}
                </p>
              )}
            </DSection>
          )}

          {/* 4. Medição completa */}
          {r && (
            <DSection title="Registro da medição" icon={Activity}>
              <DGrid
                items={[
                  ['Data', fmtDate(r.record_date)],
                  ['Período', r.period ? (r.period === Period.MORNING ? 'Manhã' : 'Noite') : '—'],
                  ['Temperatura', r.temperature != null ? `${r.temperature} °C` : '—'],
                  ['Saturação', r.oxygen_saturation != null ? `${r.oxygen_saturation}%` : '—'],
                  ['Pressão arterial', r.systolic_pressure != null ? `${r.systolic_pressure}/${r.diastolic_pressure ?? '—'} mmHg` : '—'],
                  ['Frequência cardíaca', r.heart_rate != null ? `${r.heart_rate} bpm` : '—'],
                  ['Dor', r.pain_level != null ? `${r.pain_level}/10` : '—'],
                  ['Dispneia', r.dyspnea_level != null ? `${r.dyspnea_level}/10` : '—'],
                  ['Diurese', r.urination_count != null ? `${r.urination_count}×` : '—'],
                  ['Vômitos', r.vomiting_count != null ? `${r.vomiting_count}×` : '—'],
                  ['Sangramento', r.has_bleeding ? 'Sim' : 'Não'],
                  ['Passos', r.steps != null ? String(r.steps) : '—'],
                ]}
              />
              {(photoUrl || drainPhotoUrl) && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {photoUrl && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Cicatriz operatória
                      </p>
                      <button type="button" onClick={() => setZoom(photoUrl)} className="block w-full">
                        <img
                          src={photoUrl}
                          alt="Foto da cicatriz operatória"
                          className="rounded-lg border border-border max-h-56 w-full object-cover"
                        />
                      </button>
                    </div>
                  )}
                  {drainPhotoUrl && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Dreno
                      </p>
                      <button type="button" onClick={() => setZoom(drainPhotoUrl)} className="block w-full">
                        <img
                          src={drainPhotoUrl}
                          alt="Foto do dreno"
                          className="rounded-lg border border-border max-h-56 w-full object-cover"
                        />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </DSection>
          )}

          {/* 5. Timeline */}
          <DSection title="Histórico" icon={Clock}>
            <AttendanceTimeline row={row} timeline={timeline} />
          </DSection>
        </div>

        {/* Ações */}
        <footer className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex flex-wrap gap-2">
          {row.patient && (
            <Link
              to={`/patients/${row.patient.id}`}
              className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md"
            >
              <Stethoscope className="size-3.5" /> Acompanhar paciente
            </Link>
          )}
          {row.vital_record && row.patient && (
            <Link
              to={`/patients/${row.patient.id}`}
              className="inline-flex items-center justify-center gap-2 font-semibold border border-border bg-transparent text-foreground hover:bg-muted px-3 py-1.5 text-xs rounded-md"
            >
              <FileText className="size-3.5" /> Ver medição
            </Link>
          )}
          {row.patient?.phone && (
            <a
              href={whatsappLink(row.patient.phone, 'Olá! Sou da sua equipe médica no VitalSync e gostaria de acompanhar sua recuperação.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 font-semibold bg-[#25D366] text-white hover:opacity-90 px-3 py-1.5 text-xs rounded-md"
            >
              <MessageCircle className="size-3.5" /> WhatsApp
            </a>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onEditObservation}>
              <Pencil className="size-3.5" /> Editar observação
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1 text-xs text-stable font-semibold">
            <CheckCircle2 className="size-3.5" /> Atendimento finalizado
          </div>
        </footer>
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[70] bg-foreground/80 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setZoom(null); }}
        >
          <img src={zoom} alt="Foto ampliada" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function AttendanceTimeline({ row, timeline }: { row: AttendanceRow; timeline: AttendanceConfirmation[] | null }) {
  const events = useMemo(() => {
    const out: Array<{ at: string; label: string }> = [];
    if (row.alert) {
      out.push({
        at: row.alert.created_at,
        label: `Alerta gerado (${row.alert.status === 'RED' ? 'vermelho' : 'amarelo'})`,
      });
    }
    for (const t of timeline ?? []) {
      const label =
        t.status === 'ATTENDED'
          ? 'Atendimento registrado'
          : t.status === 'IN_ANALYSIS'
            ? 'Marcado como em análise'
            : t.status === 'IGNORED'
              ? 'Alerta finalizado com justificativa'
              : 'Acompanhamento registrado';
      out.push({ at: t.created_at, label: t.observation ? `${label}: ${t.observation}` : label });
    }
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [row, timeline]);

  if (timeline === null) return <Loading label="Carregando histórico…" />;
  if (events.length === 0) return <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="size-2 rounded-full bg-primary mt-1.5" />
            {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-1 min-w-0">
            <p className="text-sm font-medium leading-snug break-words">{e.label}</p>
            <p className="text-[11px] text-muted-foreground">{fmtDateTime(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function roleLabel(role: AttendanceRow['professional_role']): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'MEDICAL_SURGEON':
      return 'Médico Cirurgião';
    case 'ASSOCIATED_DOCTOR':
      return 'Médico Associado';
    default:
      return '—';
  }
}

function DSection({ title, icon: Icon, children }: { title: string; icon: typeof Stethoscope; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold mb-3">
        <Icon className="size-4 text-primary" /> {title}
      </h3>
      {children}
    </section>
  );
}

function DGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{k}</dt>
          <dd className="font-semibold mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
