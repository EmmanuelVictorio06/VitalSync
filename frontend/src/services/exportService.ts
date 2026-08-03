/**
 * Exportações em CSV (camada de serviço, reutilizável).
 *
 * Formato pt-BR (UTF-8 BOM, separador ';', datas dd/mm/aaaa) — ver lib/csv.
 * Cada exportação busca os dados (RLS aplica o escopo do usuário) e dispara o
 * download. Pacientes excluídos ficam OCULTOS por padrão; `includeArchived`
 * (uso administrativo) traz os arquivados com a coluna "Arquivado".
 *
 * Permissões: a tela de Exportações é restrita ao Admin (rota + guard). Estas
 * funções não substituem essa checagem — apenas montam/baixam os dados.
 */
import { csvDate, csvDateTime, downloadCsv, type CsvCell } from '../lib/csv';
import { dbRoleLabelPt } from '../lib/roles';
import { patientService } from './patientService';
import { alertService } from './alertService';
import { teamService } from './teamService';
import { userService } from './userService';
import { adherenceService } from './adherenceService';

const STATUS_LABEL: Record<string, string> = { GREEN: 'Estável', YELLOW: 'Atenção', RED: 'Alerta' };
const ENTITY_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Ativo', INACTIVE: 'Inativo' };
const STUDY_GROUP_LABEL: Record<string, string> = {
  INTERVENTION: 'Intervenção',
  HISTORICAL_CONTROL: 'Controle histórico',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const exportService = {
  /** Pacientes em monitoramento. `includeArchived` adiciona os excluídos (Admin). */
  async patients(opts: { includeArchived?: boolean } = {}): Promise<number> {
    const items = await patientService.list({ includeDeleted: opts.includeArchived });
    const header: CsvCell[] = ['Nome', 'Status', 'Tipo de cirurgia', 'Hospital', 'Equipe', 'Alta hospitalar', 'Coorte'];
    if (opts.includeArchived) header.push('Arquivado');

    const rows: CsvCell[][] = [
      header,
      ...items.map((p) => {
        const base: CsvCell[] = [
          p.name,
          STATUS_LABEL[p.current_status] ?? p.current_status,
          p.surgery_type?.name ?? '',
          p.hospital?.name ?? '',
          p.medical_team ? `Equipe ${String(p.medical_team.team_number).padStart(2, '0')}` : '',
          csvDate(p.hospital_discharge_date),
          STUDY_GROUP_LABEL[p.study_group ?? 'INTERVENTION'],
        ];
        if (opts.includeArchived) base.push(p.deleted_at ? 'Sim' : 'Não');
        return base;
      }),
    ];
    downloadCsv(`vitalsync_pacientes_${today()}.csv`, rows);
    return items.length;
  },

  /** Alertas clínicos. */
  async alerts(): Promise<number> {
    const items = await alertService.getAlerts();
    const rows: CsvCell[][] = [
      ['Paciente', 'Status', 'Descrição', 'Atendido', 'Data'],
      ...items.map((a) => [
        a.patient?.name ?? '',
        STATUS_LABEL[a.status] ?? a.status,
        a.description,
        a.attended ? 'Sim' : 'Não',
        csvDateTime(a.created_at),
      ]),
    ];
    downloadCsv(`vitalsync_alertas_${today()}.csv`, rows);
    return items.length;
  },

  /** Equipes médicas. */
  async teams(): Promise<number> {
    const items = await teamService.list();
    const rows: CsvCell[][] = [
      ['Equipe', 'Status', 'Criada em'],
      ...items.map((t) => [
        `Equipe ${String(t.team_number).padStart(2, '0')}`,
        ENTITY_STATUS_LABEL[t.status] ?? t.status,
        csvDate(t.created_at),
      ]),
    ];
    downloadCsv(`vitalsync_equipes_${today()}.csv`, rows);
    return items.length;
  },

  /** Usuários do painel (Admin). */
  async users(): Promise<number> {
    const items = await userService.getUsers();
    const rows: CsvCell[][] = [
      ['Nome', 'E-mail', 'Papel', 'Status', 'WhatsApp', 'CRM', 'Criado em'],
      ...items.map((u) => [
        u.name,
        u.email,
        dbRoleLabelPt(u.role),
        ENTITY_STATUS_LABEL[u.status] ?? u.status,
        u.whatsapp ?? '',
        u.crm ?? '',
        csvDate(u.created_at),
      ]),
    ];
    downloadCsv(`vitalsync_usuarios_${today()}.csv`, rows);
    return items.length;
  },

  /** Adesão e completude (desfecho primário do estudo, protocolo 5.11). */
  async adherence(): Promise<number> {
    const items = await adherenceService.getPatientAdherence();
    const rows: CsvCell[][] = [
      ['Paciente', 'Dias de monitoramento', 'Coletas esperadas', 'Coletas realizadas', 'Adesão (%)', 'Completude (%)', 'Perda de seguimento'],
      ...items.map((r) => [
        r.name,
        String(r.effectiveDays),
        String(r.expectedCollections),
        String(r.actualCollections),
        String(r.adherencePct),
        String(r.completenessPct),
        r.lostToFollowUp ? 'Sim' : 'Não',
      ]),
    ];
    downloadCsv(`vitalsync_adesao_${today()}.csv`, rows);
    return items.length;
  },
};
