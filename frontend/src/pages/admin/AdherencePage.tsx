/**
 * Adesão e Completude (Admin) — desfecho PRIMÁRIO do estudo (protocolo 5.11).
 * Meta: ≥80% das coletas programadas (2×/dia × 10 dias = 20 coletas).
 */
import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { AdminPageHeader, AdminTable, ErrorState, LoadingState } from '../../components/admin';
import { Button, PageContainer, cn } from '../../components/ui';
import { adherenceService, type PatientAdherence } from '../../services/adherenceService';
import { downloadCsv } from '../../lib/csv';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AdherencePage() {
  const toast = useToast();
  const [rows, setRows] = useState<PatientAdherence[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setRows(null);
    try {
      setRows(await adherenceService.getPatientAdherence());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar adesão.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`vitalsync_adesao_${today()}.csv`, [
      ['Paciente', 'Dias de monitoramento', 'Coletas esperadas', 'Coletas realizadas', 'Adesão (%)', 'Completude (%)', 'Perda de seguimento'],
      ...rows.map((r) => [
        r.name,
        String(r.effectiveDays),
        String(r.expectedCollections),
        String(r.actualCollections),
        String(r.adherencePct),
        String(r.completenessPct),
        r.lostToFollowUp ? 'Sim' : 'Não',
      ]),
    ]);
    toast.success(`${rows.length} paciente(s) exportado(s).`);
  }

  const summary = rows ? adherenceService.summarize(rows) : null;

  return (
    <PageContainer>
      <AdminPageHeader
        title="Adesão e Completude"
        subtitle="Desfecho primário do estudo (protocolo 5.11): taxa de adesão às coletas programadas, completude dos dados e perda de seguimento."
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 animate-entry">
          <SummaryCard label="Pacientes" value={String(summary.totalPatients)} />
          <SummaryCard
            label="Atingem a meta (≥80%)"
            value={`${summary.meetingTarget}/${summary.totalPatients}`}
            tone={summary.totalPatients > 0 && summary.meetingTarget / summary.totalPatients >= 0.8 ? 'stable' : 'warning'}
          />
          <SummaryCard label="Adesão média" value={`${summary.avgAdherencePct}%`} />
          <SummaryCard label="Perda de seguimento" value={String(summary.lostToFollowUpCount)} tone={summary.lostToFollowUpCount > 0 ? 'alert' : 'stable'} />
        </div>
      )}

      <div className="flex justify-end mb-3">
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows || rows.length === 0}>
          <FileDown className="size-4" /> Exportar CSV
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <LoadingState />
      ) : (
        <AdminTable
          columns={[
            { header: 'Paciente', render: (r: PatientAdherence) => <span className="font-semibold">{r.name}</span> },
            { header: 'Dia', render: (r: PatientAdherence) => `D+${r.effectiveDays}` },
            { header: 'Coletas', render: (r: PatientAdherence) => `${r.actualCollections}/${r.expectedCollections}` },
            {
              header: 'Adesão',
              render: (r: PatientAdherence) => (
                <span className={cn('font-bold', r.meetsAdherenceTarget ? 'text-stable' : 'text-alert')}>
                  {r.adherencePct}%
                </span>
              ),
            },
            { header: 'Completude', render: (r: PatientAdherence) => `${r.completenessPct}%`, hideOnMobile: true },
            {
              header: 'Perda de seguimento',
              render: (r: PatientAdherence) =>
                r.lostToFollowUp ? <span className="font-bold text-alert">Sim</span> : '—',
              hideOnMobile: true,
            },
          ]}
          rows={rows}
          keyFor={(r) => r.patientId}
        />
      )}
    </PageContainer>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'stable' | 'warning' | 'alert' }) {
  const toneCls = tone === 'stable' ? 'text-stable' : tone === 'warning' ? 'text-warning' : tone === 'alert' ? 'text-alert' : 'text-foreground';
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-extrabold tracking-tight mt-0.5', toneCls)}>{value}</p>
    </div>
  );
}
