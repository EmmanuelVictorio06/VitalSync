/**
 * "Minhas Equipes" — Médico Associado (somente leitura). Dados reais do
 * Supabase (RLS restringe às equipes em que o médico participa).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, BellRing, ShieldAlert, Stethoscope, Users } from 'lucide-react';
import { Loading, PageContainer, PageHeader, cn } from '../components/ui';
import { teamViewService, type TeamSummary } from '../services/teamViewService';

export function MyTeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [onlyUnattended, setOnlyUnattended] = useState(false);

  const load = useCallback(async () => {
    setTeams(null);
    setError(null);
    try {
      setTeams(await teamViewService.listMyTeams());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar suas equipes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const t = teams ?? [];
    return {
      teams: t.length,
      monitoring: t.reduce((a, x) => a + x.stats.monitoring, 0),
      attention: t.reduce((a, x) => a + x.stats.attention, 0),
      alert: t.reduce((a, x) => a + x.stats.alert, 0),
      unattended: t.reduce((a, x) => a + x.stats.unattendedAlerts, 0),
    };
  }, [teams]);

  const filtered = (teams ?? []).filter(
    (t) =>
      (!number || String(t.number).includes(number.replace(/^0+/, '') || number)) &&
      (!onlyUnattended || t.stats.unattendedAlerts > 0),
  );

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Minhas Equipes"
        subtitle="Visualize as equipes médicas em que você está associado e acompanhe os pacientes vinculados a cada uma."
      />

      {teams && !error && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
          <SummaryCard label="Equipes vinculadas" value={summary.teams} icon={Users} tone="primary" />
          <SummaryCard label="Em monitoramento" value={summary.monitoring} icon={Activity} tone="primary" />
          <SummaryCard label="Em atenção" value={summary.attention} icon={AlertTriangle} tone="warning" />
          <SummaryCard label="Em alerta" value={summary.alert} icon={ShieldAlert} tone="alert" />
          <SummaryCard label="Alertas não atendidos" value={summary.unattended} icon={BellRing} tone="alert" />
        </div>
      )}

      {teams && teams.length > 0 && (
        <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            value={number}
            inputMode="numeric"
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Buscar por nº da equipe…"
            className="input !w-auto sm:w-44"
          />
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" className="accent-[#2563eb] size-4" checked={onlyUnattended} onChange={(e) => setOnlyUnattended(e.target.checked)} />
            Só com alertas não atendidos
          </label>
        </div>
      )}

      {teams === null ? (
        <Loading label="Carregando suas equipes…" />
      ) : error ? (
        <div className="bg-card border border-alert/30 rounded-xl p-10 text-center">
          <p className="font-semibold">{error}</p>
          <button onClick={() => void load()} className="mt-4 px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted">
            Tentar novamente
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold">Você ainda não está associado a nenhuma equipe médica.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 animate-entry">
          {filtered.map((t) => (
            <article key={t.id} className="bg-card border border-border rounded-xl shadow-sm p-5 flex flex-col gap-4 border-l-4 border-l-primary">
              <header>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Equipe nº {String(t.number).padStart(2, '0')}
                </p>
                <h3 className="font-bold text-lg leading-tight mt-0.5 inline-flex items-center gap-1.5">
                  <Stethoscope className="size-4 text-primary shrink-0" /> {t.surgeonName}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Você é Médico Associado</p>
              </header>

              <ul className="text-sm space-y-1.5 border-y border-border py-3">
                <li className="flex items-center gap-2">
                  <Activity className="size-4 text-primary shrink-0" />
                  <span><strong className="font-extrabold">{t.stats.monitoring}</strong> pacientes em monitoramento</span>
                </li>
                <li className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4 shrink-0" /> <span><strong className="font-extrabold">{t.stats.attention}</strong> em atenção</span>
                </li>
                <li className="flex items-center gap-2 text-alert">
                  <ShieldAlert className="size-4 shrink-0" /> <span><strong className="font-extrabold">{t.stats.alert}</strong> em alerta</span>
                </li>
              </ul>

              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border self-start',
                  t.stats.unattendedAlerts === 0 ? 'bg-stable/10 text-stable border-stable/20' : 'bg-alert/10 text-alert border-alert/20',
                )}
              >
                <BellRing className="size-3" />
                {t.stats.unattendedAlerts === 0 ? 'Sem pendências' : `${t.stats.unattendedAlerts} não atendido(s)`}
              </span>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => navigate(`/monitoring?team=${t.number}`)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors">
                  <Activity className="size-3.5" /> Ver pacientes
                </button>
                <button onClick={() => navigate(`/alerts?team=${t.number}`)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs font-semibold hover:bg-muted transition-colors">
                  <BellRing className="size-3.5" /> Ver alertas
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function SummaryCard({
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'primary' | 'warning' | 'alert';
}) {
  const cls = { primary: 'bg-primary/10 text-primary', warning: 'bg-warning/10 text-warning', alert: 'bg-alert/10 text-alert' }[tone];
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4 flex items-center gap-3">
      <span className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', cls)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{label}</p>
      </div>
    </div>
  );
}
