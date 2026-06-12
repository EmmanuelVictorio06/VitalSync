import type { FastifyInstance } from 'fastify';
import { listPendingMedicalValidations } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { authenticate } from '../auth.js';

/** Catálogos para os dropdowns + lista de pendências clínicas (transparência). */
export async function catalogRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/catalog/surgery-types', { preHandler: authenticate(container) }, async () => {
    return { items: await container.catalog.listSurgeryTypes() };
  });

  app.get('/catalog/hospitals', { preHandler: authenticate(container) }, async () => {
    return { items: await container.catalog.listHospitals() };
  });

  app.get('/catalog/surgeons', { preHandler: authenticate(container) }, async () => {
    return { items: await container.catalog.listSurgeons() };
  });

  // Público: sinaliza valores clínicos provisórios pendentes de confirmação médica.
  app.get('/catalog/pending-validations', async () => {
    return { pending: listPendingMedicalValidations() };
  });
}
