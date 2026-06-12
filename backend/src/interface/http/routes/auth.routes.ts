import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../../container.js';
import { authenticate, clientIp, getUser } from '../auth.js';

const loginSchema = z.object({
  email: z.string().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

export async function authRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await container.auth.login.execute({ ...body, ip: clientIp(request) });
    return reply.send(result);
  });

  // Retorna o usuário da sessão (para reidratar o frontend).
  app.get('/auth/me', { preHandler: authenticate(container) }, async (request) => {
    return { user: getUser(request) };
  });
}
