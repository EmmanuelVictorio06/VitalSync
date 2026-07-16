// ============================================================================
// Edge Function: validate-patient-access
//
// Gate de identidade do link público: antes de exibir qualquer dado do
// paciente, ele confirma o CPF. A comparação (cpf_hash via CPF_PEPPER) e o
// rate-limit ficam no helper compartilhado _shared/patientAccess.ts. Roda com
// service_role (segredo nunca chega ao frontend).
//
// Body: { token, cpf }
//   →  { patient: PatientLinkInfo, periodsFilledToday, allowResendSamePeriod } (200)
//   |  erro genérico
//
// periodsFilledToday: períodos (MORNING/NIGHT) já registrados HOJE no fuso
// America/Sao_Paulo — a tela do paciente usa para bloquear reenvio no mesmo
// período (regra "uma medição por período por dia"), sem expor dados clínicos.
// allowResendSamePeriod: toggle de admin (app_settings/security) que, ligado,
// libera o reenvio (a UI então não bloqueia nada).
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

    // "Hoje" no fuso do paciente (America/Sao_Paulo) — mesmo dia usado pela RPC
    // submit_vital_record ao gravar record_date. en-CA formata como YYYY-MM-DD.
    const hojeSp = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // Períodos já registrados hoje (só o enum MORNING/NIGHT, nada clínico).
    const { data: registros } = await admin
      .from('vital_sign_records')
      .select('period')
      .eq('patient_id', row.id)
      .eq('record_date', hojeSp);
    const periodsFilledToday = [
      ...new Set(((registros ?? []) as Array<{ period: string }>).map((r) => r.period)),
    ];

    // Toggle de admin: permite reenviar/corrigir no mesmo período? (default false)
    const { data: seguranca } = await admin
      .from('app_settings')
      .select('data')
      .eq('section', 'security')
      .maybeSingle();
    const allowResendSamePeriod =
      (seguranca?.data as { allowResendSamePeriod?: boolean } | null)?.allowResendSamePeriod === true;

    return json({ patient: row, periodsFilledToday, allowResendSamePeriod }, 200);
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
