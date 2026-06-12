import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClinicalStatus, Role } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { AccessControl } from '../../../application/auth.js';
import { authenticate, getUser, requireRoles } from '../auth.js';

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  search: z.string().optional(),
  status: z.nativeEnum(ClinicalStatus).optional(),
  teamId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

/** Exportação CSV/XLSX — restrita ao ADM (regra reforçada na use case). */
export async function exportRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get(
    '/export',
    { preHandler: [authenticate(container), requireRoles(Role.ADM)] },
    async (request, reply) => {
      const q = exportQuerySchema.parse(request.query);
      const user = getUser(request);
      const file = await container.exports.run.execute(
        user,
        {
          teamId: q.teamId ?? AccessControl.teamScope(user),
          search: q.search,
          status: q.status,
          fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
          toDate: q.toDate ? new Date(q.toDate) : undefined,
        },
        q.format,
      );
      reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .send(file.buffer);
    },
  );
}
