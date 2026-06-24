/**
 * Configurações do sistema (Geral/WhatsApp/Segurança) e Auditoria, no Supabase.
 * Settings ficam em `app_settings` (jsonb por seção, só ADMIN). Auditoria em
 * `audit_logs` (preenchida por triggers). Espelha a interface do mock antigo.
 */
import { supabase } from '../lib/supabase';
import type {
  AuditEvent,
  AuditFilters,
  GeneralSettings,
  SecuritySettings,
  WhatsAppSettings,
} from '../lib/admin-types';

const DEFAULT_GENERAL: GeneralSettings = {
  systemName: 'VitalSync',
  supportEmail: 'suporte@vitalsync.com.br',
  supportPhone: '(41) 3000-0000',
  monitoringDays: 10,
  timezone: 'America/Sao_Paulo',
  language: 'Português (Brasil)',
};

const DEFAULT_WHATSAPP: WhatsAppSettings = {
  provider: 'log',
  apiTokenMasked: '',
  senderNumber: '',
  integrationActive: false,
  templateYellow: 'Atenção! O paciente {{nomePaciente}} apresentou status de atenção. Verifique no app.',
  templateRed: 'Alerta! O paciente {{nomePaciente}} apresentou alteração crítica. Verifique no app imediatamente.',
};

const DEFAULT_SECURITY: SecuritySettings = {
  sessionExpiry: '8h',
  passwordMinLength: 6,
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  patientLinkGraceHours: 24,
  allowResendSamePeriod: false,
  confirmBeforeDelete: true,
};

async function readSection<T>(section: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.from('app_settings').select('data').eq('section', section).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ...fallback, ...(data.data as Partial<T>) } : fallback;
}

async function writeSection(section: string, data: unknown): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ section, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

function maskToken(token: string): string {
  return token ? `••••••••${token.slice(-4)}` : '';
}

export const settingsService = {
  getGeneral: () => readSection('general', DEFAULT_GENERAL),
  saveGeneral: (s: GeneralSettings) => writeSection('general', s),

  getSecurity: () => readSection('security', DEFAULT_SECURITY),
  saveSecurity: (s: SecuritySettings) => writeSection('security', s),

  getWhatsApp: () => readSection('whatsapp', DEFAULT_WHATSAPP),
  async saveWhatsApp(input: Omit<WhatsAppSettings, 'apiTokenMasked'> & { apiToken?: string }): Promise<WhatsAppSettings> {
    const current = await readSection('whatsapp', DEFAULT_WHATSAPP);
    const next: WhatsAppSettings = {
      provider: input.provider,
      apiTokenMasked: input.apiToken ? maskToken(input.apiToken) : current.apiTokenMasked,
      senderNumber: input.senderNumber,
      integrationActive: input.integrationActive,
      templateYellow: input.templateYellow,
      templateRed: input.templateRed,
    };
    await writeSection('whatsapp', next);
    return next;
  },
  async testWhatsApp(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'Provedor "log": o envio real será feito por Edge Function no futuro.' };
  },

  async listAudit(filters: AuditFilters): Promise<AuditEvent[]> {
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    if (filters.user) q = q.ilike('actor_name', `%${filters.user}%`);
    if (filters.action) q = q.eq('action', filters.action);
    if (filters.entity) q = q.ilike('entity', `%${filters.entity}%`);
    if (filters.fromDate) q = q.gte('created_at', filters.fromDate);
    if (filters.toDate) q = q.lte('created_at', `${filters.toDate}T23:59:59`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string; actor_name: string; actor_role: string; action: string; entity: string | null; created_at: string }>).map((r) => ({
      id: r.id,
      datetime: new Date(r.created_at).toLocaleString('pt-BR'),
      userName: r.actor_name,
      userRole: r.actor_role,
      action: r.action as AuditEvent['action'],
      entity: r.entity ?? '—',
    }));
  },
};
