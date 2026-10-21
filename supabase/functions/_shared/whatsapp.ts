// ============================================================================
// Cliente WhatsApp único — usado por send-whatsapp-alert,
// send-measurement-reminder, send-missed-measurement-alert e
// send-welcome-message. Ponto ÚNICO de troca de provedor: antes cada uma das
// 4 Edge Functions duplicava sua própria chamada HTTP à Meta Cloud API
// (mesmo bug corrigido 4x, mesma troca de provedor repetida 4x). Agora só
// este arquivo conhece o formato HTTP de cada provedor.
//
// Provedores suportados (secret WHATSAPP_PROVIDER):
//   • 'meta'      (default — mantém o comportamento anterior sem precisar
//                  reconfigurar nada) → Graph API direta.
//                  Secrets: WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//   • '360dialog' → mesmo formato de template (Cloud API compatível), só
//                  endpoint/auth mudam.
//                  Secrets: WHATSAPP_360DIALOG_API_KEY
//   Ver docs/CONFIG_WHATSAPP_360DIALOG.md para o passo a passo de migração.
//
// Sem as credenciais do provedor ativo configuradas, isWhatsAppConfigured()
// devolve false — cada função chamadora decide o que fazer (hoje: marca o
// log como "logged"/simulado, sem enviar de verdade). Mesmo padrão de
// homologação que já existia.
// ============================================================================

export interface WhatsAppTemplateComponent {
  type: 'body' | 'button' | 'header';
  sub_type?: string;
  index?: string;
  parameters: Array<{ type: string; text?: string }>;
}

type Provider = 'meta' | '360dialog';

function activeProvider(): Provider {
  const p = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'meta').trim().toLowerCase();
  return p === '360dialog' ? '360dialog' : 'meta';
}

/** true quando os secrets do provedor ATIVO estão configurados (permite enviar de verdade). */
export function isWhatsAppConfigured(): boolean {
  if (activeProvider() === '360dialog') {
    return Boolean(Deno.env.get('WHATSAPP_360DIALOG_API_KEY'));
  }
  return Boolean(Deno.env.get('WHATSAPP_API_TOKEN') && Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'));
}

function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Normaliza para o formato internacional do WhatsApp (Brasil). Se o número
 * vier sem DDI (10-11 dígitos: DDD + número), prefixa 55. Números com 12-13
 * dígitos já têm o código do país e são mantidos. Usa o COMPRIMENTO (e não
 * "começa com 55") para não confundir DDDs 51-55 do Sul com o DDI.
 */
export function toBrWhatsApp(phone: string): string {
  const d = onlyDigits(phone);
  return d.length <= 11 ? `55${d}` : d;
}

async function sendViaMeta(to: string, templateName: string, templateLang: string, components: WhatsAppTemplateComponent[]): Promise<string> {
  const token = Deno.env.get('WHATSAPP_API_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_API_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados.');
  }
  const GRAPH_VERSION = 'v20.0';
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toBrWhatsApp(to),
      type: 'template',
      template: { name: templateName, language: { code: templateLang }, components },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Meta API HTTP ${res.status}`);
  }
  return data?.messages?.[0]?.id ?? '';
}

/**
 * 360dialog (Cloud API compatível — hoje mesmo endpoint/formato de template
 * da Meta, só troca base URL + header de autenticação). Confirme no console
 * 360dialog se algum detalhe mudou antes de depender disto em produção.
 */
async function sendVia360Dialog(to: string, templateName: string, templateLang: string, components: WhatsAppTemplateComponent[]): Promise<string> {
  const apiKey = Deno.env.get('WHATSAPP_360DIALOG_API_KEY');
  if (!apiKey) {
    throw new Error('WHATSAPP_360DIALOG_API_KEY não configurado.');
  }
  const res = await fetch('https://waba-v2.360dialog.io/messages', {
    method: 'POST',
    headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toBrWhatsApp(to),
      type: 'template',
      template: { name: templateName, language: { code: templateLang }, components },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? data?.errors?.[0]?.details ?? `360dialog API HTTP ${res.status}`);
  }
  return data?.messages?.[0]?.id ?? '';
}

/**
 * Envia um template já aprovado pelo provedor configurado em
 * WHATSAPP_PROVIDER. Lança erro se faltar credencial (chame
 * isWhatsAppConfigured() antes para decidir entre enviar de verdade ou
 * marcar como simulado) ou se o provedor responder erro. Retorna o
 * provider_message_id.
 */
export function sendWhatsAppTemplate(params: {
  to: string;
  templateName: string;
  templateLang: string;
  components: WhatsAppTemplateComponent[];
}): Promise<string> {
  const { to, templateName, templateLang, components } = params;
  return activeProvider() === '360dialog'
    ? sendVia360Dialog(to, templateName, templateLang, components)
    : sendViaMeta(to, templateName, templateLang, components);
}
