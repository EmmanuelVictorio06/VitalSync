/**
 * Exportações (Admin) — geram CSV no cliente a partir do Supabase (RLS aplica o
 * escopo). Substitui o endpoint Fastify /export. Datasets maiores/pesados
 * podem migrar para uma Edge Function no futuro.
 */
import { useState } from 'react';
import { Activity, Bell, FileDown } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { AdminPageHeader } from '../../components/admin';
import { Button, PageContainer } from '../../components/ui';
import { alertService } from '../../services/alertService';
import { patientService } from '../../services/patientService';

const STATUS_LABEL: Record<string, string> = { GREEN: 'Estável', YELLOW: 'Atenção', RED: 'Alerta' };

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const escape = (c: string | number | null | undefined) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportsPage() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function exportPatients() {
    setBusy('patients');
    try {
      const items = await patientService.list();
      const rows: Array<Array<string | number | null>> = [
        ['Nome', 'Status', 'Tipo de cirurgia', 'Hospital', 'Equipe', 'Alta hospitalar'],
        ...items.map((p) => [
          p.name,
          STATUS_LABEL[p.current_status] ?? p.current_status,
          p.surgery_type?.name ?? '',
          p.hospital?.name ?? '',
          p.medical_team ? `Equipe ${String(p.medical_team.team_number).padStart(2, '0')}` : '',
          p.hospital_discharge_date ?? '',
        ]),
      ];
      downloadCsv(`vitalsync_pacientes_${today}.csv`, rows);
      toast.success(`${items.length} paciente(s) exportado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar pacientes.');
    } finally {
      setBusy(null);
    }
  }

  async function exportAlerts() {
    setBusy('alerts');
    try {
      const items = await alertService.getAlerts();
      const rows: Array<Array<string | number | null>> = [
        ['Paciente', 'Status', 'Descrição', 'Atendido', 'Data'],
        ...items.map((a) => [
          a.patient?.name ?? '',
          STATUS_LABEL[a.status] ?? a.status,
          a.description,
          a.attended ? 'Sim' : 'Não',
          new Date(a.created_at).toLocaleString('pt-BR'),
        ]),
      ];
      downloadCsv(`vitalsync_alertas_${today}.csv`, rows);
      toast.success(`${items.length} alerta(s) exportado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar alertas.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageContainer>
      <AdminPageHeader
        title="Exportações"
        subtitle="Baixe os dados em CSV (abre no Excel/Google Sheets). A exportação respeita o seu perfil de acesso."
      />

      <div className="grid sm:grid-cols-2 gap-4 animate-entry [animation-delay:100ms]">
        <ExportCard
          icon={Activity}
          title="Pacientes"
          description="Lista de pacientes em monitoramento com status, cirurgia, hospital e equipe."
          loading={busy === 'patients'}
          onExport={exportPatients}
        />
        <ExportCard
          icon={Bell}
          title="Alertas clínicos"
          description="Alertas gerados pelas medições, com status, descrição e se foram atendidos."
          loading={busy === 'alerts'}
          onExport={exportAlerts}
        />
      </div>
    </PageContainer>
  );
}

function ExportCard({
  icon: Icon,
  title,
  description,
  loading,
  onExport,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  loading: boolean;
  onExport: () => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-5 flex flex-col gap-3">
      <span className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="size-5" />
      </span>
      <div>
        <h3 className="font-bold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Button onClick={onExport} disabled={loading} className="mt-auto w-full">
        <FileDown className="size-4" /> {loading ? 'Gerando…' : 'Exportar CSV'}
      </Button>
    </div>
  );
}
