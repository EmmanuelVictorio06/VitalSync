import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Period, WOUND_PHOTO } from '@vitalsync/shared';
import type { Container } from '../../../container.js';
import type { IncomingPhoto } from '../../../application/ports.js';
import { ValidationError } from '../../../domain/errors.js';
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
 * Lê uma requisição multipart: campo `data` (JSON com os sinais vitais) + um
 * arquivo opcional `photo` (foto da ferida). Os limites de tamanho são impostos
 * pelo plugin; o formato/tamanho é revalidado na use case (defesa em profundidade).
 */
async function parseMultipart(
  request: FastifyRequest,
): Promise<{ payload: unknown; photo?: IncomingPhoto }> {
  let payload: unknown;
  let photo: IncomingPhoto | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'photo') {
        await part.toBuffer(); // drena partes inesperadas
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw new ValidationError(WOUND_PHOTO.messages.tooLarge);
      }
      if (part.file.truncated) throw new ValidationError(WOUND_PHOTO.messages.tooLarge);
      if (buffer.length === 0) continue; // input vazio (nenhum arquivo escolhido)
      photo = {
        buffer,
        fileName: part.filename ?? 'foto',
        mimeType: part.mimetype,
        size: buffer.length,
      };
    } else if (part.fieldname === 'data') {
      try {
        payload = JSON.parse(part.value as string);
      } catch {
        throw new ValidationError('Não foi possível ler os dados enviados.');
      }
    }
  }

  if (payload === undefined) throw new ValidationError('Dados da medição ausentes.');
  return { payload, photo };
}

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

    // Aceita multipart (com foto opcional) ou JSON puro (sem foto).
    let rawPayload: unknown;
    let photo: IncomingPhoto | undefined;
    if (request.isMultipart()) {
      ({ payload: rawPayload, photo } = await parseMultipart(request));
    } else {
      rawPayload = request.body;
    }

    const body = submitSchema.parse(rawPayload);
    const result = await container.vitals.register.execute(token, body, clientIp(request), photo);
    return reply.status(201).send(result);
  });
}
