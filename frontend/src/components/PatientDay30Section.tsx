/**
 * PatientDay30Section — "Avaliação em 30 dias" (protocolo 5.8): contato
 * telefônico de desfechos (procura por pronto atendimento, reinternação,
 * avaliação não programada, persistência de sintomas) + questionário de
 * satisfação (escala 1–5). RLS restringe leitura/escrita à equipe do
 * paciente, ou Admin (ver migration 0055_fase4_metricas_estudo.sql).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck, Loader2 } from 'lucide-react';
import { useToast } from './Toast';
import { Button, SelectField, TextareaField } from './ui';
import {
  day30Service,
  hasDay30Outcome,
  type NewDay30Assessment,
  type PatientDay30Assessment,
} from '../services/day30Service';

const BOOL_OPTIONS = [
  { value: 'true', label: 'Sim' },
  { value: 'false', label: 'Não' },
];

const SATISFACTION_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}` }));

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function yesNo(v: boolean | null): string {
  return v === null ? '—' : v ? 'Sim' : 'Não';
}

type BoolField = '' | 'true' | 'false';

export function PatientDay30Section({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<PatientDay30Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [soughtEr, setSoughtEr] = useState<BoolField>('');
  const [readmitted, setReadmitted] = useState<BoolField>('');
  const [unplannedVisit, setUnplannedVisit] = useState<BoolField>('');
  const [persistentSymptoms, setPersistentSymptoms] = useState<BoolField>('');
  const [outcomesNotes, setOutcomesNotes] = useState('');
  const [satSafety, setSatSafety] = useState('');
  const [satEase, setSatEase] = useState('');
  const [satCommunication, setSatCommunication] = useState('');
  const [satOverall, setSatOverall] = useState('');
  const [satComment, setSatComment] = useState('');

  async function load() {
    setLoading(true);
    try {
      setRows(await day30Service.listByPatient(patientId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar as avaliações de 30 dias.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [patientId]);

  function toBool(v: BoolField): boolean | null {
    return v === '' ? null : v === 'true';
  }

  const willHaveOutcome = hasDay30Outcome({
    sought_er: toBool(soughtEr),
    readmitted: toBool(readmitted),
    unplanned_visit: toBool(unplannedVisit),
    persistent_symptoms: toBool(persistentSymptoms),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: NewDay30Assessment = {
      sought_er: toBool(soughtEr),
      readmitted: toBool(readmitted),
      unplanned_visit: toBool(unplannedVisit),
      persistent_symptoms: toBool(persistentSymptoms),
      outcomes_notes: outcomesNotes.trim() || null,
      satisfaction_safety: satSafety ? Number(satSafety) : null,
      satisfaction_ease: satEase ? Number(satEase) : null,
      satisfaction_communication: satCommunication ? Number(satCommunication) : null,
      satisfaction_overall: satOverall ? Number(satOverall) : null,
      satisfaction_comment: satComment.trim() || null,
    };
    setSaving(true);
    try {
      await day30Service.create(patientId, input);
      setSoughtEr('');
      setReadmitted('');
      setUnplannedVisit('');
      setPersistentSymptoms('');
      setOutcomesNotes('');
      setSatSafety('');
      setSatEase('');
      setSatCommunication('');
      setSatOverall('');
      setSatComment('');
      toast.success('Avaliação de 30 dias registrada.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível registrar a avaliação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <CalendarCheck className="size-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Avaliação em 30 dias</h3>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <SelectField label="Procurou pronto atendimento?" value={soughtEr} onChange={(e) => setSoughtEr(e.target.value as BoolField)} options={BOOL_OPTIONS} />
          <SelectField label="Foi reinternado?" value={readmitted} onChange={(e) => setReadmitted(e.target.value as BoolField)} options={BOOL_OPTIONS} />
          <SelectField label="Avaliação médica não programada?" value={unplannedVisit} onChange={(e) => setUnplannedVisit(e.target.value as BoolField)} options={BOOL_OPTIONS} />
          <SelectField label="Persistência de sintomas?" value={persistentSymptoms} onChange={(e) => setPersistentSymptoms(e.target.value as BoolField)} options={BOOL_OPTIONS} />
        </div>

        {willHaveOutcome && (
          <div className="flex items-start gap-2 bg-warning/10 border border-warning/20 rounded-lg p-3 text-xs font-semibold text-warning">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            Desfecho relevante assinalado — considere registrar detalhes nas observações.
          </div>
        )}

        <TextareaField label="Observações sobre os desfechos" rows={2} value={outcomesNotes} onChange={(e) => setOutcomesNotes(e.target.value)} />

        <div className="pt-2 border-t border-border">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Satisfação (escala 1 a 5 — 1 = muito insatisfeito, 5 = muito satisfeito)
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <SelectField label="Segurança" value={satSafety} onChange={(e) => setSatSafety(e.target.value)} options={SATISFACTION_OPTIONS} />
            <SelectField label="Facilidade de uso" value={satEase} onChange={(e) => setSatEase(e.target.value)} options={SATISFACTION_OPTIONS} />
            <SelectField label="Comunicação com a equipe" value={satCommunication} onChange={(e) => setSatCommunication(e.target.value)} options={SATISFACTION_OPTIONS} />
            <SelectField label="Satisfação geral" value={satOverall} onChange={(e) => setSatOverall(e.target.value)} options={SATISFACTION_OPTIONS} />
          </div>
          <div className="mt-3">
            <TextareaField label="Comentário aberto" rows={2} value={satComment} onChange={(e) => setSatComment(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={saving}>
            Registrar avaliação
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma avaliação de 30 dias registrada ainda.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{r.performed_by_name ?? 'Profissional'}</span>
                <span className="tabular-nums">{formatDateTime(r.performed_at)}</span>
              </div>
              {hasDay30Outcome(r) && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs font-bold text-warning">
                  <AlertTriangle className="size-3.5" /> Desfecho relevante assinalado
                </div>
              )}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
                <div><dt className="text-muted-foreground">Pronto atend.</dt><dd className="font-semibold">{yesNo(r.sought_er)}</dd></div>
                <div><dt className="text-muted-foreground">Reinternação</dt><dd className="font-semibold">{yesNo(r.readmitted)}</dd></div>
                <div><dt className="text-muted-foreground">Avaliação não prog.</dt><dd className="font-semibold">{yesNo(r.unplanned_visit)}</dd></div>
                <div><dt className="text-muted-foreground">Sintomas persistentes</dt><dd className="font-semibold">{yesNo(r.persistent_symptoms)}</dd></div>
              </dl>
              {r.outcomes_notes && <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{r.outcomes_notes}</p>}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
                <div><dt className="text-muted-foreground">Segurança</dt><dd className="font-semibold">{r.satisfaction_safety ?? '—'}/5</dd></div>
                <div><dt className="text-muted-foreground">Facilidade</dt><dd className="font-semibold">{r.satisfaction_ease ?? '—'}/5</dd></div>
                <div><dt className="text-muted-foreground">Comunicação</dt><dd className="font-semibold">{r.satisfaction_communication ?? '—'}/5</dd></div>
                <div><dt className="text-muted-foreground">Geral</dt><dd className="font-semibold">{r.satisfaction_overall ?? '—'}/5</dd></div>
              </dl>
              {r.satisfaction_comment && <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{r.satisfaction_comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
