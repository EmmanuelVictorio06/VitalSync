// ============================================================================
// Edge Function: upload-patient-photo
//
// Upload da foto de ferida/dreno do paciente (anônimo, por link) COM gate de
// CPF real. Antes de gravar no Storage, revalida a identidade (CPF) e o
// rate-limit por link — o mesmo gate do envio da medição — e só então sobe o
// arquivo no bucket `patient-photos` via service_role.
//
// Isto fecha o follow-up das migrations 0014/0020: a policy anon de INSERT no
// bucket é removida (migration 0042) e o upload passa a ter porta ÚNICA aqui.
// O patientId (pasta de destino) é resolvido NO SERVIDOR a partir do token —
// o cliente nunca escolhe a pasta.
//
// CPF puro nunca é gravado nem logado. Erros de identidade são genéricos.
//
// Body: multipart/form-data { token, cpf, kind: 'wound'|'drain', file }
//   →  { path } (200) | erro
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyPatientCpf } from '../_shared/patientAccess.ts';

const UPLOAD_FAIL = 'Não foi possível enviar a foto. Tente novamente.';

// Regras da foto (espelham WOUND_PHOTO de @vitalsync/shared — Edge/Deno não
// importa o pacote; manter em sincronia com packages/shared/src/types.ts).
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const TOO_LARGE = 'A imagem é muito grande. Envie uma foto menor ou tente novamente.';
const INVALID_FORMAT = 'Formato inválido. Envie uma imagem JPG, PNG ou WEBP.';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pepper = Deno.env.get('CPF_PEPPER');
    if (!pepper) return json({ error: 'Serviço indisponível no momento.' }, 503);

    const admin = createClient(url, serviceKey);

    const fd = await req.formData().catch(() => null);
    if (!fd) return json({ error: UPLOAD_FAIL }, 400);
    const token = String(fd.get('token') ?? '');
    const cpf = String(fd.get('cpf') ?? '');
    const kind = String(fd.get('kind') ?? 'wound');
    const file = fd.get('file');

    if (!token) return json({ error: UPLOAD_FAIL }, 400);
    if (kind !== 'wound' && kind !== 'drain') return json({ error: UPLOAD_FAIL }, 400);
    if (!(file instanceof File)) return json({ error: UPLOAD_FAIL }, 400);

    // Validação do arquivo no servidor (autoritativa; a do front é só UX).
    if (!ACCEPTED_MIME.includes(file.type)) return json({ error: INVALID_FORMAT }, 400);
    if (file.size === 0) return json({ error: INVALID_FORMAT }, 400);
    if (file.size > MAX_BYTES) return json({ error: TOO_LARGE }, 400);

    // Gate de CPF + rate-limit (mesmo helper da medição).
    const gate = await verifyPatientCpf(admin, token, cpf, pepper);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    // Resolve o paciente NO SERVIDOR — a pasta de destino nunca vem do cliente.
    const { data: p } = await admin
      .from('patients')
      .select('id')
      .eq('secure_token', token)
      .maybeSingle();
    if (!p) return json({ error: UPLOAD_FAIL }, 400);

    const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const ext = ACCEPTED_EXT.includes(rawExt) ? rawExt : 'jpg';
    const path = `${p.id}/${kind}-${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await admin.storage
      .from('patient-photos')
      .upload(path, bytes, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (error) return json({ error: UPLOAD_FAIL }, 500);

    return json({ path }, 200);
  } catch {
    return json({ error: UPLOAD_FAIL }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
