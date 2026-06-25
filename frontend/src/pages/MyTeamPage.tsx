/**
 * "Minha Equipe" — Cirurgião Principal. Dados reais do Supabase (a equipe em
 * que ele é o responsável). Visualização da equipe, médicos e pacientes.
 *
 * Obs.: criar/remover CONTAS de médico exige privilégio de admin (Edge
 * Function/painel do Supabase) — fica para uma fase futura. Aqui é leitura.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, BellRing, Calendar, Mail, MessageCircle, Stethoscope, Users } from 'lucide-react';
import { formatCivilDate, formatPhoneBR } from '@vitalsync/shared';
import { Button, PageContainer, PageHeader, StatusBadge, cn, statusBorder } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/admin';
import { teamViewService, type TeamDetail } from '../services/teamViewService';

function whatsappUrl(digits: string | null): string | null {
  const clean = (digits ?? '').replace(/\D/g, '');
  return clean ? `https://wa.me/55${clean}` : null;
}

export function MyTeamPage() {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await teamViewService.getMyMainTeam());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar sua equipe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageContainer><LoadingState label="Carregando dados da sua equipe…" /></PageContainer>;
  if (error) return <PageContainer><ErrorState message={error} onRetry={() => void load()} /></PageContainer>;
  if (!detail) return <PageContainer><EmptyState title="Nenhuma equipe vinculada ao seu usuário." /></PageContainer>;

  const { summary, members, patients } = detail;
  const associates = members.filter((m) => !m.isSurgeon);
  const cards: Array<{ label: string; value: number; tone?: string }> = [
    { label: 'Médicos associados', value: associates.length },
    { label: 'Em monitoramento', value: summary.stats.monitoring },
    { label: 'Estáveis', value: summary.stats.stable, tone: 'text-stable' },
    { label: 'Em atenção', value: summary.stats.attention, tone: 'text-warning' },
    { label: 'Em alerta', value: summary.stats.alert, tone: 'text-alert' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Minha Equipe"
        subtitle="Visualize os médicos associados à sua equipe e acompanhe os pacientes vinculados."
      />

      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:100ms]">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Equipe nº {String(summary.number).padStart(2, '0')}
            </p>
            <h3 className="font-bold text-lg mt-0.5 inline-flex items-center gap-1.5">
              <Stethoscope className="size-4 text-primary" /> {summary.surgeonName}
            </h3>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/monitoring?team=${summary.number}`)}>
              <Activity className="size-3.5" /> Ver pacientes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/alerts?team=${summary.number}`)}>
              <BellRing className="size-3.5" /> Ver alertas
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 border-t border-border pt-4">
          {cards.map((c) => (
            <div key={c.label}>
              <p className={cn('text-2xl font-extrabold leading-none', c.tone ?? 'text-foreground')}>{c.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{c.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:150ms]">
        <h3 className="font-bold tracking-tight inline-flex items-center gap-2">
          <Users className="size-4 text-primary" /> Médicos da Equipe
        </h3>
        <ul className="space-y-2">
          {members.map((m) => {
            const wa = whatsappUrl(m.whatsapp);
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {m.name}
                    {m.isSurgeon && <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">Responsável</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate inline-flex items-center gap-1">
                    <Mail className="size-3" /> {m.email}
                    {m.whatsapp && <span className="ml-2">{formatPhoneBR(m.whatsapp)}</span>}
                  </p>
                </div>
                {wa && (
                  <a href={wa} target="_blank" rel="noreferrer" className="size-8 rounded-md border border-border text-[#25D366] hover:bg-muted flex items-center justify-center" aria-label={`WhatsApp de ${m.name}`}>
                    <MessageCircle className="size-4" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4 animate-entry [animation-delay:200ms]">
        <h3 className="font-bold tracking-tight inline-flex items-center gap-2">
          <Activity className="size-4 text-primary" /> Pacientes em monitoramento
        </h3>
        {patients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum paciente vinculado.</p>
        ) : (
          <ul className="space-y-2">
            {patients.map((p) => (
              <li key={p.id} className={cn('flex items-center justify-between gap-3 bg-card border border-border rounded-lg p-3 border-l-4', statusBorder(p.status))}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.surgeryType}</p>
                  {p.dischargeDate && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                      <Calendar className="size-3" /> Alta {formatCivilDate(p.dischargeDate)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={p.status} />
                  <button onClick={() => navigate(`/patients/${p.id}`)} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary/90">
                    Acompanhar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
