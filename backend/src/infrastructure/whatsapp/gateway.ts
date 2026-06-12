import type {
  NotificationGateway,
  NotificationMessage,
  NotificationResult,
} from '../../application/ports.js';

/**
 * Provedor padrão (desenvolvimento): apenas registra a mensagem no log.
 * Permite testar todo o fluxo de alertas sem credenciais externas.
 */
export class LogWhatsappGateway implements NotificationGateway {
  readonly channel = 'whatsapp';
  async send(message: NotificationMessage): Promise<NotificationResult> {
    console.info(`[WhatsApp:LOG] -> ${message.to}: ${message.body}`);
    return { channel: this.channel, deliveryStatus: 'logged' };
  }
}

/**
 * Stub do provedor Twilio. Implemente a chamada HTTP real ao configurar
 * WHATSAPP_PROVIDER=twilio. A troca de provedor não exige tocar nas use cases.
 */
export class TwilioWhatsappGateway implements NotificationGateway {
  readonly channel = 'whatsapp';
  constructor(
    private readonly _apiToken: string,
    private readonly _fromNumber: string,
  ) {}
  async send(message: NotificationMessage): Promise<NotificationResult> {
    // TODO: integrar com a API da Twilio (POST /Messages) usando this._apiToken.
    console.warn(`[WhatsApp:Twilio] (stub) -> ${message.to}: ${message.body}`);
    return { channel: this.channel, deliveryStatus: 'logged', detail: 'twilio stub' };
  }
}

/** Stub do provedor Meta (WhatsApp Cloud API). */
export class MetaWhatsappGateway implements NotificationGateway {
  readonly channel = 'whatsapp';
  constructor(
    private readonly _apiToken: string,
    private readonly _fromNumber: string,
  ) {}
  async send(message: NotificationMessage): Promise<NotificationResult> {
    // TODO: integrar com a Graph API (POST /{phone-id}/messages).
    console.warn(`[WhatsApp:Meta] (stub) -> ${message.to}: ${message.body}`);
    return { channel: this.channel, deliveryStatus: 'logged', detail: 'meta stub' };
  }
}

/** Seleciona o provedor conforme a configuração — ponto único de troca. */
export function createWhatsappGateway(config: {
  provider: 'log' | 'twilio' | 'meta';
  apiToken?: string;
  fromNumber?: string;
}): NotificationGateway {
  switch (config.provider) {
    case 'twilio':
      return new TwilioWhatsappGateway(config.apiToken ?? '', config.fromNumber ?? '');
    case 'meta':
      return new MetaWhatsappGateway(config.apiToken ?? '', config.fromNumber ?? '');
    default:
      return new LogWhatsappGateway();
  }
}
