// ============================================================================
// Edge Function: whatsapp-webhook
//
// Recebe os callbacks de status da Meta (WhatsApp Cloud API) e atualiza
// notification_logs por provider_message_id:
//   sent → SENT · delivered → DELIVERED · read → READ · failed → FAILED
//
// • GET  : responde ao challenge de verificação da Meta (hub.challenge),
//          validando hub.verify_token contra o secret WHATSAPP_VERIFY_TOKEN.
// • POST : processa entry[].changes[].value.statuses[] de forma IDEMPOTENTE
//          (só avança o status; nunca rebaixa; grava delivered_at/read_at).
//
// Configurar na Meta:
//   Callback URL: https://<project>.functions.supabase.co/whatsapp-webhook
//   Verify token: o mesmo valor de WHATSAPP_VERIFY_TOKEN
//
// Deploy SEM verificação de JWT (a Meta não envia o header):
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Ordem de progressão — evita rebaixar um status já mais avançado.
const RANK: Record<string, number> = {
  PENDING: 0,
  logged: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5, // terminal — sempre registra o erro
};

const META_TO_STATUS: Record<string, string> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

serve(async (req) => {
  const url = new URL(req.url);

  // --- Verificação do webhook (Meta envia um GET único na configuração) ---
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) {
      return new Response(challenge ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let updated = 0;
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const st of change?.value?.statuses ?? []) {
          const providerId: string | undefined = st?.id;
          const next = META_TO_STATUS[st?.status];
          if (!providerId || !next) continue;

          const { data: row } = await supabase
            .from('notification_logs')
            .select('id, status')
            .eq('provider_message_id', providerId)
            .maybeSingle();
          if (!row) continue;

          // Idempotência: só avança (FAILED sempre é registrado).
          if (next !== 'FAILED' && (RANK[next] ?? 0) <= (RANK[row.status] ?? 0)) continue;

          const at = st?.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString();
          const patch: Record<string, unknown> = { status: next };
          if (next === 'DELIVERED') patch.delivered_at = at;
          if (next === 'READ') {
            patch.read_at = at;
            patch.delivered_at = (row as { delivered_at?: string }).delivered_at ?? at;
          }
          if (next === 'FAILED') {
            patch.error_message = st?.errors?.[0]?.title ?? st?.errors?.[0]?.message ?? 'Falha relatada pela Meta.';
          }
          await supabase.from('notification_logs').update(patch).eq('id', row.id);
          updated++;
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Sempre 200 para a Meta não reenfileirar indefinidamente; loga o erro.
    console.error('whatsapp-webhook error', e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
