// ============================================================================
// Edge Function: accept-invite
//
// Auto-cadastro de profissional (médico/cirurgião) a partir de um convite.
// Roda com service_role + segredo CPF_PEPPER. O profissional DEFINE A PRÓPRIA
// SENHA. Nunca expõe service_role ao frontend.
//
// Fluxo:
//   1. Valida o token do convite (existe, não usado, não expirado).
//   2. Valida nome, e-mail, telefone, CPF (formato/dígitos) e CRM.
//   3. Garante e-mail e CPF únicos.
//   4. Cria o usuário no Auth com a senha informada (e-mail confirmado).
//   5. Completa o profile (whatsapp, crm, cpf_hash, role).
//   6. Vincula à equipe do convite (se houver).
//   7. Marca o convite como usado.
//
// Body: { token, name, email, phone, cpf, crm, password }
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { hashCpf, normalizeCpf, validateCpf } from '../_shared/cpf.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    if (!pepper) return json({ error: 'Serviço indisponível no momento.' }, 503);

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const { token, name, email, phone, cpf, crm, password } = body;

    // 1. Convite válido.
    if (!token) return json({ error: 'Convite inválido.' }, 400);
    const { data: invite } = await admin
      .from('professional_invites')
      .select('id, role, team_id, used_at, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (!invite || invite.used_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      return json({ error: 'Convite inválido ou expirado.' }, 410);
    }

    // 2. Validações de campo.
    const cleanName = String(name ?? '').trim();
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const cleanPhone = String(phone ?? '').replace(/\D/g, '');
    const cleanCrm = String(crm ?? '').trim();
    if (cleanName.length < 3) return json({ error: 'Informe o nome completo.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (cleanPhone.length < 10) return json({ error: 'Informe um telefone válido com DDD.' }, 400);
    if (!cleanCrm) return json({ error: 'Informe o CRM.' }, 400);
    if (!validateCpf(cpf ?? '')) return json({ error: 'CPF inválido. Verifique os dígitos.' }, 400);
    if (String(password ?? '').length < 6) return json({ error: 'A senha deve ter ao menos 6 caracteres.' }, 400);

    // 3. Unicidade de e-mail e CPF.
    const cpf_hash = await hashCpf(normalizeCpf(cpf), pepper);
    const { data: dupCpf } = await admin
      .from('profiles')
      .select('id')
      .eq('cpf_hash', cpf_hash)
      .maybeSingle();
    if (dupCpf) return json({ error: 'Já existe um profissional com este CPF.' }, 409);

    const { data: dupEmail } = await admin
      .from('profiles')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();
    if (dupEmail) return json({ error: 'Este e-mail já está em uso.' }, 409);

    // 4. Cria o usuário no Auth (senha do profissional; e-mail já confirmado).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: String(password),
      email_confirm: true,
      user_metadata: { name: cleanName, role: invite.role },
    });
    if (createErr || !created?.user) {
      return json({ error: createErr?.message ?? 'Não foi possível criar a conta.' }, 400);
    }
    const userId = created.user.id;

    // 5. Completa o profile (o trigger handle_new_user já criou a linha base).
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        name: cleanName,
        whatsapp: cleanPhone,
        crm: cleanCrm,
        cpf_hash,
        role: invite.role,
        status: 'ACTIVE',
      })
      .eq('id', userId);
    if (profErr) return json({ error: profErr.message }, 400);

    // 6. Vincula à equipe do convite (se houver). O cirurgião principal fica em
    //    medical_teams.main_surgeon_id (só se a equipe estiver SEM líder — não
    //    desloca um existente); team_members guarda apenas associados (M-12).
    if (invite.team_id) {
      if (invite.role === 'MAIN_SURGEON') {
        await admin
          .from('medical_teams')
          .update({ main_surgeon_id: userId })
          .eq('id', invite.team_id)
          .is('main_surgeon_id', null);
      } else {
        await admin.from('team_members').upsert(
          { team_id: invite.team_id, doctor_id: userId, role_in_team: 'ASSOCIATED_DOCTOR', status: 'ACTIVE' },
          { onConflict: 'team_id,doctor_id' },
        );
      }
    }

    // 7. Marca o convite como usado.
    await admin.from('professional_invites').update({ used_at: new Date().toISOString() }).eq('id', invite.id);

    return json({ ok: true, email: cleanEmail }, 201);
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
