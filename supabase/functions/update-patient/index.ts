// ============================================================================
// Edge Function: update-patient
//
// Atualiza dados de um paciente existente. Roda com service_role + segredos
// (CPF_PEPPER, CPF_ENC_KEY) que NUNCA chegam ao frontend — espelha o
// `create-patient` no padrão de segurança.
//
// Fluxo:
//   1. Autentica o chamador pelo JWT (Authorization: Bearer ...).
//   2. Autoriza: ADMIN, cirurgião responsável da equipe ATUAL do paciente, ou
//      Gerente de Equipe com vínculo ATIVO (team_manager_surgeons) para o
//      cirurgião responsável dessa equipe — mesmo critério de
//      is_team_manager_of() (migration 0030), reimplementado aqui porque a
//      função roda com service_role (sem o JWT do usuário no contexto, então
//      auth.uid() não está disponível para chamar o helper de RLS).
//   3. Carrega o paciente (service_role) para conhecer a equipe e validar.
//   4. Se `cpf` vier preenchido: valida, recalcula cpf_hash/cpf_encrypted e
//      checa unicidade entre pacientes ativos (excluindo o próprio).
//      Se vier vazio/omitido: preserva o CPF existente.
//   5. Só ADMIN pode trocar a equipe (team_id); cirurgião só edita demais campos.
//   6. Faz UPDATE (service_role) só dos campos informados e devolve o paciente
//      atualizado — sem CPF.
//
// Body: { id, name?, birth_date?, phone?, surgery_type_id?, surgery_date?,
//         hospital_discharge_date?, hospital_id?, team_id?, cpf? }
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { encryptCpf, hashCpf, normalizeCpf, validateCpf } from '../_shared/cpf.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    const encKey = Deno.env.get('CPF_ENC_KEY');

    const admin = createClient(url, serviceKey);

    // 1. Autenticação do chamador.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: 'Não autenticado.' }, 401);

    const body = await req.json();
    const patientId: string | undefined = body.id;
    if (!patientId) return json({ error: 'ID do paciente é obrigatório.' }, 400);

    // 2. Perfil do chamador.
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();
    const role = profile?.role;
    const isAdmin = role === 'ADMIN';

    // 3. Carrega o paciente atual (service_role) — precisa do team_id atual.
    const { data: current, error: loadErr } = await admin
      .from('patients')
      .select('id, team_id, deleted_at')
      .eq('id', patientId)
      .maybeSingle();
    if (loadErr) return json({ error: loadErr.message }, 400);
    if (!current) return json({ error: 'Paciente não encontrado.' }, 404);

    // Autorização: ADMIN, cirurgião responsável da equipe atual, ou Gerente de
    // Equipe com vínculo ativo para esse cirurgião responsável.
    let allowed = isAdmin;
    if (!allowed && role === 'MAIN_SURGEON') {
      const { data: team } = await admin
        .from('medical_teams')
        .select('main_surgeon_id')
        .eq('id', current.team_id)
        .maybeSingle();
      allowed = team?.main_surgeon_id === caller.id;
    }
    if (!allowed && role === 'TEAM_MANAGER') {
      const { data: team } = await admin
        .from('medical_teams')
        .select('main_surgeon_id')
        .eq('id', current.team_id)
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
    if (!allowed) {
      return json({ error: 'Sem permissão para editar este paciente.' }, 403);
    }

    // 4. Monta o UPDATE só com campos informados.
    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) return json({ error: 'Informe o nome do paciente.' }, 400);
      update.name = name;
    }
    if (body.birth_date !== undefined) update.birth_date = body.birth_date || null;
    if (body.phone !== undefined) update.phone = body.phone || null;
    if (body.surgery_type_id !== undefined) update.surgery_type_id = body.surgery_type_id || null;
    if (body.surgery_date !== undefined) update.surgery_date = body.surgery_date || null;
    if (body.hospital_discharge_date !== undefined) {
      update.hospital_discharge_date = body.hospital_discharge_date || null;
    }
    if (body.hospital_id !== undefined) update.hospital_id = body.hospital_id || null;
    if (body.medical_record_summary !== undefined) {
      update.medical_record_summary = body.medical_record_summary || null;
    }
    if (body.sex !== undefined) update.sex = body.sex || null;
    if (body.weight_kg !== undefined) update.weight_kg = body.weight_kg ?? null;
    if (body.height_cm !== undefined) update.height_cm = body.height_cm ?? null;
    if (body.comorbidities !== undefined) {
      update.comorbidities = Array.isArray(body.comorbidities) ? body.comorbidities : [];
    }
    if (body.length_of_stay_days !== undefined) update.length_of_stay_days = body.length_of_stay_days ?? null;
    if (body.alternative_phone !== undefined) update.alternative_phone = body.alternative_phone || null;
    if (body.tcle_accepted_at !== undefined) update.tcle_accepted_at = body.tcle_accepted_at || null;
    if (body.study_group !== undefined) {
      if (body.study_group !== 'INTERVENTION' && body.study_group !== 'HISTORICAL_CONTROL') {
        return json({ error: 'Coorte do estudo inválida.' }, 400);
      }
      update.study_group = body.study_group;
    }

    // Troca de equipe: só ADMIN.
    if (body.team_id !== undefined && body.team_id !== current.team_id) {
      if (!isAdmin) {
        return json({ error: 'Apenas o Administrador pode trocar a equipe do paciente.' }, 403);
      }
      const newTeamId = String(body.team_id);
      if (!newTeamId) return json({ error: 'Equipe inválida.' }, 400);
      update.team_id = newTeamId;
    }

    // 5. CPF: só re-hash se vier preenchido. Vazio = preserva o atual.
    const rawCpf = body.cpf !== undefined ? String(body.cpf) : '';
    if (rawCpf.trim() !== '') {
      if (!pepper || !encKey) {
        return json({ error: 'Servidor sem segredos de CPF configurados.' }, 500);
      }
      const cpf = normalizeCpf(rawCpf);
      if (!validateCpf(cpf)) return json({ error: 'CPF inválido. Verifique os dígitos.' }, 400);

      const cpf_hash = await hashCpf(cpf, pepper);
      const cpf_encrypted = await encryptCpf(cpf, encKey);

      // Unicidade entre pacientes ativos, excluindo o próprio.
      const { data: dup } = await admin
        .from('patients')
        .select('id')
        .eq('cpf_hash', cpf_hash)
        .is('deleted_at', null)
        .neq('id', patientId)
        .maybeSingle();
      if (dup) {
        return json({ error: 'Já existe outro paciente cadastrado com este CPF.' }, 409);
      }

      update.cpf_hash = cpf_hash;
      update.cpf_encrypted = cpf_encrypted;
    }

    if (Object.keys(update).length === 0) {
      return json({ error: 'Nenhum campo informado para atualizar.' }, 400);
    }

    // 6. UPDATE (service_role).
    const { data: patient, error: updErr } = await admin
      .from('patients')
      .update(update)
      .eq('id', patientId)
      .select(
        'id, name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date, ' +
          'hospital_id, team_id, secure_token, status, current_status, is_test, created_at, medical_record_summary, ' +
          'sex, weight_kg, height_cm, comorbidities, length_of_stay_days, alternative_phone, tcle_accepted_at',
      )
      .single();

    if (updErr) {
      // 23505 = unique_violation (corrida no índice de cpf_hash).
      if ((updErr as { code?: string }).code === '23505') {
        return json({ error: 'Já existe outro paciente cadastrado com este CPF.' }, 409);
      }
      return json({ error: updErr.message }, 400);
    }

    return json({ patient }, 200);
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
