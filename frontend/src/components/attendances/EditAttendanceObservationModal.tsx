import { useState } from 'react';
import type { AttendanceRow } from '../../services/attendanceService';
import { Button, Field } from '../ui';

export function EditAttendanceObservationModal({
  row,
  onConfirm,
  onCancel,
}: {
  row: AttendanceRow;
  onConfirm: (observation: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [observation, setObservation] = useState(row.observation ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!observation.trim()) {
      setError('Descreva a observação ou conduta do atendimento.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(observation.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar a observação.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md my-auto max-h-[90vh] overflow-y-auto animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold tracking-tight mb-1">Editar observação</h2>
        <p className="text-sm text-muted-foreground">
          Atualize a conduta ou observação registrada neste atendimento finalizado.
        </p>
        <div className="mt-4">
          <Field label="Observação do atendimento" required error={error ?? undefined}>
            <textarea
              className="input min-h-28 resize-y w-full"
              placeholder="Descreva a conduta ou observação do atendimento."
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 mt-6">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={busy}>
            Salvar observação
          </Button>
        </div>
      </div>
    </div>
  );
}
