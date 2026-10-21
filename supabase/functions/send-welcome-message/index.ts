// ============================================================================
// Edge Function: send-welcome-message
//
// Entrega por WhatsApp (provedor configurável — ver _shared/whatsapp.ts) os
// welcome_logs PENDENTES — a primeira mensagem que o paciente recebe, no
// momento do cadastro. NÃO decide quem recebe: isso já foi feito pela
// função SQL enqueue_welcome_message (0072), que aplica o gate de
// elegibilidade (paciente ativo COM telefone, uma boas-vindas
// por paciente) e o gate de homologação (só whitelist vira PENDING; o resto
// vira SKIPPED_TEST_MODE).
//
// Acionamento em produção: trigger AFTER INSERT em patients (0072) chama
// public.dispatch_welcome_message(id), que enfileira e faz o POST aqui via
// pg_net com { patient_id }. Também aceita chamada sem patient_id (processa
// TODOS os PENDING — útil para reenvio manual e para recolher retardatários,
// já que o POST do pg_net pode chegar antes do COMMIT do cadastro).
//
// Segurança: mesmo padrão de send-measurement-reminder — a credencial do
// provedor é SECRET (nunca no frontend); sem credenciais do provedor ativo
// configuradas, registra como "logged" (simulado), permitindo testar o
// fluxo sem enviar mensagens reais.
//
// Mensagem SEM dado clínico: só o nome do paciente + link de primeiro acesso.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../_shared/whatsapp.ts';

const TEMPLATE_NAME = Deno.env.get('WHATSAPP_WELCOME_TEMPLATE_NAME') ?? 'boas_vindas_vitalsync';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR';

interface PendingWelcome {
  id: string;
  patient_id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  patients: { secure_token: string } | null;
}

/**
 * Envia o template aprovado pelo provedor configurado. {{1}} do corpo = nome
 * do paciente. O botão "Acessar VitalSync" (URL dinâmica) tem a base fixa
 * `https://vital-sync-frontend-iota.vercel.app/registro-sinais/` configurada na
 * aprovação do template — aqui só passamos o `secure_token` como {{1}} do
 * botão (não o path inteiro), idêntico ao botão do template
 * lembrete_medicao_vitalsync.
 */
async function sendWelcome(to: string, patientName: string, secureToken: string): Promise<string> {
  return sendWhatsAppTemplate({
    to,
    templateName: TEMPLATE_NAME,
    templateLang: TEMPLATE_LANG,
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
  });
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

    const hasProvider = isWhatsAppConfigured();

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
        // Sem credenciais do provedor ativo: registra como simulado (não envia de verdade).
        await supabase
          .from('welcome_logs')
          .update({ status: 'logged', sent_at: now, error_message: null })
          .eq('id', log.id);
        sent++;
        continue;
      }
      try {
        const providerId = await sendWelcome(log.recipient_phone, log.recipient_name ?? '', secureToken);
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
