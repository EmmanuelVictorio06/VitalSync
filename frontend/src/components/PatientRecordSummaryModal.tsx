/**
 * PatientRecordSummaryModal — visualizador em overlay do resumo de prontuário,
 * aberto a partir do card de resumo do paciente (ver PatientDashboardPage.tsx).
 *
 * Mesmo padrão visual de ConfirmModal/PatientEditModal (ui.tsx / PatientEditModal.tsx):
 * backdrop bg-foreground/50 + backdrop-blur-sm, z-50, painel bg-card animate-entry.
 *
 * Modo leitura mostra o HTML sanitizado com scroll interno; modo edição troca o
 * corpo pelo RichTextField já existente, sem fechar o overlay. Salva só o campo
 * `medical_record_summary` — a Edge Function `update-patient` aplica apenas os
 * campos presentes no payload, então não há risco de zerar os demais dados do
 * paciente (ver update-patient/index.ts, passo 4: `if (body.x !== undefined)`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { richTextToPlainText, sanitizeRichText } from '../lib/richText';
import { patientService } from '../services/patientService';
import { useToast } from './Toast';
import { Button, ConfirmModal, ModalOverlay, RichTextField, cn } from './ui';

type Mode = 'view' | 'edit';
type PendingAction = 'discard' | 'close' | null;

export interface PatientRecordSummaryModalProps {
  patientId: string;
  patientName: string;
  html: string;
  canEdit: boolean;
  initialMode?: Mode;
  onClose: () => void;
  /** Chamado após salvar com sucesso, para o painel recarregar os dados do paciente. */
  onSaved: () => Promise<void> | void;
}

export function PatientRecordSummaryModal({
  patientId,
  patientName,
  html,
  canEdit,
  initialMode = 'view',
  onClose,
  onSaved,
}: PatientRecordSummaryModalProps) {
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [viewHtml, setViewHtml] = useState(html);
  const [draft, setDraft] = useState(initialMode === 'edit' ? html : '');
  const [editBaseline, setEditBaseline] = useState(initialMode === 'edit' ? html : '');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // Sincroniza com o painel (ex.: após load() do pai) enquanto não está editando.
  useEffect(() => {
    if (mode === 'view') setViewHtml(html);
  }, [html, mode]);

  // A trava de scroll agora é do ModalOverlay (o body não é o scroller aqui).
  // Move o foco para o dialog ao abrir e devolve ao gatilho ao fechar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const requestClose = useCallback(() => {
    if (mode === 'edit' && draft !== editBaseline) {
      setPendingAction('close');
    } else {
      onClose();
    }
  }, [mode, draft, editBaseline, onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (pendingAction) {
        setPendingAction(null);
        return;
      }
      requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pendingAction, requestClose]);

  function startEdit() {
    setEditBaseline(viewHtml);
    setDraft(viewHtml);
    setMode('edit');
  }

  function cancelEdit() {
    if (draft !== editBaseline) {
      setPendingAction('discard');
    } else {
      setMode('view');
    }
  }

  function resolvePending() {
    if (pendingAction === 'discard') setMode('view');
    else if (pendingAction === 'close') onClose();
    setPendingAction(null);
  }

  async function save() {
    setSaving(true);
    try {
      const plain = richTextToPlainText(draft).trim();
      const sanitized = plain ? sanitizeRichText(draft) : '';
      await patientService.update({ id: patientId, medical_record_summary: sanitized });
      toast.success('Prontuário atualizado com sucesso.');
      setViewHtml(sanitized);
      setMode('view');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar o prontuário.');
    } finally {
      setSaving(false);
    }
  }

  const isEmpty = richTextToPlainText(viewHtml).trim() === '';

  return (
    <ModalOverlay
      onClose={requestClose}
      className="z-50 bg-foreground/50 backdrop-blur-sm items-start justify-center p-4 overflow-y-auto"
      ariaLabel="Prontuário do paciente"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-full md:max-w-4xl max-h-[90vh] flex flex-col animate-entry my-8 outline-none"
      >
        <div className="flex items-start justify-between gap-3 p-5 md:p-6 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight">Prontuário médico</h2>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{patientName}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {canEdit && mode === 'view' && (
              <Button variant="secondary" size="sm" onClick={startEdit}>
                <Pencil className="size-4" /> Editar prontuário
              </Button>
            )}
            <button
              type="button"
              onClick={requestClose}
              className="size-8 rounded-md border border-border text-muted-foreground hover:bg-muted flex items-center justify-center shrink-0"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 md:p-6 overflow-y-auto flex-1 min-h-0">
          {mode === 'view' ? (
            isEmpty ? (
              <p className="text-sm text-muted-foreground">Nenhum prontuário registrado.</p>
            ) : (
              <div
                className={cn(
                  'text-sm text-foreground whitespace-pre-wrap break-words',
                  '[&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5',
                )}
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(viewHtml) }}
              />
            )
          ) : (
            <RichTextField
              label="Resumo de prontuário"
              hint="Breve histórico clínico relevante para o acompanhamento (opcional)."
              minHeightClassName="min-h-[240px]"
              toolbar="full"
              value={draft}
              onChange={setDraft}
            />
          )}
        </div>

        {mode === 'edit' && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 p-5 md:p-6 border-t border-border shrink-0">
            <Button type="button" variant="ghost" onClick={cancelEdit} className="w-full sm:w-auto">
              Cancelar
            </Button>
            <Button type="button" variant="primary" onClick={save} loading={saving} className="w-full sm:w-auto">
              Salvar
            </Button>
          </div>
        )}
      </div>

      {pendingAction && (
        <ConfirmModal
          title="Descartar alterações?"
          message="Você tem alterações não salvas no prontuário. Deseja descartá-las?"
          confirmLabel="Descartar"
          onConfirm={resolvePending}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </ModalOverlay>
  );
}
