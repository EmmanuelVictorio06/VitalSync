/**
 * PatientFollowupSection — "Atendimentos (48h)": registro estruturado da
 * videochamada de acompanhamento a cada 48h (protocolo 5.6.5) — aceitação da
 * dieta, uso correto das medicações, sintomas de TVP e avaliação da ferida —
 * além da observação em texto livre. RLS restringe leitura/escrita à equipe
 * do paciente, ou Admin (ver migration 0050_patient_followups.sql).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import { useToast } from './Toast';
import { Button, RichTextField, SelectField } from './ui';
import { richTextToPlainText, sanitizeRichText } from '../lib/richText';
import {
  followupService,
  isFollowupCritical,
  type DietAcceptance,
  type PatientFollowup,
} from '../services/followupService';

const DIET_LABEL: Record<DietAcceptance, string> = {
  ADEQUADA: 'Adequada',
  REDUZIDA: 'Reduzida',
  INTOLERANCIA: 'Intolerância alimentar',
};

const BOOL_OPTIONS = [
  { value: 'true', label: 'Sim' },
  { value: 'false', label: 'Não' },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function yesNo(v: boolean | null): string {
  return v === null ? '—' : v ? 'Sim' : 'Não';
}

export function PatientFollowupSection({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<PatientFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState('');
  const [dietAcceptance, setDietAcceptance] = useState<DietAcceptance | ''>('');
  const [medicationsCorrect, setMedicationsCorrect] = useState<'' | 'true' | 'false'>('');
  const [dvtSymptoms, setDvtSymptoms] = useState<'' | 'true' | 'false'>('');
  const [woundOk, setWoundOk] = useState<'' | 'true' | 'false'>('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await followupService.listByPatient(patientId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar os atendimentos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [patientId]);

  const willBeCritical = isFollowupCritical({
    diet_acceptance: dietAcceptance || null,
    dvt_symptoms: dvtSymptoms === '' ? null : dvtSymptoms === 'true',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const plain = richTextToPlainText(result).trim();
    if (!plain) {
      toast.error('Descreva o resultado do atendimento.');
      return;
    }
    setSaving(true);
    try {
      await followupService.create(patientId, {
        result: sanitizeRichText(result),
        diet_acceptance: dietAcceptance || null,
        medications_correct: medicationsCorrect === '' ? null : medicationsCorrect === 'true',
        dvt_symptoms: dvtSymptoms === '' ? null : dvtSymptoms === 'true',
        wound_ok: woundOk === '' ? null : woundOk === 'true',
      });
      setResult('');
      setDietAcceptance('');
      setMedicationsCorrect('');
      setDvtSymptoms('');
      setWoundOk('');
      toast.success('Atendimento registrado.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível registrar o atendimento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <CalendarClock className="size-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Atendimentos (videochamada 48h)
        </h3>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <SelectField
            label="Aceitação da dieta"
            value={dietAcceptance}
            onChange={(e) => setDietAcceptance(e.target.value as DietAcceptance | '')}
            options={(Object.keys(DIET_LABEL) as DietAcceptance[]).map((k) => ({ value: k, label: DIET_LABEL[k] }))}
          />
          <SelectField
            label="Uso correto das medicações"
            value={medicationsCorrect}
            onChange={(e) => setMedicationsCorrect(e.target.value as typeof medicationsCorrect)}
            options={BOOL_OPTIONS}
          />
          <SelectField
            label="Sintomas de TVP (dor de panturrilha ou edema assimétrico)"
            value={dvtSymptoms}
            onChange={(e) => setDvtSymptoms(e.target.value as typeof dvtSymptoms)}
            options={BOOL_OPTIONS}
          />
          <SelectField
            label="Ferida operatória sem alterações"
            value={woundOk}
            onChange={(e) => setWoundOk(e.target.value as typeof woundOk)}
            options={BOOL_OPTIONS}
          />
        </div>

        {willBeCritical && (
          <div className="flex items-start gap-2 bg-alert/10 border border-alert/20 rounded-lg p-3 text-xs font-semibold text-alert">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            Critério vermelho do protocolo (intolerância alimentar ou sintomas de TVP) — encaminhar para telemedicina.
          </div>
        )}

        <RichTextField
          label="Resultado do atendimento"
          hint="Registre o contato feito com o paciente a cada 48h e o que foi observado."
          toolbar="full"
          minHeightClassName="min-h-[120px]"
          value={result}
          onChange={(html) => setResult(html)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={saving}>
            Registrar atendimento
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum atendimento registrado ainda.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{r.performed_by_name ?? 'Profissional'}</span>
                <span className="tabular-nums">{formatDateTime(r.performed_at)}</span>
              </div>
              {isFollowupCritical(r) && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs font-bold text-alert">
                  <AlertTriangle className="size-3.5" /> Critério vermelho — encaminhado para telemedicina
                </div>
              )}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
                <div><dt className="text-muted-foreground">Dieta</dt><dd className="font-semibold">{r.diet_acceptance ? DIET_LABEL[r.diet_acceptance] : '—'}</dd></div>
                <div><dt className="text-muted-foreground">Medicações</dt><dd className="font-semibold">{yesNo(r.medications_correct)}</dd></div>
                <div><dt className="text-muted-foreground">Sintomas de TVP</dt><dd className="font-semibold">{yesNo(r.dvt_symptoms)}</dd></div>
                <div><dt className="text-muted-foreground">Ferida ok</dt><dd className="font-semibold">{yesNo(r.wound_ok)}</dd></div>
              </dl>
              <div
                className="text-sm text-foreground mt-2 whitespace-pre-wrap break-words [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(r.result) }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
