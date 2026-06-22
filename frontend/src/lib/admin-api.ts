/**
 * Serviços da seção Administração.
 *
 * CRUDs e configurações usam um repositório MOCK em memória (com latência
 * simulada e as mesmas regras de negócio esperadas do servidor). Cada função
 * indica o endpoint REST correspondente para a integração futura — basta
 * trocar o corpo por `api.get/post/patch/del` mantendo assinatura e tipos.
 *
 * A exportação de dados usa o endpoint REAL (`GET /api/export`).
 */
import type {
  AuditEvent,
  AuditFilters,
  ExportDataset,
  ExportFilters,
  ExportFormat,
  ExportHistoryItem,
  GeneralSettings,
  Hospital,
  HospitalInput,
  SecuritySettings,
  SurgeryTypeAdmin,
  SurgeryTypeInput,
  WhatsAppSettings,
} from './admin-types';

const LATENCY_MS = 350;
const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));
const id = () => Math.random().toString(36).slice(2, 10);

export class AdminApiError extends Error {}

/* =====================================================================
   HOSPITAIS — futuro: GET/POST /api/admin/hospitals, PATCH/DELETE /:id
   ===================================================================== */

let hospitals: Hospital[] = [
  { id: 'h1', name: 'Hospital Marcelino Champagnat', city: 'Curitiba', state: 'PR', phone: '(41) 3240-3000', status: 'ACTIVE', createdAt: '2026-03-02', linkedPatients: 12 },
  { id: 'h2', name: 'Hospital Universitário Cajuru', city: 'Curitiba', state: 'PR', phone: '(41) 3271-3000', status: 'ACTIVE', createdAt: '2026-03-02', linkedPatients: 8 },
  { id: 'h3', name: 'Hospital de Clínicas - UFPR', city: 'Curitiba', state: 'PR', status: 'ACTIVE', createdAt: '2026-03-10', linkedPatients: 15 },
  { id: 'h4', name: 'Hospital Nossa Senhora das Graças', city: 'Curitiba', state: 'PR', status: 'ACTIVE', createdAt: '2026-04-01', linkedPatients: 5 },
  { id: 'h5', name: 'Hospital Santa Cruz', city: 'Curitiba', state: 'PR', status: 'INACTIVE', createdAt: '2026-04-18', linkedPatients: 0 },
];

export const hospitalsApi = {
  async list(): Promise<Hospital[]> {
    await delay();
    return [...hospitals];
  },

  async create(input: HospitalInput): Promise<Hospital> {
    await delay();
    if (!input.name.trim()) throw new AdminApiError('Erro ao salvar hospital. Verifique os campos obrigatórios.');
    const dup = hospitals.some(
      (h) =>
        h.status === 'ACTIVE' &&
        input.status === 'ACTIVE' &&
        h.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
        h.city.trim().toLowerCase() === input.city.trim().toLowerCase(),
    );
    if (dup) throw new AdminApiError('Já existe um hospital ativo com este nome nesta cidade.');
    const created: Hospital = { ...input, id: id(), createdAt: new Date().toISOString().slice(0, 10), linkedPatients: 0 };
    hospitals = [created, ...hospitals];
    return created;
  },

  async update(hid: string, input: HospitalInput): Promise<Hospital> {
    await delay();
    if (!input.name.trim()) throw new AdminApiError('Erro ao salvar hospital. Verifique os campos obrigatórios.');
    const dup = hospitals.some(
      (h) =>
        h.id !== hid &&
        h.status === 'ACTIVE' &&
        input.status === 'ACTIVE' &&
        h.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
        h.city.trim().toLowerCase() === input.city.trim().toLowerCase(),
    );
    if (dup) throw new AdminApiError('Já existe um hospital ativo com este nome nesta cidade.');
    hospitals = hospitals.map((h) => (h.id === hid ? { ...h, ...input } : h));
    return hospitals.find((h) => h.id === hid)!;
  },

  async toggleStatus(hid: string): Promise<Hospital> {
    await delay();
    hospitals = hospitals.map((h) =>
      h.id === hid ? { ...h, status: h.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : h,
    );
    return hospitals.find((h) => h.id === hid)!;
  },

  /** Hospitais vinculados a pacientes são INATIVADOS em vez de excluídos. */
  async remove(hid: string): Promise<{ inactivated: boolean }> {
    await delay();
    const target = hospitals.find((h) => h.id === hid);
    if (!target) throw new AdminApiError('Hospital não encontrado.');
    if (target.linkedPatients > 0) {
      hospitals = hospitals.map((h) => (h.id === hid ? { ...h, status: 'INACTIVE' } : h));
      return { inactivated: true };
    }
    hospitals = hospitals.filter((h) => h.id !== hid);
    return { inactivated: false };
  },
};

/* =====================================================================
   TIPOS DE CIRURGIA — futuro: /api/admin/surgery-types
   ===================================================================== */

let surgeryTypes: SurgeryTypeAdmin[] = [
  { id: 's1', name: 'Colecistectomia', specialty: 'Cirurgia Geral', description: 'Remoção da vesícula biliar.', status: 'ACTIVE', createdAt: '2026-03-02', linkedPatients: 9 },
  { id: 's2', name: 'Apendicectomia', specialty: 'Cirurgia Geral', description: 'Remoção do apêndice.', status: 'ACTIVE', createdAt: '2026-03-02', linkedPatients: 6 },
  { id: 's3', name: 'Artroplastia de joelho', specialty: 'Ortopedia', description: 'Substituição da articulação do joelho.', status: 'ACTIVE', createdAt: '2026-03-15', linkedPatients: 7 },
  { id: 's4', name: 'Cesariana', specialty: 'Obstetrícia', status: 'ACTIVE', createdAt: '2026-03-15', linkedPatients: 4 },
  { id: 's5', name: 'Bariátrica', specialty: 'Cirurgia Geral', description: 'Redução de estômago.', status: 'ACTIVE', createdAt: '2026-04-05', linkedPatients: 3 },
  { id: 's6', name: 'Herniorrafia', specialty: 'Cirurgia Geral', description: 'Correção de hérnia.', status: 'INACTIVE', createdAt: '2026-04-20', linkedPatients: 0 },
];

export const surgeryTypesApi = {
  async list(): Promise<SurgeryTypeAdmin[]> {
    await delay();
    return [...surgeryTypes];
  },

  async create(input: SurgeryTypeInput): Promise<SurgeryTypeAdmin> {
    await delay();
    if (!input.name.trim()) throw new AdminApiError('Erro ao salvar tipo de cirurgia. Verifique os campos obrigatórios.');
    if (surgeryTypes.some((s) => s.name.trim().toLowerCase() === input.name.trim().toLowerCase()))
      throw new AdminApiError('Já existe um tipo de cirurgia com este nome.');
    const created: SurgeryTypeAdmin = { ...input, id: id(), createdAt: new Date().toISOString().slice(0, 10), linkedPatients: 0 };
    surgeryTypes = [created, ...surgeryTypes];
    return created;
  },

  async update(sid: string, input: SurgeryTypeInput): Promise<SurgeryTypeAdmin> {
    await delay();
    if (!input.name.trim()) throw new AdminApiError('Erro ao salvar tipo de cirurgia. Verifique os campos obrigatórios.');
    if (surgeryTypes.some((s) => s.id !== sid && s.name.trim().toLowerCase() === input.name.trim().toLowerCase()))
      throw new AdminApiError('Já existe um tipo de cirurgia com este nome.');
    surgeryTypes = surgeryTypes.map((s) => (s.id === sid ? { ...s, ...input } : s));
    return surgeryTypes.find((s) => s.id === sid)!;
  },

  async toggleStatus(sid: string): Promise<SurgeryTypeAdmin> {
    await delay();
    surgeryTypes = surgeryTypes.map((s) =>
      s.id === sid ? { ...s, status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : s,
    );
    return surgeryTypes.find((s) => s.id === sid)!;
  },

  async remove(sid: string): Promise<{ inactivated: boolean }> {
    await delay();
    const target = surgeryTypes.find((s) => s.id === sid);
    if (!target) throw new AdminApiError('Tipo de cirurgia não encontrado.');
    if (target.linkedPatients > 0) {
      surgeryTypes = surgeryTypes.map((s) => (s.id === sid ? { ...s, status: 'INACTIVE' } : s));
      return { inactivated: true };
    }
    surgeryTypes = surgeryTypes.filter((s) => s.id !== sid);
    return { inactivated: false };
  },
};

/* =====================================================================
   CONFIGURAÇÕES — futuro: GET/PUT /api/admin/settings/{general|whatsapp|security}
   Valores iniciais espelham o .env e as constantes do @vitalsync/shared.
   ===================================================================== */

let general: GeneralSettings = {
  systemName: 'CuraPath',
  supportEmail: 'suporte@curapath.com.br',
  supportPhone: '(41) 3000-0000',
  monitoringDays: 10,
  timezone: 'America/Sao_Paulo',
  language: 'Português (Brasil)',
};

let whatsapp: WhatsAppSettings = {
  provider: 'log',
  apiTokenMasked: '',
  senderNumber: '',
  integrationActive: false,
  templateYellow: 'Atenção! O paciente {{nomePaciente}} apresentou status de atenção. Verifique no app.',
  templateRed: 'Alerta! O paciente {{nomePaciente}} apresentou alteração crítica. Verifique no app imediatamente.',
};

let security: SecuritySettings = {
  sessionExpiry: '8h',
  passwordMinLength: 6,
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  patientLinkGraceHours: 24,
  allowResendSamePeriod: false,
  confirmBeforeDelete: true,
};

/** Mascara o token mantendo apenas os 4 últimos caracteres. */
function maskToken(token: string): string {
  if (!token) return '';
  return `••••••••${token.slice(-4)}`;
}

export const settingsApi = {
  async getGeneral(): Promise<GeneralSettings> {
    await delay();
    return { ...general };
  },
  async saveGeneral(input: GeneralSettings): Promise<GeneralSettings> {
    await delay();
    if (!input.systemName.trim() || input.monitoringDays < 1)
      throw new AdminApiError('Verifique os campos obrigatórios antes de salvar.');
    general = { ...input };
    return { ...general };
  },

  async getWhatsApp(): Promise<WhatsAppSettings> {
    await delay();
    return { ...whatsapp };
  },
  async saveWhatsApp(input: Omit<WhatsAppSettings, 'apiTokenMasked'> & { apiToken?: string }): Promise<WhatsAppSettings> {
    await delay();
    whatsapp = {
      provider: input.provider,
      apiTokenMasked: input.apiToken ? maskToken(input.apiToken) : whatsapp.apiTokenMasked,
      senderNumber: input.senderNumber,
      integrationActive: input.integrationActive,
      templateYellow: input.templateYellow,
      templateRed: input.templateRed,
    };
    return { ...whatsapp };
  },
  async testWhatsApp(): Promise<{ ok: boolean; detail: string }> {
    await delay();
    if (whatsapp.provider === 'log') return { ok: true, detail: 'Provedor "log": mensagem registrada no console do servidor.' };
    if (!whatsapp.apiTokenMasked) return { ok: false, detail: 'Configure o token do provedor antes de testar.' };
    return { ok: true, detail: 'Mensagem de teste enviada ao número remetente.' };
  },

  async getSecurity(): Promise<SecuritySettings> {
    await delay();
    return { ...security };
  },
  async saveSecurity(input: SecuritySettings): Promise<SecuritySettings> {
    await delay();
    security = { ...input };
    return { ...security };
  },
};

/* =====================================================================
   AUDITORIA — futuro: GET /api/admin/audit?user=&action=&from=&to=&entity=
   ===================================================================== */

const auditEvents: AuditEvent[] = [
  { id: 'e1', datetime: '2026-06-12 09:14', userName: 'Sistema', userRole: 'Automático', action: 'ALERT_GENERATED', entity: 'Paciente · Ana Souza', origin: 'motor clínico' },
  { id: 'e2', datetime: '2026-06-12 08:55', userName: 'Dra. Drica', userRole: 'Cirurgião Principal', action: 'PATIENT_ATTENDED', entity: 'Paciente · Ana Souza', origin: '192.168.0.12' },
  { id: 'e3', datetime: '2026-06-12 08:31', userName: 'Administrador', userRole: 'Administrador Geral', action: 'DATA_EXPORT', entity: 'Exportação · pacientes (xlsx)', origin: '192.168.0.4' },
  { id: 'e4', datetime: '2026-06-12 08:02', userName: 'Administrador', userRole: 'Administrador Geral', action: 'LOGIN', entity: 'Sessão', origin: '192.168.0.4' },
  { id: 'e5', datetime: '2026-06-11 22:10', userName: 'Ana Souza', userRole: 'Paciente (link)', action: 'VITALS_RECORD', entity: 'Medição · D+4 noite', origin: 'link público' },
  { id: 'e6', datetime: '2026-06-11 18:45', userName: 'Administrador', userRole: 'Administrador Geral', action: 'SETTINGS_CHANGE', entity: 'Configurações · WhatsApp', origin: '192.168.0.4' },
  { id: 'e7', datetime: '2026-06-11 16:20', userName: 'Dr. House', userRole: 'Cirurgião Principal', action: 'PATIENT_CREATE', entity: 'Paciente · Carlos Lima', origin: '192.168.0.33' },
  { id: 'e8', datetime: '2026-06-11 15:58', userName: 'Administrador', userRole: 'Administrador Geral', action: 'TEAM_UPDATE', entity: 'Equipe nº 2', origin: '192.168.0.4' },
  { id: 'e9', datetime: '2026-06-11 10:31', userName: 'Administrador', userRole: 'Administrador Geral', action: 'TEAM_CREATE', entity: 'Equipe nº 2', origin: '192.168.0.4' },
  { id: 'e10', datetime: '2026-06-10 21:03', userName: 'Beatriz Rocha', userRole: 'Paciente (link)', action: 'VITALS_RECORD', entity: 'Medição · D+6 noite', origin: 'link público' },
  { id: 'e11', datetime: '2026-06-10 14:12', userName: 'Administrador', userRole: 'Administrador Geral', action: 'DELETE_OR_INACTIVATE', entity: 'Hospital · Hospital Santa Cruz', origin: '192.168.0.4' },
  { id: 'e12', datetime: '2026-06-10 09:40', userName: 'Dra. Drica', userRole: 'Cirurgião Principal', action: 'LOGIN', entity: 'Sessão', origin: '192.168.0.12' },
];

export const auditApi = {
  async list(filters: AuditFilters): Promise<AuditEvent[]> {
    await delay();
    return auditEvents.filter((e) => {
      if (filters.user && !e.userName.toLowerCase().includes(filters.user.toLowerCase())) return false;
      if (filters.action && e.action !== filters.action) return false;
      if (filters.entity && !e.entity.toLowerCase().includes(filters.entity.toLowerCase())) return false;
      const day = e.datetime.slice(0, 10);
      if (filters.fromDate && day < filters.fromDate) return false;
      if (filters.toDate && day > filters.toDate) return false;
      return true;
    });
  },
};

/* =====================================================================
   HISTÓRICO DE EXPORTAÇÕES — futuro: GET /api/admin/exports/history
   (a auditoria da exportação em si é registrada pelo backend)
   ===================================================================== */

let exportHistory: ExportHistoryItem[] = [
  { id: 'x1', datetime: '2026-06-12 08:31', userName: 'Administrador', dataset: 'PATIENTS', filtersSummary: 'Status: Alerta', format: 'xlsx', status: 'DONE' },
  { id: 'x2', datetime: '2026-06-10 17:05', userName: 'Administrador', dataset: 'FULL', filtersSummary: 'Período: 01/06–10/06', format: 'csv', status: 'DONE' },
];

export const exportHistoryApi = {
  async list(): Promise<ExportHistoryItem[]> {
    await delay();
    return [...exportHistory];
  },
  async add(item: Omit<ExportHistoryItem, 'id'>): Promise<ExportHistoryItem> {
    const created: ExportHistoryItem = { ...item, id: id() };
    exportHistory = [created, ...exportHistory];
    return created;
  },
};

export type { ExportDataset, ExportFilters, ExportFormat };
