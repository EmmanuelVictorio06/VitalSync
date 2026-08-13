// ============================================================================
// Edge Function: send-welcome-message
//
// Entrega por WhatsApp (Meta Cloud API) os welcome_logs PENDENTES — a primeira
// mensagem que o paciente recebe, no momento do cadastro. NÃO decide quem
// recebe: isso já foi feito pela função SQL enqueue_welcome_message (0072), que
// aplica o gate de elegibilidade (paciente ativo COM telefone, uma boas-vindas
// por paciente) e o gate de homologação (só whitelist vira PENDING; o resto
// vira SKIPPED_TEST_MODE).
//
// Acionamento em produção: trigger AFTER INSERT em patients (0072) chama
// public.dispatch_welcome_message(id), que enfileira e faz o POST aqui via
// pg_net com { patient_id }. Também aceita chamada sem patient_id (processa
// TODOS os PENDING — útil para reenvio manual e para recolher retardatários,
// já que o POST do pg_net pode chegar antes do COMMIT do cadastro).
//
// Segurança: mesmo padrão de send-measurement-reminder — token da Meta é SECRET
// (nunca no frontend); sem credenciais configuradas, registra como "logged"
// (simulado), permitindo testar o fluxo sem enviar mensagens reais.
//
// Mensagem SEM dado clínico: só o nome do paciente + link de primeiro acesso.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GRAPH_VERSION = 'v20.0';
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_WELCOME_TEMPLATE_NAME') ?? 'boas_vindas_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingWelcome {
  id: string;
  patient_id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  patients: { secure_token: string } | null;
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
function toBrWhatsApp(phone: string): string {
  const d = onlyDigits(phone);
  return d.length <= 11 ? `55${d}` : d;
}

/**
 * Envia o template aprovado via Meta Cloud API. {{1}} do corpo = nome do
 * paciente. O botão "Acessar VitalSync" (URL dinâmica) tem a base fixa
 * `https://vital-sync-frontend-iota.vercel.app/registro-sinais/` configurada na
 * aprovação do template — aqui só passamos o `secure_token` como {{1}} do
 * botão (não o path inteiro), idêntico ao botão do template
 * lembrete_medicao_vitalsync.
 */
async function sendViaMeta(
  token: string,
  phoneNumberId: string,
  to: string,
  patientName: string,
  secureToken: string,
): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toBrWhatsApp(to),
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: patientName || 'paciente' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            // {{1}} do botão = só o secure_token; a base
            // "https://vital-sync-frontend-iota.vercel.app/registro-sinais/" é fixa no template.
            parameters: [{ type: 'text', text: secureToken }],
          },
        ],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Meta API HTTP ${res.status}`);
  }
  return data?.messages?.[0]?.id ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const patientId: string | undefined = body?.patient_id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Sempre varre TODOS os PENDING. O patient_id do trigger serve para o caso
    // comum (1 cadastro → 1 mensagem), mas se ele ainda não estiver visível
    // (POST do pg_net antes do COMMIT), a varredura completa recolhe a linha —
    // por isso o filtro por paciente é um "prefira este", não um "só este".
    const { data: logs, error } = await supabase
      .from('welcome_logs')
      .select('id, patient_id, recipient_name, recipient_phone, patients(secure_token)')
      .eq('status', 'PENDING');
    if (error) return json({ error: error.message }, 400);

    const pending = (logs ?? []) as unknown as PendingWelcome[];
    if (pending.length === 0) {
      return json({ ok: true, sent: 0, failed: 0, patient_id: patientId ?? null });
    }

    const token = Deno.env.get('WHATSAPP_API_TOKEN');
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    const hasProvider = Boolean(token && phoneNumberId);

    let sent = 0;
    let failed = 0;
    for (const log of pending) {
      const now = new Date().toISOString();
      const secureToken = log.patients?.secure_token;
      if (!log.recipient_phone || !secureToken) {
        await supabase
          .from('welcome_logs')
          .update({ status: 'FAILED', error_message: 'Destinatário sem telefone ou paciente sem token.' })
          .eq('id', log.id);
        failed++;
        continue;
      }
      if (!hasProvider) {
        // Sem credenciais Meta: registra como simulado (não envia de verdade).
        await supabase
          .from('welcome_logs')
          .update({ status: 'logged', sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
        continue;
      }
      try {
        const providerId = await sendViaMeta(
          token!,
          phoneNumberId!,
          log.recipient_phone,
          log.recipient_name ?? '',
          secureToken,
        );
        await supabase
          .from('welcome_logs')
          .update({ status: 'SENT', provider_message_id: providerId, sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
      } catch (e) {
        await supabase
          .from('welcome_logs')
          .update({ status: 'FAILED', error_message: String(e instanceof Error ? e.message : e) })
          .eq('id', log.id);
        failed++;
      }
    }

    return json({ ok: true, sent, failed, simulated: !hasProvider });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
