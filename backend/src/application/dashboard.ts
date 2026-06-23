import type { AuthenticatedUser } from '../domain/entities.js';
import type { DashboardData, DashboardRecentAlert, DashboardRepository } from '../domain/repositories.js';
import { AccessControl } from './auth.js';

/**
 * Agregações do painel e da central de alertas. O escopo de equipe é aplicado
 * SEMPRE no servidor (ADM vê tudo; cirurgião/associado, apenas a própria equipe).
 */
export class GetDashboardUseCase {
  constructor(private readonly repo: DashboardRepository) {}

  execute(actor: AuthenticatedUser): Promise<DashboardData> {
    return this.repo.getDashboard(AccessControl.teamScope(actor));
  }
}

export class ListAlertsUseCase {
  constructor(private readonly repo: DashboardRepository) {}

  execute(actor: AuthenticatedUser): Promise<DashboardRecentAlert[]> {
    return this.repo.listAlerts(AccessControl.teamScope(actor), 100);
  }
}
