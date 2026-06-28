// ============================================================================
// Edge Function: validate-patient-access
//
// Gate de identidade do link público: antes de exibir qualquer dado do
// paciente, ele confirma o CPF. A comparação (cpf_hash via CPF_PEPPER) e o
// rate-limit ficam no helper compartilhado _shared/patientAccess.ts. Roda com
// service_role (segredo nunca chega ao frontend).
//
// Body: { token, cpf }  →  { patient: PatientLinkInfo }  (200) | erro genérico
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { GENERIC_FAIL, verifyPatientCpf } from '../_shared/patientAccess.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    if (!pepper) return json({ error: 'Serviço indisponível no momento.' }, 503);

    const admin = createClient(url, serviceKey);

    const { token, cpf } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string') return json({ error: GENERIC_FAIL }, 401);

    // Gate de CPF + rate-limit (helper compartilhado).
    const gate = await verifyPatientCpf(admin, token, cpf, pepper);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    // Sucesso: devolve os dados públicos do paciente (RPC via service_role).
    const { data: info, error: rpcErr } = await admin.rpc('get_patient_by_token', { p_token: token });
    const row = Array.isArray(info) ? info[0] : info;
    if (rpcErr || !row) return json({ error: GENERIC_FAIL }, 401);

    return json({ patient: row }, 200);
  } catch {
    // Nunca vaza detalhe técnico na tela pública.
    return json({ error: 'Não foi possível validar agora. Tente novamente.' }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
