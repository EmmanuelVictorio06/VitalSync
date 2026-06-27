/**
 * Exportações (Admin) — geram CSV no cliente a partir do Supabase (RLS aplica o
 * escopo). Formato pt-BR (UTF-8 BOM, separador ';', datas dd/mm/aaaa) centralizado
 * em services/exportService. Pacientes excluídos ficam ocultos por padrão;
 * o Admin pode incluir os arquivados.
 */
import { useState } from 'react';
import { Activity, Bell, FileDown, Users, UserCog } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { AdminPageHeader, ToggleSwitch } from '../../components/admin';
import { Button, PageContainer } from '../../components/ui';
import { exportService } from '../../services/exportService';

export function ExportsPage() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  async function run(key: string, fn: () => Promise<number>, noun: string) {
    setBusy(key);
    try {
      const n = await fn();
      toast.success(`${n} ${noun} exportado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar.');
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

      <div className="bg-card border border-border rounded-xl shadow-sm p-4 mb-4 animate-entry">
        <ToggleSwitch
          checked={includeArchived}
          onChange={setIncludeArchived}
          label="Incluir pacientes arquivados (excluídos)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Por padrão os pacientes excluídos ficam ocultos. Marque para incluí-los na exportação de pacientes.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 animate-entry [animation-delay:100ms]">
        <ExportCard
          icon={Activity}
          title="Pacientes"
          description="Lista de pacientes com status, cirurgia, hospital e equipe."
          loading={busy === 'patients'}
          onExport={() => run('patients', () => exportService.patients({ includeArchived }), 'paciente(s)')}
        />
        <ExportCard
          icon={Bell}
          title="Alertas clínicos"
          description="Alertas gerados pelas medições, com status, descrição e atendimento."
          loading={busy === 'alerts'}
          onExport={() => run('alerts', () => exportService.alerts(), 'alerta(s)')}
        />
        <ExportCard
          icon={Users}
          title="Equipes médicas"
          description="Equipes cadastradas, com status e data de criação."
          loading={busy === 'teams'}
          onExport={() => run('teams', () => exportService.teams(), 'equipe(s)')}
        />
        <ExportCard
          icon={UserCog}
          title="Usuários"
          description="Usuários do painel, com papel, status e contato."
          loading={busy === 'users'}
          onExport={() => run('users', () => exportService.users(), 'usuário(s)')}
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
