// ============================================================================
// Edge Function: send-whatsapp-alert
//
// Entrega por WhatsApp (Meta Cloud API) os logs de notificação PENDENTES de um
// alerta. NÃO decide destinatários nem aplica o gate de homologação — isso já
// foi feito pela função SQL notify_team_of_alert (0010), que cria as linhas em
// notification_logs com status:
//   • PENDING            → esta função tenta enviar de verdade
//   • SKIPPED_TEST_MODE  → ignorada aqui (número fora da whitelist de teste)
//
// Acionamento em produção: Database Webhook no INSERT de clinical_alerts
// (payload { type, table, record }). Também aceita { alert_id } (reenvio).
//
// Segurança: o TOKEN da Meta é SECRET no Supabase (nunca no frontend):
//   supabase secrets set WHATSAPP_API_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
// A mensagem usa apenas o template aprovado — sem dados clínicos sensíveis.
//
// Sem credenciais Meta configuradas, registra os logs como "logged" (simulado),
// permitindo testar o fluxo de homologação sem enviar mensagens reais.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GRAPH_VERSION = 'v20.0';
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'alerta_clinico_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingLog {
  id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
}

function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Envia o template aprovado via Meta Cloud API. Retorna o id da mensagem. */
async function sendViaMeta(
  token: string,
  phoneNumberId: string,
  to: string,
  doctorName: string,
  patientId: string,
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
          // {{1}} do corpo = nome do médico. Nenhum dado clínico é enviado.
          { type: 'body', parameters: [{ type: 'text', text: doctorName || 'Doutor(a)' }] },
          // {{1}} do botão "Ver no VitalSync" = sufixo da URL (tela do paciente).
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: `patients/${patientId}` }],
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
    // Aceita Database Webhook ({ record: { id } }) ou chamada direta ({ alert_id }).
    const alertId: string | undefined = body?.alert_id ?? body?.record?.id;
    if (!alertId) return json({ error: 'alert_id obrigatório' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: logs, error } = await supabase
      .from('notification_logs')
      .select('id, recipient_name, recipient_phone')
      .eq('alert_id', alertId)
      .eq('status', 'PENDING');
    if (error) return json({ error: error.message }, 400);

    const pending = (logs ?? []) as PendingLog[];
    if (pending.length === 0) return json({ ok: true, sent: 0, skipped: 0 });

    const { data: alert } = await supabase
      .from('clinical_alerts')
      .select('patient_id')
      .eq('id', alertId)
      .single();
    const patientId: string = alert?.patient_id ?? '';

    const token = Deno.env.get('WHATSAPP_API_TOKEN');
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    const hasProvider = Boolean(token && phoneNumberId);

    let sent = 0;
    let failed = 0;
    for (const log of pending) {
      const now = new Date().toISOString();
      if (!log.recipient_phone) {
        await supabase
          .from('notification_logs')
          .update({ status: 'FAILED', error_message: 'Destinatário sem telefone cadastrado.' })
          .eq('id', log.id);
        failed++;
        continue;
      }
      if (!hasProvider) {
        // Sem credenciais Meta: registra como simulado (não envia de verdade).
        await supabase
          .from('notification_logs')
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
          patientId,
        );
        await supabase
          .from('notification_logs')
          .update({ status: 'SENT', provider_message_id: providerId, sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
      } catch (e) {
        await supabase
          .from('notification_logs')
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
