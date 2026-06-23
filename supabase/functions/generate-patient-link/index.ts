// ============================================================================
// Edge Function: generate-patient-link  (STUB)
//
// Gera (ou regenera) o link seguro do paciente a partir do secure_token e monta
// a URL de WhatsApp. Mantém o token protegido e centraliza a regra.
// Body: { patient_id }  ·  Requer usuário autenticado da equipe (validar no futuro).
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { patient_id } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: patient } = await supabase
      .from('patients')
      .select('name, phone, secure_token')
      .eq('id', patient_id)
      .single();
    if (!patient) return json({ error: 'Paciente não encontrado' }, 404);

    const baseUrl = Deno.env.get('PUBLIC_WEB_URL') ?? '';
    const link = `${baseUrl}/r/${patient.secure_token}`;
    const message = `Olá, ${patient.name}! Registre seus sinais vitais de hoje neste link seguro: ${link}`;
    const phone = (patient.phone ?? '').replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;

    return json({ link, whatsappUrl });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
