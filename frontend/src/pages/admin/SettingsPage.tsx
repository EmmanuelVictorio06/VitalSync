import { useEffect, useState } from 'react';
import { CheckCircle2, FlaskConical, Send, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import {
  ALERT_THRESHOLDS,
  BINARY_RULES,
  ClinicalStatus,
  STEPS_RULES,
  type RangeRule,
  type VitalThreshold,
} from '@vitalsync/shared';
import { useToast } from '../../components/Toast';
import {
  AdminPageHeader,
  AdminTable,
  LoadingState,
  SettingsSection,
  ToggleSwitch,
} from '../../components/admin';
import { Button, ConfirmModal, Field, PageContainer, SelectField, TextInput, cn } from '../../components/ui';
import { settingsService } from '../../services/settingsService';
import { homologationService, type HomologationStats } from '../../services/homologationService';
import {
  AUDIT_ACTION_LABEL,
  type AuditAction,
  type AuditEvent,
  type AuditFilters,
  type GeneralSettings,
  type SecuritySettings,
  type WhatsAppSettings,
} from '../../lib/admin-types';

type Tab = 'general' | 'clinical' | 'whatsapp' | 'homologation' | 'security' | 'audit';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'Geral' },
  { id: 'clinical', label: 'Regras Clínicas' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'homologation', label: 'Homologação' },
  { id: 'security', label: 'Segurança' },
  { id: 'audit', label: 'Auditoria' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <PageContainer>
      <AdminPageHeader
        title="Configurações"
        subtitle="Ajuste regras gerais, clínicas, integrações e segurança do sistema sem alterar o código."
      />

      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto animate-entry [animation-delay:50ms]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-md text-xs font-semibold whitespace-nowrap transition-colors',
              tab === t.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="animate-entry [animation-delay:100ms]">
        {tab === 'general' && <GeneralTab />}
        {tab === 'clinical' && <ClinicalTab />}
        {tab === 'whatsapp' && <WhatsAppTab />}
        {tab === 'homologation' && <HomologationTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </PageContainer>
  );
}

/* =====================================================================
   ABA 1 — GERAL
   ===================================================================== */
function GeneralTab() {
  const toast = useToast();
  const [form, setForm] = useState<GeneralSettings | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void settingsService.getGeneral().then(setForm);
  }, []);

  if (!form) return <LoadingState label="Carregando configurações…" />;

  function set<K extends keyof GeneralSettings>(k: K, v: GeneralSettings[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await settingsService.saveGeneral(form);
      toast.success('Configurações gerais salvas.');
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Configurações Gerais" description="Identidade e parâmetros padrão do sistema.">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextInput label="Nome do sistema" required value={form.systemName} onChange={(e) => set('systemName', e.target.value)} />
          <Field label="Logo do sistema (opcional)" hint="Upload disponível após integração com armazenamento de arquivos.">
            <input type="file" accept="image/*" className="input file:mr-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-primary/10 file:text-primary file:text-xs file:font-semibold" disabled />
          </Field>
          <TextInput label="E-mail de suporte" type="email" value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
          <TextInput label="Telefone de suporte" value={form.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} />
          <TextInput
            label="Tempo padrão de monitoramento pós-alta (dias)"
            type="number"
            min={1}
            hint="Padrão clínico inicial: 10 dias."
            value={String(form.monitoringDays)}
            onChange={(e) => set('monitoringDays', Number(e.target.value))}
          />
          <SelectField
            label="Fuso horário do sistema"
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            options={[
              { value: 'America/Sao_Paulo', label: 'América/São Paulo (GMT-3)' },
              { value: 'America/Manaus', label: 'América/Manaus (GMT-4)' },
              { value: 'America/Rio_Branco', label: 'América/Rio Branco (GMT-5)' },
            ]}
            placeholder="Selecione"
          />
          <SelectField
            label="Idioma padrão"
            value={form.language}
            onChange={(e) => set('language', e.target.value)}
            options={[{ value: 'Português (Brasil)', label: 'Português (Brasil)' }]}
            placeholder="Selecione"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={() => setConfirming(true)}>Salvar alterações</Button>
        </div>
      </SettingsSection>

      {confirming && (
        <ConfirmModal
          title="Salvar configurações gerais?"
          message={`O tempo de monitoramento pós-alta ficará em ${form.monitoringDays} dia(s). As mudanças valem para novos cadastros.`}
          confirmLabel="Salvar"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={save}
        />
      )}
    </div>
  );
}

/* =====================================================================
   ABA 2 — REGRAS CLÍNICAS E ALERTAS
   Lê os limiares REAIS de @vitalsync/shared (ponto único de manutenção).
   ===================================================================== */

const STATUS_LABEL: Record<ClinicalStatus, { label: string; dot: string }> = {
  GREEN: { label: 'Normal', dot: 'bg-stable' },
  YELLOW: { label: 'Atenção', dot: 'bg-warning' },
  RED: { label: 'Alerta', dot: 'bg-alert' },
};

const fmtNum = (n: number) => n.toLocaleString('pt-BR');

function formatRule(rule: RangeRule): string {
  if (rule.min != null && rule.max != null)
    return rule.min === rule.max ? `= ${fmtNum(rule.min)}` : `${fmtNum(rule.min)} – ${fmtNum(rule.max)}`;
  if (rule.min != null) return `≥ ${fmtNum(rule.min)}`;
  if (rule.max != null) return `≤ ${fmtNum(rule.max)}`;
  return '—';
}

function PendingBadge() {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-warning/10 text-warning border border-warning/20">
      Pendente de validação médica
    </span>
  );
}

function ClinicalRuleCard({
  title,
  pending,
  note,
  children,
}: {
  title: string;
  pending?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="font-bold">{title}</h4>
        <div className="flex items-center gap-2">
          {pending && <PendingBadge />}
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-stable/10 text-stable border border-stable/20">
            Ativa
          </span>
        </div>
      </div>
      {children}
      {note && <p className="text-xs text-muted-foreground border-t border-border pt-3">Observação: {note}</p>}
    </div>
  );
}

function RuleRows({ threshold }: { threshold: VitalThreshold }) {
  return (
    <ul className="space-y-1.5">
      {threshold.rules.map((r, i) => (
        <li key={i} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', STATUS_LABEL[r.status].dot)} />
            {STATUS_LABEL[r.status].label}
          </span>
          <span className="font-mono font-semibold">{formatRule(r)}</span>
        </li>
      ))}
    </ul>
  );
}

function ClinicalTab() {
  const thresholds = Object.values(ALERT_THRESHOLDS) as VitalThreshold[];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 bg-warning/10 border border-warning/20 rounded-xl p-4 text-sm">
        <ShieldAlert className="size-5 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Os limites clínicos devem ser definidos ou validados por profissional de saúde responsável.</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Os valores abaixo vêm do ponto único de manutenção (<code className="font-mono">@vitalsync/shared</code>). Regras
            marcadas como pendentes usam faixas provisórias e poderão ser editadas pelo Administrador autorizado quando o
            endpoint de configurações clínicas estiver disponível.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {thresholds.map((t) => (
          <ClinicalRuleCard key={t.label} title={t.label} pending={t.PENDING_MEDICAL_VALIDATION} note={t.pendingNote}>
            <RuleRows threshold={t} />
          </ClinicalRuleCard>
        ))}

        <ClinicalRuleCard title={STEPS_RULES.label}>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-stable" /> Normal</span>
              <span className="font-mono font-semibold">sem redução relevante</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-warning" /> Atenção</span>
              <span className="font-mono font-semibold">queda ≥ {STEPS_RULES.yellowReductionPct * 100}% vs. dia anterior</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-alert" /> Alerta</span>
              <span className="font-mono font-semibold">queda ≥ {STEPS_RULES.redReductionPct * 100}% vs. dia anterior</span>
            </li>
          </ul>
        </ClinicalRuleCard>

        <ClinicalRuleCard title="Vômitos">
          <BinaryRows yes={BINARY_RULES.vomit.yesStatus} no={BINARY_RULES.vomit.noStatus} />
        </ClinicalRuleCard>

        <ClinicalRuleCard title="Sangramento">
          <BinaryRows yes={BINARY_RULES.bleeding.yesStatus} no={BINARY_RULES.bleeding.noStatus} />
        </ClinicalRuleCard>
      </div>
    </div>
  );
}

function BinaryRows({ yes, no }: { yes: ClinicalStatus; no: ClinicalStatus }) {
  return (
    <ul className="space-y-1.5 text-sm">
      <li className="flex items-center justify-between">
        <span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', STATUS_LABEL[no].dot)} /> Não</span>
        <span className="font-mono font-semibold">{STATUS_LABEL[no].label}</span>
      </li>
      <li className="flex items-center justify-between">
        <span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', STATUS_LABEL[yes].dot)} /> Sim</span>
        <span className="font-mono font-semibold">{STATUS_LABEL[yes].label}</span>
      </li>
    </ul>
  );
}

/* =====================================================================
   ABA 3 — WHATSAPP E NOTIFICAÇÕES
   ===================================================================== */
function WhatsAppTab() {
  const toast = useToast();
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [newToken, setNewToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void settingsService.getWhatsApp().then(setSettings);
  }, []);

  if (!settings) return <LoadingState label="Carregando integração…" />;

  function set<K extends keyof WhatsAppSettings>(k: K, v: WhatsAppSettings[K]) {
    setSettings((s) => (s ? { ...s, [k]: v } : s));
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      const saved = await settingsService.saveWhatsApp({ ...settings, apiToken: newToken || undefined });
      setSettings(saved);
      setNewToken('');
      toast.success('Configurações de WhatsApp salvas.');
    } catch {
      toast.error('Erro ao salvar configurações de WhatsApp.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    const res = await settingsService.testWhatsApp();
    (res.ok ? toast.success : toast.error)(res.detail);
    setTesting(false);
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Integração de WhatsApp"
        description="Adapter desacoplado: o provedor pode ser trocado sem alterar o restante do sistema. Pacientes estáveis (verde) não geram alerta automático; alertas amarelos e vermelhos notificam todos os médicos da equipe do paciente."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <SelectField
            label="Provedor de WhatsApp"
            value={settings.provider}
            onChange={(e) => set('provider', e.target.value as WhatsAppSettings['provider'])}
            options={[
              { value: 'log', label: 'Log (desenvolvimento — apenas registra)' },
              { value: 'twilio', label: 'Twilio' },
              { value: 'meta', label: 'Meta (WhatsApp Business)' },
            ]}
            placeholder="Selecione"
          />
          <TextInput
            label="Token / API Key"
            type="password"
            placeholder={settings.apiTokenMasked ? `Salvo: ${settings.apiTokenMasked}` : 'Cole o token do provedor'}
            hint="Por segurança, o token salvo nunca é exibido por completo."
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
          />
          <TextInput
            label="Número remetente (se aplicável)"
            placeholder="+55 41 99999-0000"
            value={settings.senderNumber}
            onChange={(e) => set('senderNumber', e.target.value)}
          />
          <Field label="Status da integração">
            <div className="flex items-center gap-4 pt-1">
              <ToggleSwitch
                checked={settings.integrationActive}
                onChange={(v) => set('integrationActive', v)}
                label={settings.integrationActive ? 'Ativa' : 'Inativa'}
              />
              {settings.integrationActive ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-stable"><CheckCircle2 className="size-3.5" /> Operacional</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><XCircle className="size-3.5" /> Desativada</span>
              )}
            </div>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Templates de mensagem" description="Use {{nomePaciente}} para inserir o nome do paciente.">
        <Field label="Template — alerta amarelo (atenção)">
          <textarea className="input min-h-20 resize-none" value={settings.templateYellow} onChange={(e) => set('templateYellow', e.target.value)} />
        </Field>
        <Field label="Template — alerta vermelho (crítico)">
          <textarea className="input min-h-20 resize-none" value={settings.templateRed} onChange={(e) => set('templateRed', e.target.value)} />
        </Field>
        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <button
            onClick={test}
            disabled={testing}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-semibold hover:bg-muted disabled:opacity-55"
          >
            <Send className="size-4" /> {testing ? 'Enviando…' : 'Testar integração'}
          </button>
          <Button onClick={save} loading={busy}>
            Salvar alterações
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

/* =====================================================================
   ABA — HOMOLOGAÇÃO MÉDICA
   Liga/desliga o modo de teste, gerencia a whitelist de números e permite
   limpar com segurança os dados de teste antes da divulgação oficial.
   ===================================================================== */
function MetricCard({ label, value, tone }: { label: string; value: number; tone?: 'alert' | 'warning' | 'stable' }) {
  const cls = tone === 'alert' ? 'text-alert' : tone === 'warning' ? 'text-warning' : tone === 'stable' ? 'text-stable' : 'text-foreground';
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-extrabold tabular-nums', cls)}>{value}</p>
    </div>
  );
}

function HomologationTab() {
  const toast = useToast();
  const [stats, setStats] = useState<HomologationStats | null>(null);
  const [recipientsText, setRecipientsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingNumbers, setSavingNumbers] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function reload() {
    try {
      const [s, settings] = await Promise.all([homologationService.getStats(), homologationService.getSettings()]);
      setStats(s);
      setRecipientsText(settings.test_recipients.join('\n'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar dados de homologação.');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (!stats) return <LoadingState label="Carregando homologação…" />;

  async function toggleMode(on: boolean) {
    setBusy(true);
    try {
      await homologationService.setMode(on);
      toast.success(on ? 'Modo de homologação ativado.' : 'Modo de homologação desativado.');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar o modo.');
    } finally {
      setBusy(false);
    }
  }

  function parseRecipients(text: string): string[] {
    return [...new Set(text.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean))];
  }

  async function saveRecipients() {
    setSavingNumbers(true);
    try {
      await homologationService.setRecipients(parseRecipients(recipientsText));
      toast.success('Lista de números autorizados salva.');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar a lista.');
    } finally {
      setSavingNumbers(false);
    }
  }

  async function clearData() {
    setBusy(true);
    try {
      const res = await homologationService.clearTestData();
      toast.success(`Dados de teste removidos: ${res.patients_deleted} paciente(s), ${res.logs_deleted} log(s).`);
      setConfirming(false);
      setConfirmText('');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao limpar dados de teste.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 bg-warning/10 border border-warning/20 rounded-xl p-4 text-sm">
        <FlaskConical className="size-5 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Ambiente de homologação médica (semana de testes).</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Com o modo ativo, um aviso "Ambiente de teste" aparece no topo do sistema e o WhatsApp automático só é
            enviado para os números autorizados abaixo. Demais destinatários são registrados como
            <code className="font-mono"> SKIPPED_TEST_MODE</code> (alerta criado, sem envio real).
          </p>
        </div>
      </div>

      <SettingsSection title="Modo de homologação" description="Controla o badge de teste e o bloqueio de envios fora da whitelist.">
        <div className="flex items-center gap-4">
          <ToggleSwitch
            checked={stats.homologation_mode}
            onChange={(v) => void toggleMode(v)}
            label={stats.homologation_mode ? 'Ativo' : 'Inativo'}
          />
          {stats.homologation_mode ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning"><FlaskConical className="size-3.5" /> Em testes</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><CheckCircle2 className="size-3.5" /> Produção</span>
          )}
        </div>
      </SettingsSection>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricCard label="Pacientes de teste" value={stats.test_patients} />
        <MetricCard label="Alertas de teste" value={stats.test_alerts} tone="warning" />
        <MetricCard label="WhatsApps enviados" value={stats.whatsapp_sent} tone="stable" />
        <MetricCard label="Falhas de envio" value={stats.whatsapp_failed} tone="alert" />
        <MetricCard label="Bloqueados (fora da lista)" value={stats.whatsapp_skipped} />
        <MetricCard label="Números autorizados" value={stats.authorized_numbers} />
      </div>

      <SettingsSection
        title="Números autorizados para teste"
        description="Um número por linha (com DDI/DDD, ex.: 5541999990000). Só estes recebem WhatsApp durante a homologação."
      >
        <Field label="Whitelist">
          <textarea
            className="input min-h-28 resize-none font-mono text-sm"
            placeholder={'5541999990000\n5541888880000'}
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button onClick={saveRecipients} loading={savingNumbers}>Salvar lista</Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Limpeza dos dados de teste"
        description="Antes da divulgação oficial, remove com segurança apenas os registros marcados como teste (pacientes fictícios e seus sinais, alertas, atendimentos e logs). Dados reais não são afetados."
      >
        <div className="flex justify-end">
          <button
            onClick={() => setConfirming(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-alert/30 text-alert rounded-lg text-sm font-semibold hover:bg-alert/5"
          >
            <Trash2 className="size-4" /> Limpar dados de teste
          </button>
        </div>
      </SettingsSection>

      {confirming && (
        <ConfirmModal
          title="Limpar dados de teste?"
          message={`Serão removidos ${stats.test_patients} paciente(s) de teste e seus registros associados. Esta ação não pode ser desfeita.`}
          confirmLabel="Limpar dados"
          requireText="LIMPAR"
          busy={busy}
          confirmInput={confirmText}
          onConfirmInputChange={setConfirmText}
          onCancel={() => {
            setConfirming(false);
            setConfirmText('');
          }}
          onConfirm={clearData}
        />
      )}
    </div>
  );
}

/* =====================================================================
   ABA 4 — SEGURANÇA
   ===================================================================== */
function SecurityTab() {
  const toast = useToast();
  const [form, setForm] = useState<SecuritySettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void settingsService.getSecurity().then(setForm);
  }, []);

  if (!form) return <LoadingState label="Carregando segurança…" />;

  function set<K extends keyof SecuritySettings>(k: K, v: SecuritySettings[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await settingsService.saveSecurity(form);
      toast.success('Configurações de segurança salvas.');
    } catch {
      toast.error('Erro ao salvar configurações de segurança.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Acesso e sessão"
        description="O backend valida as permissões em todas as requisições; a interface exibe apenas o que cada perfil pode acessar."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <TextInput label="Tempo de expiração da sessão" hint="Ex.: 8h, 30m." value={form.sessionExpiry} onChange={(e) => set('sessionExpiry', e.target.value)} />
          <TextInput label="Tamanho mínimo de senha" type="number" min={6} value={String(form.passwordMinLength)} onChange={(e) => set('passwordMinLength', Number(e.target.value))} />
          <TextInput label="Máx. tentativas de login" type="number" min={1} value={String(form.maxLoginAttempts)} onChange={(e) => set('maxLoginAttempts', Number(e.target.value))} />
          <TextInput label="Bloqueio após tentativas inválidas (min)" type="number" min={1} value={String(form.lockoutMinutes)} onChange={(e) => set('lockoutMinutes', Number(e.target.value))} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Links de paciente"
        description="Os links são únicos e seguros: o token nunca expõe dados sensíveis na URL e o banco armazena apenas o hash."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <TextInput
            label="Validade extra do link após o monitoramento (horas)"
            type="number"
            min={0}
            value={String(form.patientLinkGraceHours)}
            onChange={(e) => set('patientLinkGraceHours', Number(e.target.value))}
          />
        </div>
        <div className="space-y-3 pt-1">
          <ToggleSwitch
            checked={form.allowResendSamePeriod}
            onChange={(v) => set('allowResendSamePeriod', v)}
            label="Permitir reenvio de medição no mesmo período (manhã/noite)"
          />
          <ToggleSwitch
            checked={form.confirmBeforeDelete}
            onChange={(v) => set('confirmBeforeDelete', v)}
            label="Exigir confirmação antes de exclusões"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>
            Salvar alterações
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

/* =====================================================================
   ABA 5 — AUDITORIA
   ===================================================================== */
function AuditTab() {
  const [filters, setFilters] = useState<AuditFilters>({ action: '' });
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    setEvents(null);
    const t = setTimeout(() => void settingsService.listAudit(filters).then(setEvents), 200);
    return () => clearTimeout(t);
  }, [filters]);

  function set<K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Filtros de auditoria" description="Registros importantes do sistema, do mais recente ao mais antigo.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <TextInput label="Usuário" placeholder="Nome" value={filters.user ?? ''} onChange={(e) => set('user', e.target.value)} />
          <SelectField
            label="Tipo de ação"
            value={filters.action ?? ''}
            onChange={(e) => set('action', e.target.value as AuditAction | '')}
            options={Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label }))}
            placeholder="Todas"
          />
          <TextInput label="Data inicial" type="date" value={filters.fromDate ?? ''} onChange={(e) => set('fromDate', e.target.value)} />
          <TextInput label="Data final" type="date" value={filters.toDate ?? ''} onChange={(e) => set('toDate', e.target.value)} />
          <TextInput label="Entidade afetada" placeholder="Ex. Paciente" value={filters.entity ?? ''} onChange={(e) => set('entity', e.target.value)} />
        </div>
      </SettingsSection>

      {events === null ? (
        <LoadingState label="Carregando auditoria…" />
      ) : events.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <p className="font-semibold text-foreground">Nenhum registro encontrado</p>
          <p className="text-sm mt-1">Ajuste os filtros para ver mais resultados.</p>
        </div>
      ) : (
        <AdminTable
          rows={events}
          keyFor={(e) => e.id}
          columns={[
            { header: 'Data/hora', render: (e) => <span className="font-mono text-xs">{e.datetime}</span> },
            {
              header: 'Usuário',
              render: (e) => (
                <div className="min-w-0">
                  <p className="font-semibold truncate">{e.userName}</p>
                  <p className="text-[10px] text-muted-foreground">{e.userRole}</p>
                </div>
              ),
            },
            { header: 'Ação', render: (e) => AUDIT_ACTION_LABEL[e.action] },
            { header: 'Entidade', render: (e) => <span className="text-xs">{e.entity}</span> },
            {
              header: 'Origem',
              hideOnMobile: true,
              render: (e) => <span className="text-xs text-muted-foreground font-mono">{e.origin ?? '—'}</span>,
            },
          ]}
        />
      )}
    </div>
  );
}
