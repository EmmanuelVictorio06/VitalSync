// ============================================================================
// Edge Function: process-vital-record
//
// Recebe a medição do PACIENTE (anônimo, identificado pelo secure_token),
// grava em vital_sign_records, calcula o status clínico e cria o alerta quando
// for YELLOW/RED — tudo com service_role (RLS é contornado de forma segura aqui,
// pois validamos o token e o paciente NÃO tem acesso direto às tabelas).
//
// Deploy: supabase functions deploy process-vital-record
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (já disponíveis no runtime).
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type Status = 'GREEN' | 'YELLOW' | 'RED';

/** Cálculo simplificado do status. TODO: reaproveitar as regras de @vitalsync/shared. */
function computeStatus(v: Record<string, number | boolean | undefined>): Status {
  let s: Status = 'GREEN';
  const bump = (to: Status) => {
    if (to === 'RED') s = 'RED';
    else if (to === 'YELLOW' && s !== 'RED') s = 'YELLOW';
  };
  const temp = Number(v.temperature ?? 36.5);
  const spo2 = Number(v.oxygen_saturation ?? 98);
  const pain = Number(v.pain_level ?? 0);
  if (temp >= 38.5 || spo2 < 92 || pain >= 8 || v.has_bleeding === true) bump('RED');
  else if (temp >= 37.8 || spo2 < 94 || pain >= 5) bump('YELLOW');
  return s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const token = String(body.secure_token ?? '');
    if (!token) return json({ error: 'secure_token obrigatório' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: patient, error: pErr } = await supabase
      .from('patients')
      .select('id, team_id, status')
      .eq('secure_token', token)
      .single();
    if (pErr || !patient || patient.status !== 'ACTIVE') return json({ error: 'Link inválido' }, 404);

    const clinical_status = computeStatus(body);

    const { data: record, error: rErr } = await supabase
      .from('vital_sign_records')
      .insert({
        patient_id: patient.id,
        period: body.period ?? 'MORNING',
        temperature: body.temperature,
        oxygen_saturation: body.oxygen_saturation,
        systolic_pressure: body.systolic_pressure,
        diastolic_pressure: body.diastolic_pressure,
        heart_rate: body.heart_rate,
        pain_level: body.pain_level,
        dyspnea_level: body.dyspnea_level,
        urination_count: body.urination_count,
        vomiting_count: body.vomiting_count,
        has_bleeding: body.has_bleeding ?? false,
        steps: body.steps,
        wound_photo_path: body.wound_photo_path,
        clinical_status,
      })
      .select('id')
      .single();
    if (rErr) return json({ error: rErr.message }, 400);

    await supabase.from('patients').update({ current_status: clinical_status }).eq('id', patient.id);

    if (clinical_status !== 'GREEN') {
      await supabase.from('clinical_alerts').insert({
        patient_id: patient.id,
        team_id: patient.team_id,
        vital_record_id: record.id,
        status: clinical_status,
        description:
          clinical_status === 'RED'
            ? 'Alerta vermelho: sinais vitais críticos.'
            : 'Atenção: sinais vitais limítrofes.',
      });
      // TODO: invocar send-whatsapp-alert para notificar os médicos da equipe.
    }

    return json({ clinical_status });
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
