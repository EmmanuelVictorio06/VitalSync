import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

/** Cliente Prisma único (singleton) reutilizado por todos os repositórios. */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
