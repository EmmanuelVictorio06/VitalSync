// ============================================================================
// Edge Function: submit-vital-record
//
// Envio da medição do paciente (anônimo, por link) COM gate de CPF real. Antes
// de gravar, revalida a identidade (CPF) e o rate-limit por link — o mesmo gate
// da leitura — e só então chama a RPC submit_vital_record via service_role.
//
// Isto fecha a C-04: as RPCs get_patient_by_token / submit_vital_record deixam
// de ser chamáveis direto pelo papel anon (ver migration 0022); o CPF passa a
// ser barreira de DADOS, não só de UI.
//
// CPF puro nunca é gravado nem logado. Erros de identidade são genéricos.
//
// Body: { token, cpf, measurement: {...} }  →  { clinical_status } (200) | erro
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyPatientCpf } from '../_shared/patientAccess.ts';

const SUBMIT_FAIL = 'Não foi possível enviar sua medição. Tente novamente.';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    if (!pepper) return json({ error: 'Serviço indisponível no momento.' }, 503);

    const admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { token, cpf } = body ?? {};
    const m = (body?.measurement ?? {}) as Record<string, unknown>;
    if (!token || typeof token !== 'string') return json({ error: SUBMIT_FAIL }, 400);
    if (!m.period) return json({ error: SUBMIT_FAIL }, 400);

    // Gate de CPF + rate-limit (mesmo helper da leitura).
    const gate = await verifyPatientCpf(admin, token, cpf, pepper);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    // Grava a medição via RPC (service_role). A RPC calcula status/alerta/notify.
    const { data, error } = await admin.rpc('submit_vital_record', {
      p_token: token,
      p_period: m.period,
      p_temperature: m.temperature ?? null,
      p_oxygen_saturation: m.oxygen_saturation ?? null,
      p_systolic: m.systolic_pressure ?? null,
      p_diastolic: m.diastolic_pressure ?? null,
      p_heart_rate: m.heart_rate ?? null,
      p_pain: m.pain_level ?? null,
      p_dyspnea: m.dyspnea_level ?? null,
      p_urination_count: m.urination_count ?? null,
      p_vomiting_count: m.vomiting_count ?? null,
      p_has_bleeding: m.has_bleeding ?? false,
      p_steps: m.steps ?? null,
      p_wound_photo_path: m.wound_photo_path ?? null,
      p_has_drain: m.has_drain ?? false,
      p_drain_photo_path: m.drain_photo_path ?? null,
      p_urinated_normally: m.urinated_normally ?? null,
      p_had_vomit: m.had_vomit ?? null,
    });
    if (error || !data) return json({ error: SUBMIT_FAIL }, 400);

    return json({ clinical_status: data }, 200);
  } catch {
    return json({ error: 'Não foi possível enviar agora. Tente novamente.' }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
