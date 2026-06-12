/**
 * Composition Root — único lugar que conhece as implementações concretas.
 * Monta os repositórios, serviços e use cases e os injeta na camada HTTP.
 * Trocar uma implementação (banco, WhatsApp, export) é alterar só aqui.
 */
import { env } from './config/env.js';
import { AlertDispatcher } from './application/alerts.js';
import { LoginUseCase } from './application/auth.js';
import { ExportDataUseCase } from './application/export.js';
import {
  DeletePatientUseCase,
  GetPatientDashboardUseCase,
  ListPatientsUseCase,
  MarkPatientAttendedUseCase,
  RegeneratePatientLinkUseCase,
  RegisterPatientUseCase,
} from './application/patients.js';
import {
  CreateTeamUseCase,
  DeleteTeamUseCase,
  ListTeamsUseCase,
  UpdateTeamUseCase,
} from './application/teams.js';
import { RegisterVitalSignsUseCase, ResolvePatientLinkUseCase } from './application/vitals.js';
import { PrismaAuditLogger } from './infrastructure/audit/PrismaAuditLogger.js';
import { ExcelExportService } from './infrastructure/export/ExcelExportService.js';
import {
  PrismaAlertRepository,
  PrismaAttendanceRepository,
  PrismaCatalogRepository,
  PrismaExportRepository,
  PrismaMonitoringLinkRepository,
  PrismaPatientRepository,
  PrismaTeamRepository,
  PrismaUserRepository,
  PrismaVitalSignRepository,
} from './infrastructure/prisma/repositories.js';
import {
  BcryptPasswordHasher,
  CryptoLinkTokenService,
  JwtTokenService,
} from './infrastructure/security/security.js';
import { createWhatsappGateway } from './infrastructure/whatsapp/gateway.js';

export function buildContainer() {
  // Repositórios
  const users = new PrismaUserRepository();
  const teams = new PrismaTeamRepository();
  const patients = new PrismaPatientRepository();
  const links = new PrismaMonitoringLinkRepository();
  const vitals = new PrismaVitalSignRepository();
  const attendance = new PrismaAttendanceRepository();
  const alertsRepo = new PrismaAlertRepository();
  const catalog = new PrismaCatalogRepository();
  const exportRepo = new PrismaExportRepository();

  // Serviços / adapters
  const hasher = new BcryptPasswordHasher();
  const tokens = new JwtTokenService(env.JWT_SECRET, env.JWT_EXPIRES_IN);
  const linkTokens = new CryptoLinkTokenService();
  const audit = new PrismaAuditLogger();
  const exportService = new ExcelExportService();
  const whatsapp = createWhatsappGateway({
    provider: env.WHATSAPP_PROVIDER,
    apiToken: env.WHATSAPP_API_TOKEN,
    fromNumber: env.WHATSAPP_FROM_NUMBER,
  });

  const alertDispatcher = new AlertDispatcher(users, alertsRepo, whatsapp, audit);

  const registerPatient = new RegisterPatientUseCase(patients, users, links, linkTokens, audit, {
    publicWebUrl: env.PUBLIC_WEB_URL,
    linkGraceHours: env.PATIENT_LINK_GRACE_HOURS,
  });

  // Use cases agrupados por contexto
  return {
    catalog,
    auth: {
      login: new LoginUseCase(users, hasher, tokens, audit),
      tokens,
    },
    teams: {
      create: new CreateTeamUseCase(teams, users, hasher, audit),
      list: new ListTeamsUseCase(teams),
      update: new UpdateTeamUseCase(teams, users, hasher, audit),
      remove: new DeleteTeamUseCase(teams, audit),
    },
    patients: {
      register: registerPatient,
      regenerateLink: new RegeneratePatientLinkUseCase(registerPatient, patients, audit),
      list: new ListPatientsUseCase(patients),
      remove: new DeletePatientUseCase(patients, links, audit),
      markAttended: new MarkPatientAttendedUseCase(patients, attendance, audit),
      dashboard: new GetPatientDashboardUseCase(patients, vitals, users, audit),
      listForSelect: patients,
    },
    vitals: {
      resolveLink: new ResolvePatientLinkUseCase(links, patients, linkTokens),
      register: new RegisterVitalSignsUseCase(links, patients, vitals, linkTokens, alertDispatcher, audit),
    },
    exports: {
      run: new ExportDataUseCase(exportRepo, exportService, audit),
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
