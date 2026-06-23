import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Carrega o .env da raiz do monorepo (fonte única de configuração).
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  PATIENT_LINK_GRACE_HOURS: z.coerce.number().default(24),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Diretório (fora do webroot) onde as fotos da ferida são salvas com segurança. */
  UPLOADS_DIR: z.string().default('./uploads'),
  ADMIN_EMAIL: z.string().email().default('admin@vitalsync.local'),
  ADMIN_PASSWORD: z.string().min(6).default('Admin@123'),
  ADMIN_NAME: z.string().default('Administrador'),
  WHATSAPP_PROVIDER: z.enum(['log', 'twilio', 'meta']).default('log'),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_FROM_NUMBER: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Falha cedo e clara — evita subir o servidor com configuração inválida.
  console.error('❌ Configuração de ambiente inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
