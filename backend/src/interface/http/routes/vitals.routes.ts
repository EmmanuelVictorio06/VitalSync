import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Period } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import { clientIp } from '../auth.js';

const submitSchema = z.object({
  period: z.nativeEnum(Period),
  temperature: z.number(),
  spo2: z.number(),
  systolic: z.number(),
  diastolic: z.number(),
  heartRate: z.number(),
  pain: z.number().int().min(0).max(10),
  dyspnea: z.number().int().min(0).max(10),
  urinatedNormally: z.boolean(),
  urinationCount: z.number().int().positive().nullable().optional(),
  hadVomit: z.boolean(),
  vomitCount: z.number().int().positive().nullable().optional(),
  hadBleeding: z.boolean(),
  stepsCount: z.number().int().min(0).nullable().optional(),
});

/**
 * Rotas PÚBLICAS do paciente — acesso somente via token do link (sem login).
 * O token vai no path; nenhum dado sensível é exposto na URL.
 */
export async function vitalsRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.get('/public/link/:token', async (request) => {
    const { token } = request.params as { token: string };
    return container.vitals.resolveLink.execute(token);
  });

  app.post('/public/link/:token/records', async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = submitSchema.parse(request.body);
    const result = await container.vitals.register.execute(token, body, clientIp(request));
    return reply.status(201).send(result);
  });
}
