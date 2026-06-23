import type { FastifyInstance } from 'fastify';
import { Role } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { authenticate, getUser, requireRoles } from '../auth.js';

export async function dashboardRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Todos os perfis profissionais; o use case restringe os dados por equipe.
  const guard = { preHandler: [authenticate(container), requireRoles(Role.ADM, Role.SURGEON, Role.ASSOCIATE)] };

  app.get('/dashboard', guard, async (request) => {
    return container.dashboard.get.execute(getUser(request));
  });

  app.get('/alerts', guard, async (request) => {
    return { items: await container.dashboard.alerts.execute(getUser(request)) };
  });
}
