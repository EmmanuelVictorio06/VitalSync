// ============================================================================
// Edge Function: export-data  (STUB)
//
// Exportações mais pesadas (CSV/XLSX) com regras e escopo aplicados no servidor.
// Mantém a lógica sensível fora do frontend. Body: { dataset, filters }.
// TODO: gerar o arquivo (CSV/XLSX) respeitando o papel/escopo do solicitante.
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(
    JSON.stringify({ ok: false, message: 'export-data ainda não implementado (stub).' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
