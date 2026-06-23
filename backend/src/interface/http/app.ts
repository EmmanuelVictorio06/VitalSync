import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { WOUND_PHOTO } from '@vitalsync/shared';
import { env } from '../../config/env.js';
import type { Container } from '../../container.js';
import { errorHandler } from './errorHandler.js';
import { authRoutes } from './routes/auth.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { patientRoutes } from './routes/patients.routes.js';
import { teamRoutes } from './routes/teams.routes.js';
import { vitalsRoutes } from './routes/vitals.routes.js';

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'development' ? 'info' : 'warn' },
    trustProxy: true, // IP correto atrás de proxy (auditoria/rate-limit)
  });

  // Segurança: cabeçalhos seguros (XSS/clickjacking), CORS restrito, rate-limit.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: [env.PUBLIC_WEB_URL], credentials: true });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  // Upload da foto da ferida (1 arquivo por envio, limite de tamanho seguro).
  await app.register(multipart, {
    limits: { fileSize: WOUND_PHOTO.maxBytes, files: 1, fields: 25 },
  });

  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Rotas de domínio (prefixo /api).
  await app.register(
    async (api) => {
      await authRoutes(api, container);
      await catalogRoutes(api, container);
      await teamRoutes(api, container);
      await patientRoutes(api, container);
      await vitalsRoutes(api, container);
      await exportRoutes(api, container);
    },
    { prefix: '/api' },
  );

  return app;
}
