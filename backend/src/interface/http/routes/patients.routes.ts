import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClinicalStatus, Role } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { AccessControl } from '../../../application/auth.js';
import { authenticate, clientIp, getUser, requireRoles } from '../auth.js';

const registerSchema = z.object({
  name: z.string().min(1, 'Informe o nome do paciente.'),
  birthDate: z.string().min(1),
  phone: z.string().min(8, 'Informe um telefone válido.'),
  surgeryTypeId: z.string().min(1, 'Selecione o tipo de cirurgia.'),
  surgeryDate: z.string().min(1),
  dischargeDate: z.string().min(1),
  hospitalId: z.string().min(1, 'Selecione o hospital.'),
  surgeonId: z.string().min(1, 'Selecione o cirurgião principal.'),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(ClinicalStatus).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const attendSchema = z.object({ attendedByUserId: z.string().min(1, 'Selecione o profissional.') });

export async function patientRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Todos os perfis profissionais (ADM, cirurgião, associado) acessam pacientes.
  const guard = { preHandler: [authenticate(container), requireRoles(Role.ADM, Role.SURGEON, Role.ASSOCIATE)] };

  app.post('/patients', guard, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await container.patients.register.execute(getUser(request), body);
    return reply.status(201).send(result);
  });

  app.get('/patients', guard, async (request) => {
    const q = listQuerySchema.parse(request.query);
    const result = await container.patients.list.execute(getUser(request), {
      search: q.search,
      status: q.status,
      fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
      toDate: q.toDate ? new Date(q.toDate) : undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
    return result;
  });

  // Lista enxuta (id+nome) para os dropdowns de seleção de paciente.
  app.get('/patients/select', guard, async (request) => {
    const user = getUser(request);
    const items = await container.patients.listForSelect.listForSelect(AccessControl.teamScope(user));
    return { items };
  });

  app.get('/patients/:id/dashboard', guard, async (request) => {
    const { id } = request.params as { id: string };
    return container.patients.dashboard.execute(getUser(request), id);
  });

  app.post('/patients/:id/attend', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = attendSchema.parse(request.body);
    return container.patients.markAttended.execute(getUser(request), id, body.attendedByUserId);
  });

  // Gera/reenvia o link seguro do paciente (copiar / abrir WhatsApp).
  app.post('/patients/:id/link', guard, async (request) => {
    const { id } = request.params as { id: string };
    return container.patients.regenerateLink.execute(getUser(request), id);
  });

  app.delete('/patients/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.patients.remove.execute(getUser(request), id);
    void clientIp(request);
    return reply.status(204).send();
  });
}
