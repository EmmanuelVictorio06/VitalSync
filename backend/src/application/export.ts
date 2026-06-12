import type { AuthenticatedUser } from '../domain/entities.js';
import type { ExportRepository, PatientListFilter } from '../domain/repositories.js';
import { AccessControl } from './auth.js';
import type { AuditLogger, ExportFile, ExportFormat, ExportService } from './ports.js';

/** Exportação de dados de pacientes + medições (somente ADM). */
export class ExportDataUseCase {
  constructor(
    private readonly exportRepo: ExportRepository,
    private readonly exportService: ExportService,
    private readonly audit: AuditLogger,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    filter: Omit<PatientListFilter, 'page' | 'pageSize'>,
    format: ExportFormat,
  ): Promise<ExportFile> {
    AccessControl.assertIsAdmin(actor);

    const rows = await this.exportRepo.exportRows({ ...filter, page: 1, pageSize: 100_000 });
    const file = await this.exportService.build(rows, format);

    await this.audit.log({
      userId: actor.id,
      action: 'DATA_EXPORT',
      metadata: { format, rows: rows.length, filter: filter as Record<string, unknown> },
    });
    return file;
  }
}
