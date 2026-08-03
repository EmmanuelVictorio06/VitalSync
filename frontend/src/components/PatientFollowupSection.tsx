/**
 * PatientFollowupSection — "Atendimentos (48h)": registro manual do resultado
 * de cada contato periódico com o paciente (RLS restringe leitura/escrita à
 * equipe do paciente, ou Admin — ver migration 0050_patient_followups.sql).
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useToast } from './Toast';
import { Button, TextareaField } from './ui';
import { followupService, type PatientFollowup } from '../services/followupService';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function PatientFollowupSection({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<PatientFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState('');
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.trim()) {
      toast.error('Descreva o resultado do atendimento.');
      return;
    }
    setSaving(true);
    try {
      await followupService.create(patientId, result);
      setResult('');
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
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Atendimentos (48h)</h3>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <TextareaField
          label="Resultado do atendimento"
          hint="Registre o contato feito com o paciente a cada 48h e o que foi observado."
          rows={3}
          value={result}
          onChange={(e) => setResult(e.target.value)}
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
              <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{r.result}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
