// ============================================================================
// Edge Function: validate-patient-access
//
// Gate de identidade do link público: antes de exibir qualquer dado do
// paciente, ele confirma o CPF. A comparação usa o cpf_hash (HMAC com
// CPF_PEPPER) — segredo que vive só aqui. Roda com service_role.
//
// Regras de segurança:
//   • Erro SEMPRE genérico — nunca revela se o CPF/paciente existe.
//   • CPF puro nunca é gravado nem logado.
//   • Tentativas limitadas por link (tabela public_access_attempts).
//   • Pacientes legados (sem cpf_hash) continuam acessíveis (não há o que
//     comparar) — preserva links já enviados antes desta feature.
//
// Body: { token, cpf }  →  { patient: PatientLinkInfo }  (200) | erro genérico
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { hashCpf, normalizeCpf, validateCpf } from '../_shared/cpf.ts';

// Mensagem única para qualquer falha de identidade (não revela existência).
const GENERIC_FAIL = 'CPF não confere com este link. Verifique os dados e tente novamente.';
const LOCK_MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

const MAX_ATTEMPTS = 5; // tentativas antes do bloqueio
const WINDOW_MIN = 15; // janela de contagem (minutos)
const LOCK_MIN = 15; // duração do bloqueio (minutos)

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

    // 1. Rate-limit por link.
    const now = Date.now();
    const { data: rl } = await admin
      .from('public_access_attempts')
      .select('attempts, first_attempt_at, locked_until')
      .eq('token', token)
      .maybeSingle();
    if (rl?.locked_until && new Date(rl.locked_until).getTime() > now) {
      return json({ error: LOCK_MESSAGE }, 429);
    }

    // 2. Localiza o paciente ativo do link (sem revelar nada ainda).
    const { data: patient } = await admin
      .from('patients')
      .select('cpf_hash, status, deleted_at')
      .eq('secure_token', token)
      .maybeSingle();

    const active = patient && patient.status === 'ACTIVE' && !patient.deleted_at;

    // 3. Decide se a identidade confere.
    let ok = false;
    if (active) {
      if (!patient!.cpf_hash) {
        ok = true; // paciente legado: sem hash para comparar → libera.
      } else if (validateCpf(cpf ?? '')) {
        ok = (await hashCpf(cpf, pepper)) === patient!.cpf_hash;
      }
    }

    if (!ok) {
      await registerFailure(admin, token, rl, now);
      return json({ error: GENERIC_FAIL }, 401);
    }

    // 4. Sucesso: zera o contador e devolve os dados públicos do paciente
    //    reaproveitando a RPC já existente.
    await admin.from('public_access_attempts').delete().eq('token', token);
    const { data: info, error: rpcErr } = await admin.rpc('get_patient_by_token', { p_token: token });
    const row = Array.isArray(info) ? info[0] : info;
    if (rpcErr || !row) return json({ error: GENERIC_FAIL }, 401);

    return json({ patient: row }, 200);
  } catch {
    // Nunca vaza detalhe técnico na tela pública.
    return json({ error: 'Não foi possível validar agora. Tente novamente.' }, 500);
  }
});

/** Incrementa o contador de falhas e aplica bloqueio ao exceder o limite. */
async function registerFailure(
  admin: ReturnType<typeof createClient>,
  token: string,
  current: { attempts: number; first_attempt_at: string } | null,
  now: number,
): Promise<void> {
  const windowMs = WINDOW_MIN * 60_000;
  const withinWindow =
    current && now - new Date(current.first_attempt_at).getTime() < windowMs;
  const attempts = (withinWindow ? current!.attempts : 0) + 1;
  const locked = attempts >= MAX_ATTEMPTS;

  await admin.from('public_access_attempts').upsert({
    token,
    attempts,
    first_attempt_at: withinWindow ? current!.first_attempt_at : new Date(now).toISOString(),
    locked_until: locked ? new Date(now + LOCK_MIN * 60_000).toISOString() : null,
    updated_at: new Date(now).toISOString(),
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
