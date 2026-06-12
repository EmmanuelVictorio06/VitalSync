import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { authenticate, getUser, requireRoles } from '../auth.js';

const memberSchema = z.object({
  name: z.string().min(1, 'Informe o nome do médico.'),
  email: z.string().email('Informe um e-mail válido.'),
  password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres.'),
  whatsapp: z.string().optional().nullable(),
});

const createSchema = z.object({
  number: z.number().int().positive('Informe um número de equipe válido.'),
  surgeon: memberSchema,
  associates: z.array(memberSchema).default([]),
});

const updateSchema = z.object({
  number: z.number().int().positive().optional(),
  addAssociates: z.array(memberSchema).optional(),
  removeMemberIds: z.array(z.string()).optional(),
  updateMembers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        whatsapp: z.string().optional().nullable(),
        password: z.string().min(6).optional(),
      }),
    )
    .optional(),
});

export async function teamRoutes(app: FastifyInstance, container: Container): Promise<void> {
  // Somente ADM e cirurgião responsável (defesa em profundidade + regra na use case).
  const guard = { preHandler: [authenticate(container), requireRoles(Role.ADM, Role.SURGEON)] };

  app.get('/teams', guard, async (request) => {
    return { items: await container.teams.list.execute(getUser(request)) };
  });

  app.post('/teams', guard, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const team = await container.teams.create.execute(getUser(request), body);
    return reply.status(201).send({ team });
  });

  app.patch('/teams/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const team = await container.teams.update.execute(getUser(request), id, body);
    return { team };
  });

  app.delete('/teams/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.teams.remove.execute(getUser(request), id);
    return reply.status(204).send();
  });
}
