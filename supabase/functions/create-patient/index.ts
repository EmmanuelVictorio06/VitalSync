// ============================================================================
// Edge Function: create-patient
//
// Cadastra paciente com CPF protegido. Roda com service_role + segredos
// (CPF_PEPPER, CPF_ENC_KEY) que NUNCA chegam ao frontend.
//
// Fluxo:
//   1. Autentica o chamador pelo JWT (Authorization: Bearer ...).
//   2. Autoriza: ADMIN, ou cirurgião responsável da equipe informada.
//   3. Valida o CPF (formato + dígitos verificadores).
//   4. Calcula cpf_hash (HMAC) e cpf_encrypted (AES-GCM).
//   5. Garante unicidade do CPF entre pacientes ativos.
//   6. Valida que a alta hospitalar não é anterior à cirurgia (mesmo dia é
//      válido) — hospital_discharge_date é o marco zero do monitoramento;
//      servidor é a autoridade final, o frontend só dá feedback de UX.
//   7. Insere o paciente e devolve { id, secure_token } — sem CPF.
//
// Body: { name, birth_date?, phone?, surgery_type_id, surgery_date?,
//         hospital_discharge_date?, hospital_id, team_id, is_test?, cpf }
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { encryptCpf, hashCpf, normalizeCpf, validateCpf } from '../_shared/cpf.ts';

// Espelha `isDischargeAfterSurgery` de packages/shared/src/utils.ts —
// Edge/Deno não importa o pacote npm; manter em sincronia. Comparação por
// STRING 'YYYY-MM-DD' (lexicograficamente ordenável), nunca `new Date(iso)`:
// seria interpretado como meia-noite UTC e desloca a data em fusos negativos
// (ex.: America/Sao_Paulo).
const DISCHARGE_BEFORE_SURGERY_ERROR =
  'A data da alta hospitalar não pode ser anterior à data da cirurgia.';
function isDischargeAfterSurgery(surgeryIso?: string | null, dischargeIso?: string | null): boolean {
  if (!surgeryIso || !dischargeIso) return true;
  return dischargeIso >= surgeryIso;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    const encKey = Deno.env.get('CPF_ENC_KEY');
    if (!pepper || !encKey) {
      return json({ error: 'Servidor sem segredos de CPF configurados.' }, 500);
    }

    const admin = createClient(url, serviceKey);

    // 1. Autenticação do chamador.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: 'Não autenticado.' }, 401);

    const body = await req.json();
    const teamId: string | undefined = body.team_id;
    if (!teamId) return json({ error: 'Equipe é obrigatória.' }, 400);

    // 2. Autorização: ADMIN ou Gerente de Equipe vinculado à equipe informada.
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();
    const role = profile?.role;
    let allowed = role === 'ADMIN';
    if (!allowed && role === 'TEAM_MANAGER') {
      // Verifica se o gerente está vinculado ao cirurgião responsável da equipe.
      const { data: team } = await admin
        .from('medical_teams')
        .select('main_surgeon_id')
        .eq('id', teamId)
        .maybeSingle();
      if (team?.main_surgeon_id) {
        const { data: link } = await admin
          .from('team_manager_surgeons')
          .select('id')
          .eq('team_manager_id', caller.id)
          .eq('surgeon_id', team.main_surgeon_id)
          .eq('is_active', true)
          .maybeSingle();
        allowed = !!link;
      }
    }
    if (!allowed) return json({ error: 'Sem permissão para cadastrar pacientes nesta equipe.' }, 403);

    // 3. Validação do CPF (autoritativa no servidor).
    const cpf = normalizeCpf(body.cpf ?? '');
    if (!validateCpf(cpf)) return json({ error: 'CPF inválido. Verifique os dígitos.' }, 400);

    // 4. Hash + cifra.
    const cpf_hash = await hashCpf(cpf, pepper);
    const cpf_encrypted = await encryptCpf(cpf, encKey);

    // 5. Unicidade entre pacientes ativos (mensagem amigável antes do índice).
    const { data: dup } = await admin
      .from('patients')
      .select('id')
      .eq('cpf_hash', cpf_hash)
      .is('deleted_at', null)
      .maybeSingle();
    if (dup) return json({ error: 'Já existe um paciente cadastrado com este CPF.' }, 409);

    // 6. Ordem das datas clínicas.
    if (!isDischargeAfterSurgery(body.surgery_date, body.hospital_discharge_date)) {
      return json({ error: DISCHARGE_BEFORE_SURGERY_ERROR }, 400);
    }

    // 7. Inserção (service_role). Só campos esperados — nunca o CPF puro.
    const insert = {
      name: body.name,
      birth_date: body.birth_date ?? null,
      phone: body.phone ?? null,
      surgery_type_id: body.surgery_type_id ?? null,
      surgery_date: body.surgery_date ?? null,
      hospital_discharge_date: body.hospital_discharge_date ?? null,
      hospital_id: body.hospital_id ?? null,
      team_id: teamId,
      is_test: body.is_test ?? false,
      medical_record_summary: body.medical_record_summary ?? null,
      sex: body.sex ?? null,
      weight_kg: body.weight_kg ?? null,
      height_cm: body.height_cm ?? null,
      comorbidities: Array.isArray(body.comorbidities) ? body.comorbidities : [],
      length_of_stay_days: body.length_of_stay_days ?? null,
      alternative_phone: body.alternative_phone ?? null,
      tcle_accepted_at: body.tcle_accepted_at ?? null,
      cpf_hash,
      cpf_encrypted,
    };
    const { data: patient, error: insErr } = await admin
      .from('patients')
      .insert(insert)
      .select('id, name, phone, team_id, secure_token, current_status, status, is_test, created_at')
      .single();
    if (insErr) {
      // 23505 = unique_violation (corrida no índice de cpf_hash).
      if ((insErr as { code?: string }).code === '23505') {
        return json({ error: 'Já existe um paciente cadastrado com este CPF.' }, 409);
      }
      return json({ error: insErr.message }, 400);
    }

    return json({ patient }, 201);
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
