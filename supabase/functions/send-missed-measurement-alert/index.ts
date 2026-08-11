// ============================================================================
// Edge Function: send-missed-measurement-alert
//
// Entrega por WhatsApp (Meta Cloud API) os missed_measurement_logs PENDENTES
// — alerta OPERACIONAL para a equipe (priorizando o Profissional de
// Enfermagem) quando o paciente não registrou um período depois que a janela
// de medição fechou. NÃO decide destinatários nem aplica o gate de
// homologação — isso já foi feito pela função SQL
// enqueue_missed_measurement_alerts (0061), que resolve a prioridade de
// enfermagem/fallback de equipe e o gate de homologação (0018).
//
// Acionamento em produção: pg_cron (10:15/20:15 America/Sao_Paulo, 15min
// depois do fechamento de cada janela) chama
// public.dispatch_missed_measurement_alerts(period), que enfileira e faz o
// POST aqui via pg_net com { period }. Também aceita chamada direta sem
// period (processa todos os PENDING de qualquer período).
//
// Segurança: mesmo padrão de send-whatsapp-alert/send-measurement-reminder —
// token da Meta é SECRET (nunca no frontend); sem credenciais configuradas,
// registra como "logged" (simulado).
//
// Mensagem SEM dado clínico sensível: nome do destinatário, nome do
// paciente, período ("manhã"/"noite") e um link para a tela do paciente.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GRAPH_VERSION = 'v20.0';
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_MISSED_MEASUREMENT_TEMPLATE_NAME') ?? 'alerta_medicao_esquecida_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingMissedLog {
  id: string;
  patient_id: string;
  period: 'MORNING' | 'NIGHT';
  recipient_name: string | null;
  recipient_phone: string | null;
  patients: { name: string } | null;
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

function periodLabelPt(period: 'MORNING' | 'NIGHT'): string {
  return period === 'MORNING' ? 'manhã' : 'noite';
}

/**
 * Envia o template aprovado via Meta Cloud API. {{1}}/{{2}}/{{3}} do corpo =
 * nome do destinatário, nome do paciente, período. O botão "Ver paciente"
 * (URL dinâmica) tem a base fixa aprovada no template — aqui só passamos
 * `patients/${patientId}` como {{1}} do botão, mesmo padrão de
 * send-whatsapp-alert (link é da equipe, não do paciente).
 */
async function sendViaMeta(
  token: string,
  phoneNumberId: string,
  to: string,
  recipientName: string,
  patientName: string,
  period: 'MORNING' | 'NIGHT',
  patientId: string,
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
          {
            type: 'body',
            parameters: [
              { type: 'text', text: recipientName || 'equipe' },
              { type: 'text', text: patientName || 'paciente' },
              { type: 'text', text: periodLabelPt(period) },
            ],
          },
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
    const period: string | undefined = body?.period;
    if (period && period !== 'MORNING' && period !== 'NIGHT') {
      return json({ error: 'period inválido (use MORNING ou NIGHT)' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = supabase
      .from('missed_measurement_logs')
      .select('id, patient_id, period, recipient_name, recipient_phone, patients(name)')
      .eq('status', 'PENDING');
    if (period) query = query.eq('period', period);

    const { data: logs, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const pending = (logs ?? []) as unknown as PendingMissedLog[];
    if (pending.length === 0) return json({ ok: true, sent: 0, failed: 0 });

    const token = Deno.env.get('WHATSAPP_API_TOKEN');
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    const hasProvider = Boolean(token && phoneNumberId);

    let sent = 0;
    let failed = 0;
    for (const log of pending) {
      const now = new Date().toISOString();
      const patientName = log.patients?.name;
      if (!log.recipient_phone || !patientName) {
        await supabase
          .from('missed_measurement_logs')
          .update({ status: 'FAILED', error_message: 'Destinatário sem telefone ou paciente sem nome.' })
          .eq('id', log.id);
        failed++;
        continue;
      }
      if (!hasProvider) {
        // Sem credenciais Meta: registra como simulado (não envia de verdade).
        await supabase
          .from('missed_measurement_logs')
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
          patientName,
          log.period,
          log.patient_id,
        );
        await supabase
          .from('missed_measurement_logs')
          .update({ status: 'SENT', provider_message_id: providerId, sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
      } catch (e) {
        await supabase
          .from('missed_measurement_logs')
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
