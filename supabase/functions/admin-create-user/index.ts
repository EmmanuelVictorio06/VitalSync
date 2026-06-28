// ============================================================================
// Edge Function: admin-create-user
//
// Cria a conta de login + profile de um usuário (qualquer papel do sistema) via
// a API oficial do Auth (auth.admin.createUser) — em vez de inserir à mão em
// auth.users/auth.identities (frágil, acoplado ao GoTrue). Mesmo caminho seguro
// que o accept-invite já usa. Roda com service_role.
//
// Fluxo:
//   1. Autentica o chamador pelo JWT (Authorization: Bearer ...).
//   2. Autoriza: apenas ADMIN ATIVO.
//   3. Valida nome/e-mail/senha/papel/status.
//   4. Garante e-mail único (mensagem amigável).
//   5. Cria a conta (email_confirm = true → login imediato).
//   6. Completa o profile (whatsapp/role/status/specialty/crm/notes). O trigger
//      handle_new_user já criou a linha base; set_professional_tag gera a tag.
//
// Body: { name, email, password, whatsapp?, role, status?, specialty?, crm?, notes? }
//   →  { id }  (201) | { error } (4xx/5xx)
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ROLES = ['ADMIN', 'MAIN_SURGEON', 'ASSOCIATED_DOCTOR', 'SUPPORT'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    // 1. Autenticação do chamador.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: 'Não autenticado.' }, 401);

    // 2. Autorização: somente ADMIN ATIVO.
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, status')
      .eq('id', caller.id)
      .maybeSingle();
    if (callerProfile?.role !== 'ADMIN' || callerProfile?.status !== 'ACTIVE') {
      return json({ error: 'Você não tem permissão para realizar esta ação.' }, 403);
    }

    // 3. Validação dos campos.
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = String(body.role ?? '');
    const status = (String(body.status ?? 'ACTIVE') || 'ACTIVE').toUpperCase();
    const whatsapp = String(body.whatsapp ?? '').replace(/\D/g, '') || null;
    const specialty = (String(body.specialty ?? '').trim()) || null;
    const crm = (String(body.crm ?? '').trim()) || null;
    const notes = (String(body.notes ?? '').trim()) || null;

    if (!name) return json({ error: 'Informe o nome do usuário.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (password.length < 6) return json({ error: 'A senha deve ter ao menos 6 caracteres.' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Papel inválido.' }, 400);
    if (status !== 'ACTIVE' && status !== 'INACTIVE') return json({ error: 'Status inválido.' }, 400);

    // 4. Unicidade de e-mail (mensagem amigável antes de tentar criar).
    const { data: dupEmail } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (dupEmail) return json({ error: 'Este e-mail já está em uso.' }, 409);

    // 5. Cria a conta no Auth (e-mail já confirmado → login imediato).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (createErr || !created?.user) {
      const msg = /already|registered|exists/i.test(createErr?.message ?? '')
        ? 'Este e-mail já está em uso.'
        : (createErr?.message ?? 'Não foi possível criar a conta.');
      return json({ error: msg }, 400);
    }
    const userId = created.user.id;

    // 6. Completa o profile (a linha base já veio do trigger handle_new_user).
    const { error: profErr } = await admin
      .from('profiles')
      .update({ name, email, whatsapp, role, status, specialty, crm, notes })
      .eq('id', userId);
    if (profErr) return json({ error: profErr.message }, 400);

    return json({ id: userId }, 201);
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
