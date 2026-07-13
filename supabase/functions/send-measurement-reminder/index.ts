// ============================================================================
// Edge Function: send-measurement-reminder
//
// Entrega por WhatsApp (Meta Cloud API) os reminder_logs PENDENTES de um
// período de medição (MORNING/NIGHT). NÃO decide destinatários — isso já foi
// feito pela função SQL enqueue_measurement_reminders (0038), que aplica o
// gate de elegibilidade (10 dias pós-alta, sem medição do dia) e o gate de
// homologação (só whitelist vira PENDING; o resto vira SKIPPED_TEST_MODE).
//
// Acionamento em produção: pg_cron (09:30/19:30 America/Sao_Paulo) chama
// public.dispatch_measurement_reminders(period), que enfileira e faz o POST
// aqui via pg_net com { period }. Também aceita chamada direta sem period
// (processa todos os PENDING de qualquer período — útil para reenvio manual).
//
// Segurança: mesmo padrão de send-whatsapp-alert — token da Meta é SECRET
// (nunca no frontend); sem credenciais configuradas, registra como "logged"
// (simulado), permitindo testar o fluxo sem enviar mensagens reais.
//
// Mensagem SEM dado clínico sensível: só nome do paciente + link de registro.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GRAPH_VERSION = 'v20.0';
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_REMINDER_TEMPLATE_NAME') ?? 'lembrete_medicao_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingReminder {
  id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  patients: { secure_token: string } | null;
}

function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Envia o template aprovado via Meta Cloud API. {{1}} do corpo = nome do
 * paciente. O botão "Registrar agora" (URL dinâmica) tem a base fixa
 * `https://vital-sync-frontend.vercel.app/registro-sinais/` configurada na
 * aprovação do template — aqui só passamos o `secure_token` como {{1}} do
 * botão (não o path inteiro, diferente do send-whatsapp-alert que usa
 * `patients/${patientId}` porque aquele link é da equipe, não do paciente).
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
      to: onlyDigits(to),
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
            // "https://vital-sync-frontend.vercel.app/registro-sinais/" é fixa no template.
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
    const period: string | undefined = body?.period;
    if (period && period !== 'MORNING' && period !== 'NIGHT') {
      return json({ error: 'period inválido (use MORNING ou NIGHT)' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = supabase
      .from('reminder_logs')
      .select('id, recipient_name, recipient_phone, patients(secure_token)')
      .eq('status', 'PENDING');
    if (period) query = query.eq('period', period);

    const { data: logs, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const pending = (logs ?? []) as unknown as PendingReminder[];
    if (pending.length === 0) return json({ ok: true, sent: 0, failed: 0 });

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
          .from('reminder_logs')
          .update({ status: 'FAILED', error_message: 'Destinatário sem telefone ou paciente sem token.' })
          .eq('id', log.id);
        failed++;
        continue;
      }
      if (!hasProvider) {
        // Sem credenciais Meta: registra como simulado (não envia de verdade).
        await supabase
          .from('reminder_logs')
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
          .from('reminder_logs')
          .update({ status: 'SENT', provider_message_id: providerId, sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
      } catch (e) {
        await supabase
          .from('reminder_logs')
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
