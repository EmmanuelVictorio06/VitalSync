/**
 * Lista acionável de falhas de envio (Bloco 2). O contador sozinho é passivo:
 * diz que algo falhou, mas não quem ficou sem ser avisado nem o que fazer.
 *
 * As linhas em `exhausted` (esgotaram as 3 tentativas automáticas do
 * `retry_failed_notifications`) vêm em destaque — são as que só o reenvio
 * manual resolve, e as que realmente significam "ninguém foi avisado".
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { alertService, type FailedNotificationRow } from '../services/alertService';
import { useToast } from './Toast';
import { Button, cn } from './ui';

export function FailedNotificationsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<FailedNotificationRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await alertService.getFailedNotifications());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reenviar(row: FailedNotificationRow) {
    if (!row.alertId) return;
    setBusyId(row.id);
    try {
      await alertService.resendNotification(row.alertId);
      toast.success('Reenvio solicitado.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível reenviar.');
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) return <p className="text-xs text-muted-foreground">Carregando falhas de envio…</p>;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma notificação com falha. Envios bloqueados pelo modo homologação
        (<span className="font-mono">SKIPPED_TEST_MODE</span>) não contam como falha — são intencionais.
      </p>
    );
  }

  const esgotadas = rows.filter((r) => r.exhausted).length;

  return (
    <div className="space-y-3">
      {esgotadas > 0 && (
        <div className="rounded-lg border border-alert/30 bg-alert/5 p-3 flex items-start gap-2">
          <AlertTriangle className="size-4 text-alert shrink-0 mt-0.5" />
          <p className="text-xs text-alert">
            <strong>{esgotadas}</strong> notificação(ões) esgotaram as tentativas automáticas — a equipe
            <strong> não foi avisada</strong>. Reenvie manualmente ou contate por outro canal.
          </p>
        </div>
      )}

      <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn('px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap', r.exhausted && 'bg-alert/5')}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {r.patientName}
                {r.alertStatus === 'RED' && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-alert">vermelho</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                para {r.recipientName ?? '—'} · {r.retryCount} tentativa(s)
                {r.exhausted && <span className="text-alert font-semibold"> · esgotado</span>}
                {r.errorMessage ? ` · ${r.errorMessage.slice(0, 60)}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void reenviar(r)}
              loading={busyId === r.id}
              disabled={!r.alertId}
            >
              <Send className="size-3.5" /> Reenviar
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
      </div>
    </div>
  );
}
