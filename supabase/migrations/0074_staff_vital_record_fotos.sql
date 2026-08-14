-- ============================================================================
-- Migration: 0074_staff_vital_record_fotos  (FUNC 3)
--
-- A enfermagem passa a poder anexar foto de CICATRIZ e de DRENO no mesmo ato de
-- lançar a medição esquecida do paciente. Escopo contido: a foto é parte do
-- lançamento (`staff_insert_vital_record`), NÃO um fluxo de "anexar a qualquer
-- momento".
--
-- A nota da 0062 ("4) Sem fotos de ferida/dreno: o upload por token (Storage)
-- não está disponível para staff autenticado") está RESOLVIDA — e a solução não
-- é uma Edge Function nova: a policy `patient_photos_write` (0020, intacta após
-- a 0042) já autoriza `authenticated` a inserir em `{patientId}/...` quando
-- `is_admin() or is_team_member(patient_team_id(...))`. O enfermeiro-membro-de-
-- equipe sobe pelo cliente do Storage e passa só o PATH para esta RPC.
--
-- POR QUE DROP + CREATE E NÃO `create or replace`:
--   Acrescentar dois parâmetros com DEFAULT criaria uma SOBRECARGA (19 args e
--   21 args coexistindo). O PostgREST resolve a função pelo NOME e falha com
--   "Could not choose the best candidate function" / "function is not unique"
--   quando há ambiguidade. Então dropamos a assinatura exata de 19 args (viva
--   desde a 0062, reescrita pela 0067) e criamos a de 21.
--
-- BASE: a versão VIVA é a da 0067 (seção 8) — NÃO a da 0062. O corpo abaixo é
-- idêntico a ela, com UMA mudança: as duas colunas de foto no INSERT. Toda a
-- lógica clínica (gate de janela fechada, unicidade do período,
-- eval_clinical_status com os mesmos 15 args, reaferição, criação de
-- clinical_alerts + notify_team_of_alert, resolução de missed_measurement_logs,
-- trilha LGPD) permanece intocada.
--
-- REGRA DO DRENO espelhada de `submit_vital_record` (0053, linha 322):
--   drain_photo_path só é gravado quando has_drain = true; caso contrário NULL,
--   mesmo que o caller mande um path. Uma foto de dreno sem dreno declarado é
--   dado inconsistente, e o registro é a fonte do prontuário.
--
-- `measurement_photos` NÃO é tocada aqui: o trigger `trg_sync_measurement_photos`
-- (0014) espelha as duas colunas automaticamente em qualquer caminho de escrita,
-- e é ele que faz a foto aparecer para a equipe (policy
-- `measurement_photos_select`, por equipe do paciente).
--
-- ADITIVA (nenhuma coluna nova, nenhum dado apagado). Rode após a 0073.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Remove a assinatura antiga (19 args) — a lista abaixo é EXATAMENTE a da
--    0062/0067. `if exists` mantém a migration idempotente.
-- ----------------------------------------------------------------------------
drop function if exists public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int,
  boolean, boolean, boolean, boolean, int, boolean
);

-- ----------------------------------------------------------------------------
-- 2) Nova assinatura (21 args). A ORDEM dos parâmetros espelha
--    `submit_vital_record` (0053): as fotos cercam `p_has_drain`.
--    O frontend chama por parâmetro NOMEADO (`supabase.rpc`), então a posição
--    não quebra o caller — mas a ordem espelhada evita divergência na leitura.
-- ----------------------------------------------------------------------------
create or replace function public.staff_insert_vital_record(
  p_patient_id           uuid,
  p_period               text,
  p_temperature          numeric  default null,
  p_oxygen_saturation    int      default null,
  p_systolic             int      default null,
  p_diastolic            int      default null,
  p_heart_rate           int      default null,
  p_pain                 int      default null,
  p_dyspnea              int      default null,
  p_urination_count      int      default null,
  p_vomiting_count       int      default null,
  p_has_bleeding         boolean  default false,
  p_steps                int      default null,
  p_wound_photo_path     text     default null,   -- NOVO (FUNC 3)
  p_has_drain            boolean  default false,
  p_drain_photo_path     text     default null,   -- NOVO (FUNC 3)
  p_urinated_normally    boolean  default null,
  p_had_vomit            boolean  default null,
  p_water_intake_ok      boolean  default null,
  p_drain_output_ml      int      default null,
  p_noticed_wound_change boolean  default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient      public.patients;
  v_actor_role   public.user_role;
  v_status       public.clinical_status := 'GREEN';
  v_type         text := 'Sinais vitais';
  v_yellow_count int;
  v_isolated     boolean;
  v_recheck_due  timestamptz;
  v_day          int;
  v_prev_steps   int;
  v_prev_pain    int;
  v_had_vomit    boolean;
  v_record_id    uuid;
  v_alert_id     uuid;
  v_period       public.measurement_period;
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time     time := (now() at time zone 'America/Sao_Paulo')::time;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select role into v_actor_role from public.profiles where id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR', 'NURSING_PROFESSIONAL') then
    raise exception 'Apenas cirurgião, médico associado ou profissional de enfermagem podem registrar medição em nome do paciente.';
  end if;

  select * into v_patient from public.patients where id = p_patient_id and status = 'ACTIVE';
  if not found then raise exception 'Paciente não encontrado ou inativo.'; end if;

  -- Guarda de acesso da 0067: equipe OU enfermeiro do pool.
  if not (public.is_team_member(v_patient.team_id) or public.is_nurse_for_patient(p_patient_id)) then
    raise exception 'Você não tem acesso a este paciente.';
  end if;

  v_period := p_period::public.measurement_period;

  if v_period = 'MORNING' and v_now_time < time '10:00' then
    raise exception 'A janela da manhã de hoje ainda está aberta — peça ao paciente para registrar diretamente.';
  elsif v_period = 'NIGHT' and v_now_time < time '20:00' then
    raise exception 'A janela da noite de hoje ainda está aberta — peça ao paciente para registrar diretamente.';
  end if;

  if exists (
    select 1 from public.vital_sign_records vsr
     where vsr.patient_id = p_patient_id
       and vsr.record_date = v_today
       and vsr.period = v_period
  ) then
    raise exception 'Este período já foi registrado.';
  end if;

  update public.clinical_alerts
     set recheck_completed_at = now()
   where patient_id = p_patient_id
     and recheck_due_at is not null
     and recheck_completed_at is null;

  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = p_patient_id
     and vsr.record_date <= v_today - 2
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select vsr.pain_level into v_prev_pain
    from public.vital_sign_records vsr
   where vsr.patient_id = p_patient_id
     and vsr.pain_level is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select s.status, s.vtype, s.yellow_count, s.isolated_by_steps_or_diuresis
    into v_status, v_type, v_yellow_count, v_isolated
    from public.eval_clinical_status(
      p_temperature, p_oxygen_saturation, p_heart_rate, p_pain, p_dyspnea,
      p_urinated_normally, p_urination_count, v_had_vomit, coalesce(p_has_bleeding, false),
      p_steps, v_prev_steps, p_systolic, p_diastolic, p_water_intake_ok, v_prev_pain
    ) s;

  v_recheck_due := case when v_status = 'YELLOW' and v_yellow_count = 1 then now() + interval '2 hours' else null end;

  v_day := case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (v_today - v_patient.hospital_discharge_date) + 1))
                else null end;

  insert into public.vital_sign_records (
    patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
    systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
    urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
    wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test,
    water_intake_ok, drain_output_ml, noticed_wound_change, source, entered_by_profile_id
  ) values (
    p_patient_id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
    p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
    p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
    -- FUNC 3: as duas únicas linhas novas em relação à 0067.
    p_wound_photo_path,
    coalesce(p_has_drain, false),
    case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
    v_status, coalesce(v_patient.is_test, false), p_water_intake_ok,
    case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
    p_noticed_wound_change, 'STAFF', auth.uid()
  )
  on conflict (patient_id, record_date, period) do nothing
  returning id into v_record_id;

  if v_record_id is null then
    raise exception 'Este período já foi registrado.';
  end if;

  update public.patients set current_status = v_status where id = p_patient_id;

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test, recheck_due_at)
    values (p_patient_id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false), v_recheck_due)
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  update public.missed_measurement_logs
     set resolved_at = now(),
         resolved_by = auth.uid(),
         status = case when status = 'PENDING' then 'CANCELLED' else status end
   where patient_id = p_patient_id
     and period = v_period
     and missed_date = v_today
     and resolved_at is null;

  perform public.log_patient_access(p_patient_id, 'lançamento de medição em nome do paciente');

  return v_status::text;
end;
$$;

comment on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text,
  boolean, text, boolean, boolean, boolean, int, boolean
) is
  'Lançamento pela equipe do período de HOJE que o paciente esqueceu, com fotos opcionais de cicatriz/dreno (FUNC 3). Os paths vêm do Storage (bucket patient-photos, policy patient_photos_write da 0020); drain_photo_path só é gravado quando has_drain = true.';

-- ----------------------------------------------------------------------------
-- 3) Privilégios — a função NOVA nasce com EXECUTE para PUBLIC (armadilha
--    documentada na 0022): revoga de `public` E de `anon`, concede só a
--    `authenticated`. Mesmo conjunto do rodapé da 0062, com a assinatura nova.
--    Nada de service_role/anon aqui: diferente do fluxo por token, este caminho
--    é exclusivamente do staff logado.
-- ----------------------------------------------------------------------------
revoke execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text,
  boolean, text, boolean, boolean, boolean, int, boolean
) from public;
revoke execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text,
  boolean, text, boolean, boolean, boolean, int, boolean
) from anon;
grant execute on function public.staff_insert_vital_record(
  uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text,
  boolean, text, boolean, boolean, boolean, int, boolean
) to authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1) Existe UMA só assinatura (senão o PostgREST volta a ficar ambíguo):
--   select p.oid::regprocedure as assinatura
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'staff_insert_vital_record';
--   --> exatamente 1 linha, com `text` nas posições 14 e 16
--
--   -- 2) Privilégios (anon/public sem EXECUTE):
--   select has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'staff_insert_vital_record';
--   --> anon = false, auth = true
--
--   -- 3) Lançamento COM foto (logado como enfermeiro-membro-da-equipe, após o
--   --    fechamento da janela; os paths precisam ter sido subidos no Storage):
--   select public.staff_insert_vital_record(
--     p_patient_id       => '<patient_id>',
--     p_period           => 'MORNING',
--     p_temperature      => 36.6,
--     p_wound_photo_path => '<patient_id>/wound-1700000000000.jpg'
--   );
--   select id, source, wound_photo_path, drain_photo_path, has_drain
--     from public.vital_sign_records
--    where patient_id = '<patient_id>' order by created_at desc limit 1;
--
--   -- 4) O trigger da 0014 espelhou em measurement_photos:
--   select photo_type, storage_path, file_name
--     from public.measurement_photos
--    where vital_record_id = '<id do passo 3>';
--   --> 1 linha SURGICAL_WOUND, file_name = 'wound-1700000000000.jpg'
--
--   -- 5) Regra do dreno: path de dreno SEM has_drain é descartado.
--   select public.staff_insert_vital_record(
--     p_patient_id       => '<outro_patient_id>',
--     p_period           => 'NIGHT',
--     p_has_drain        => false,
--     p_drain_photo_path => '<outro_patient_id>/drain-1700000000000.jpg'
--   );
--   select drain_photo_path from public.vital_sign_records
--    where patient_id = '<outro_patient_id>' order by created_at desc limit 1;
--   --> null
--
--   -- 6) Sem foto continua funcionando (paths nulos, nenhuma linha em
--   --    measurement_photos para aquele registro).
-- ----------------------------------------------------------------------------
