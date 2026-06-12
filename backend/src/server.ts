import './interface/http/http-types.js';
import { env } from './config/env.js';
import { buildContainer } from './container.js';
import { buildApp } from './interface/http/app.js';

async function main(): Promise<void> {
  const container = buildContainer();
  const app = await buildApp(container);

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`VitalSync API ouvindo em http://localhost:${env.PORT} (provider WhatsApp: ${env.WHATSAPP_PROVIDER})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
