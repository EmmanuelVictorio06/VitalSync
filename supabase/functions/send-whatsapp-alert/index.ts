// ============================================================================
// Edge Function: send-whatsapp-alert  (STUB)
//
// Envia o alerta por WhatsApp para os médicos da equipe e registra em
// notification_logs. O TOKEN da API do WhatsApp fica como SECRET no Supabase
// (nunca no frontend): supabase secrets set WHATSAPP_API_TOKEN=...
//
// Por enquanto registra como "logged" (sem provider real) — pronto para plugar
// Twilio/Meta quando houver templates aprovados.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { alert_id } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: alert } = await supabase
      .from('clinical_alerts')
      .select('id, patient_id, team_id, description')
      .eq('id', alert_id)
      .single();
    if (!alert) return json({ error: 'Alerta não encontrado' }, 404);

    // Destinatários: cirurgião responsável + associados ativos da equipe.
    const { data: team } = await supabase.from('medical_teams').select('main_surgeon_id').eq('id', alert.team_id).single();
    const { data: members } = await supabase
      .from('team_members')
      .select('doctor_id')
      .eq('team_id', alert.team_id)
      .eq('status', 'ACTIVE');
    const recipientIds = [team?.main_surgeon_id, ...(members ?? []).map((m) => m.doctor_id)].filter(Boolean);

    for (const profileId of recipientIds) {
      // TODO: integrar provider real (Twilio/Meta) usando WHATSAPP_API_TOKEN.
      await supabase.from('notification_logs').insert({
        patient_id: alert.patient_id,
        recipient_profile_id: profileId,
        channel: 'whatsapp',
        status: 'logged',
        message: alert.description,
        sent_at: new Date().toISOString(),
      });
    }
    return json({ ok: true, recipients: recipientIds.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
