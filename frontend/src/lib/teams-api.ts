/**
 * Serviço da área "Minhas Equipes" (perfil profissional).
 *
 * Usa um repositório MOCK em memória que reproduz as MESMAS regras de acesso
 * esperadas do servidor — em especial a filtragem por vínculo. A interface é
 * idêntica à futura chamada REST; basta trocar o corpo por `api.get(...)`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CONTRATO DE BACKEND (integração futura)
 *
 *   GET /api/me/teams
 *     → lista as equipes do médico AUTENTICADO (token), nunca por id na URL.
 *
 *   Modelo de dados (relação muitos-para-muitos):
 *     doctors(id, name, email, whatsapp, ...)
 *     medical_teams(id, number, surgeonId, status, createdAt, updatedAt)
 *     doctor_team_memberships(
 *       id, doctorId, teamId,
 *       roleInTeam: ASSOCIATED_DOCTOR | MAIN_SURGEON,
 *       status: ACTIVE | INACTIVE,
 *       createdAt, updatedAt
 *     )
 *
 * REGRA DE SEGURANÇA (revalidada SEMPRE no servidor — nunca só no front):
 *   1. Resolver o médico pelo token da sessão (req.user.id).
 *   2. Buscar memberships com status = ACTIVE desse médico.
 *   3. Retornar apenas as equipes desses vínculos.
 *   4. Pacientes/alertas são filtrados pelas equipes vinculadas — o médico
 *      jamais acessa dados de equipes em que não participa.
 *   O profissional NÃO pode editar/excluir equipes nem gerir membros por aqui.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { ClinicalStatus, type Role } from '@vitalsync/shared';
import type { MyTeam, MyTeamsSummary, RoleInTeam } from './teams-types';

const LATENCY_MS = 350;
const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));

export class TeamsApiError extends Error {}

/* =====================================================================
   Repositório mock — médicos, equipes e VÍNCULOS (memberships).
   O "médico logado" de demonstração é `DEMO_DOCTOR_ID`.
   ===================================================================== */

const DEMO_DOCTOR_ID = 'doc-demo';

interface Membership {
  doctorId: string;
  teamId: string;
  roleInTeam: RoleInTeam;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Vínculos do médico logado. Note o vínculo INATIVO (equipe 09): ele NÃO deve
 * aparecer na listagem — demonstra a regra "apenas vínculos ativos".
 */
const MEMBERSHIPS: Membership[] = [
  { doctorId: DEMO_DOCTOR_ID, teamId: 't1', roleInTeam: 'ASSOCIATED_DOCTOR', status: 'ACTIVE' },
  { doctorId: DEMO_DOCTOR_ID, teamId: 't3', roleInTeam: 'ASSOCIATED_DOCTOR', status: 'ACTIVE' },
  { doctorId: DEMO_DOCTOR_ID, teamId: 't7', roleInTeam: 'ASSOCIATED_DOCTOR', status: 'ACTIVE' },
  { doctorId: DEMO_DOCTOR_ID, teamId: 't9', roleInTeam: 'ASSOCIATED_DOCTOR', status: 'INACTIVE' },
];

const { GREEN, YELLOW, RED } = ClinicalStatus;

/** Equipes do sistema (mock). Indexadas por id. */
const TEAMS: Record<string, MyTeam> = {
  t1: {
    id: 't1',
    number: 1,
    surgeonName: 'Dra. Ana Souza',
    status: 'ACTIVE',
    createdAt: '2026-02-10',
    myRole: 'ASSOCIATED_DOCTOR',
    stats: { doctors: 4, monitoring: 18, stable: 14, attention: 3, alert: 1, unattendedAlerts: 2 },
    doctors: [
      { id: 'd1', name: 'Dra. Ana Souza', email: 'ana.souza@curapath.com.br', whatsapp: '41999990001', roleInTeam: 'MAIN_SURGEON' },
      { id: 'd2', name: 'Dr. Bruno Tavares', email: 'bruno.tavares@curapath.com.br', whatsapp: '41999990002', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'd3', name: 'Dra. Camila Reis', email: 'camila.reis@curapath.com.br', whatsapp: '41999990003', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'doc-demo', name: 'Você', email: 'medico@curapath.com.br', whatsapp: '41999990009', roleInTeam: 'ASSOCIATED_DOCTOR' },
    ],
    patients: [
      { id: 'p11', name: 'Marcos Oliveira', surgeryType: 'Bariátrica', dischargeDate: '2026-06-18', monitoringDay: 3, status: RED },
      { id: 'p12', name: 'Elena Ricci', surgeryType: 'Artroplastia de joelho', dischargeDate: '2026-06-19', monitoringDay: 2, status: YELLOW },
      { id: 'p13', name: 'Beatriz Silva', surgeryType: 'Colecistectomia', dischargeDate: '2026-06-15', monitoringDay: 5, status: YELLOW },
      { id: 'p14', name: 'João Pereira', surgeryType: 'Herniorrafia', dischargeDate: '2026-06-14', monitoringDay: 6, status: GREEN },
      { id: 'p15', name: 'Clara Nunes', surgeryType: 'Apendicectomia', dischargeDate: '2026-06-20', monitoringDay: 1, status: GREEN },
    ],
    recentAlerts: [
      { id: 'al11', patientName: 'Marcos Oliveira', description: 'Febre alta (38,9°C)', datetime: '2026-06-21 09:14', severity: 'RED', attended: false },
      { id: 'al12', patientName: 'Elena Ricci', description: 'Saturação baixa (89%)', datetime: '2026-06-21 07:55', severity: 'YELLOW', attended: false },
      { id: 'al13', patientName: 'Beatriz Silva', description: 'Dor reportada 7/10', datetime: '2026-06-20 21:40', severity: 'YELLOW', attended: true },
    ],
  },
  t3: {
    id: 't3',
    number: 3,
    surgeonName: 'Dr. Ricardo Lima',
    status: 'ACTIVE',
    createdAt: '2026-03-04',
    myRole: 'ASSOCIATED_DOCTOR',
    stats: { doctors: 3, monitoring: 11, stable: 9, attention: 1, alert: 1, unattendedAlerts: 1 },
    doctors: [
      { id: 'd4', name: 'Dr. Ricardo Lima', email: 'ricardo.lima@curapath.com.br', whatsapp: '41999990004', roleInTeam: 'MAIN_SURGEON' },
      { id: 'd5', name: 'Dra. Patrícia Gomes', email: 'patricia.gomes@curapath.com.br', whatsapp: '41999990005', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'doc-demo', name: 'Você', email: 'medico@curapath.com.br', whatsapp: '41999990009', roleInTeam: 'ASSOCIATED_DOCTOR' },
    ],
    patients: [
      { id: 'p31', name: 'Carlos Lima', surgeryType: 'Cesariana', dischargeDate: '2026-06-16', monitoringDay: 4, status: RED },
      { id: 'p32', name: 'Mariana Alves', surgeryType: 'Colecistectomia', dischargeDate: '2026-06-17', monitoringDay: 3, status: YELLOW },
      { id: 'p33', name: 'Rafael Costa', surgeryType: 'Herniorrafia', dischargeDate: '2026-06-13', monitoringDay: 7, status: GREEN },
      { id: 'p34', name: 'Lucia Fernandes', surgeryType: 'Artroplastia de joelho', dischargeDate: '2026-06-12', monitoringDay: 8, status: GREEN },
    ],
    recentAlerts: [
      { id: 'al31', patientName: 'Carlos Lima', description: 'Sangramento na ferida operatória', datetime: '2026-06-21 08:30', severity: 'RED', attended: false },
      { id: 'al32', patientName: 'Mariana Alves', description: 'Temperatura limítrofe (37,8°C)', datetime: '2026-06-20 22:10', severity: 'YELLOW', attended: true },
    ],
  },
  t7: {
    id: 't7',
    number: 7,
    surgeonName: 'Dra. Mariana Costa',
    status: 'ACTIVE',
    createdAt: '2026-04-22',
    myRole: 'ASSOCIATED_DOCTOR',
    stats: { doctors: 5, monitoring: 22, stable: 20, attention: 2, alert: 0, unattendedAlerts: 0 },
    doctors: [
      { id: 'd6', name: 'Dra. Mariana Costa', email: 'mariana.costa@curapath.com.br', whatsapp: '41999990006', roleInTeam: 'MAIN_SURGEON' },
      { id: 'd7', name: 'Dr. Felipe Andrade', email: 'felipe.andrade@curapath.com.br', whatsapp: '41999990007', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'd8', name: 'Dra. Renata Dias', email: 'renata.dias@curapath.com.br', whatsapp: '41999990008', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'd9', name: 'Dr. Otávio Pinto', email: 'otavio.pinto@curapath.com.br', whatsapp: '41999990010', roleInTeam: 'ASSOCIATED_DOCTOR' },
      { id: 'doc-demo', name: 'Você', email: 'medico@curapath.com.br', whatsapp: '41999990009', roleInTeam: 'ASSOCIATED_DOCTOR' },
    ],
    patients: [
      { id: 'p71', name: 'Sofia Martins', surgeryType: 'Cesariana', dischargeDate: '2026-06-18', monitoringDay: 3, status: YELLOW },
      { id: 'p72', name: 'Gustavo Ramos', surgeryType: 'Apendicectomia', dischargeDate: '2026-06-19', monitoringDay: 2, status: YELLOW },
      { id: 'p73', name: 'Helena Castro', surgeryType: 'Colecistectomia', dischargeDate: '2026-06-15', monitoringDay: 5, status: GREEN },
      { id: 'p74', name: 'Daniel Souza', surgeryType: 'Herniorrafia', dischargeDate: '2026-06-11', monitoringDay: 9, status: GREEN },
    ],
    recentAlerts: [],
  },
};

/** Equipe inativa de exemplo (vínculo INATIVO) — nunca retornada. */
TEAMS.t9 = {
  id: 't9',
  number: 9,
  surgeonName: 'Dr. Paulo Mendes',
  status: 'INACTIVE',
  createdAt: '2025-11-30',
  myRole: 'ASSOCIATED_DOCTOR',
  stats: { doctors: 2, monitoring: 0, stable: 0, attention: 0, alert: 0, unattendedAlerts: 0 },
  doctors: [],
  patients: [],
  recentAlerts: [],
};

/** Soma os cards de resumo a partir das equipes já filtradas. */
function summarize(teams: MyTeam[]): MyTeamsSummary {
  return teams.reduce<MyTeamsSummary>(
    (acc, t) => ({
      teams: acc.teams + 1,
      monitoring: acc.monitoring + t.stats.monitoring,
      attention: acc.attention + t.stats.attention,
      alert: acc.alert + t.stats.alert,
      unattendedAlerts: acc.unattendedAlerts + t.stats.unattendedAlerts,
    }),
    { teams: 0, monitoring: 0, attention: 0, alert: 0, unattendedAlerts: 0 },
  );
}

export const myTeamsApi = {
  /**
   * Lista as equipes do médico ASSOCIADO logado (somente leitura). No mock, o
   * `user` serve apenas para decidir o papel exibido; o servidor real resolve o
   * médico pelo token e filtra por `doctor_team_memberships` (ver cabeçalho).
   */
  async list(_user?: { id: string; role: Role }): Promise<{ teams: MyTeam[]; summary: MyTeamsSummary }> {
    await delay();
    const teams = MEMBERSHIPS
      // 1) apenas vínculos ATIVOS do médico logado
      .filter((m) => m.doctorId === DEMO_DOCTOR_ID && m.status === 'ACTIVE')
      // 2) resolve a equipe e aplica o papel do médico naquele vínculo
      .map((m) => {
        const team = TEAMS[m.teamId];
        return team ? { ...team, myRole: m.roleInTeam } : null;
      })
      .filter((t): t is MyTeam => t !== null)
      // 3) ordena por número da equipe
      .sort((a, b) => a.number - b.number);

    return { teams, summary: summarize(teams) };
  },
};

/*
 * NOTA: a tela "Minha Equipe" (cirurgião) NÃO usa mock. Ela consome a API REAL
 * (`GET /teams` devolve apenas a equipe do cirurgião e `PATCH /teams/:id`
 * adiciona/edita/remove associados), garantindo os MESMOS dados da tela do
 * Administrador. Ver pages/MyTeamPage.tsx.
 */
