// ============================================================================
// Edge Function: send-whatsapp-alert
//
// Entrega por WhatsApp (provedor configurável — ver _shared/whatsapp.ts) os
// logs de notificação PENDENTES de um alerta. NÃO decide destinatários nem
// aplica o gate de homologação — isso já
// foi feito pela função SQL notify_team_of_alert (0010), que cria as linhas em
// notification_logs com status:
//   • PENDING            → esta função tenta enviar de verdade
//   • SKIPPED_TEST_MODE  → ignorada aqui (número fora da whitelist de teste)
//
// Acionamento em produção: Database Webhook no INSERT de clinical_alerts
// (payload { type, table, record }). Também aceita { alert_id } (reenvio).
//
// Segurança: a credencial do provedor é SECRET no Supabase (nunca no
// frontend). Meta (default): WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
// 360dialog: WHATSAPP_PROVIDER=360dialog + WHATSAPP_360DIALOG_API_KEY (ver
// docs/CONFIG_WHATSAPP_360DIALOG.md). A mensagem usa apenas o template
// aprovado — sem dados clínicos sensíveis.
//
// QUAL template: o que o LOG pede (`notification_logs.template_name`, gravado
// pelo SQL — 0084 distingue alerta novo de alerta escalado). Se o provedor não
// conhecer esse template (aprovação pendente na Meta), o envio é repetido com
// WHATSAPP_TEMPLATE_NAME e o log guarda o aviso do fallback.
//
// Sem credenciais do provedor ativo configuradas, registra os logs como
// "logged" (simulado), permitindo testar o fluxo de homologação sem enviar
// mensagens reais.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../_shared/whatsapp.ts';

const TEMPLATE_NAME = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'alerta_clinico_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingLog {
  id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  /** Template pedido pelo SQL (0018/0084). Alerta escalado pede o seu próprio. */
  template_name: string | null;
}

/** Resultado de um envio: id da mensagem e, quando houve, o aviso de fallback. */
interface SendResult {
  providerId: string;
  fallbackNote: string | null;
}

/**
 * Envia o template que o LOG pede, com o mesmo formato de parâmetros para
 * todos: {{1}} do corpo = nome do médico, {{1}} do botão = sufixo da URL.
 *
 * Se o provedor recusar porque o template não existe (caso típico: aprovação
 * na Meta ainda pendente), repete com o template padrão — a notificação sai e
 * o log guarda o aviso. Sem isso, um template novo só poderia entrar no SQL
 * depois de aprovado, e nesse meio-tempo o alerta ficaria sem aviso nenhum.
 */
async function sendAlert(
  to: string,
  doctorName: string,
  patientId: string,
  templateName: string,
): Promise<SendResult> {
  const components = [
    // {{1}} do corpo = nome do médico. Nenhum dado clínico é enviado.
    { type: 'body' as const, parameters: [{ type: 'text', text: doctorName || 'Doutor(a)' }] },
    // {{1}} do botão "Ver no VitalSync" = sufixo da URL (tela do paciente).
    {
      type: 'button' as const,
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: `patients/${patientId}` }],
    },
  ];

  try {
    const providerId = await sendWhatsAppTemplate({
      to,
      templateName,
      templateLang: TEMPLATE_LANG,
      components,
    });
    return { providerId, fallbackNote: null };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (templateName === TEMPLATE_NAME || !isUnknownTemplateError(msg)) throw e;

    const providerId = await sendWhatsAppTemplate({
      to,
      templateName: TEMPLATE_NAME,
      templateLang: TEMPLATE_LANG,
      components,
    });
    return {
      providerId,
      fallbackNote: `Template "${templateName}" indisponível no provedor (${msg}). Enviado com "${TEMPLATE_NAME}".`,
    };
  }
}

/**
 * O erro é "esse template não existe/não está aprovado"? A Meta usa o código
 * 132001 e textos variados ("Template name does not exist in the translation",
 * "template not found"); a 360dialog repassa a mesma família. Só esses casos
 * justificam repetir o envio — erro de número, de token ou de limite deve
 * falhar como antes.
 */
function isUnknownTemplateError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('132001') || (m.includes('template') && (m.includes('not exist') || m.includes('not found') || m.includes('does not exist')));
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
      .select('id, recipient_name, recipient_phone, template_name')
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

    const hasProvider = isWhatsAppConfigured();

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
        // Sem credenciais do provedor ativo: registra como simulado (não envia de verdade).
        await supabase
          .from('notification_logs')
          .update({ status: 'logged', sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
        continue;
      }
      try {
        const { providerId, fallbackNote } = await sendAlert(
          log.recipient_phone,
          log.recipient_name ?? '',
          patientId,
          log.template_name ?? TEMPLATE_NAME,
        );
        await supabase
          .from('notification_logs')
          .update({
            status: 'SENT',
            provider_message_id: providerId,
            sent_at: now,
            // Enviado, mas com o template padrão: o aviso fica no log para o
            // Admin saber que o template do evento ainda não está aprovado.
            error_message: fallbackNote,
          })
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
