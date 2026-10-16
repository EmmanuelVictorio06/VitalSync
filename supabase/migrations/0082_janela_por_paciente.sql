-- ============================================================================
-- Migration: 0082_janela_por_paciente
--
-- MUDANÇA: para os pacientes cadastrados daqui em diante, o DIA 1 do
-- monitoramento passa a ser o DIA SEGUINTE à alta (hoje é o próprio dia da
-- alta). A janela continua com 10 dias.
--
--                     regra antiga (existentes)    regra nova (cadastrados depois)
--     dia N           alta + (N − 1)               alta + N
--     janela          alta … alta + 9              alta + 1 … alta + 10
--     dia da alta     é o dia 1                    fora da janela
--
-- A regra fica GRAVADA em cada paciente, na coluna nova
-- `patients.monitoring_starts_next_day` (false = antiga, true = nova), e é
-- IMUTÁVEL depois do cadastro (trigger do bloco 2).
--
-- ESTA MIGRATION NÃO VIRA A CHAVE: o default da coluna nasce FALSE, então todo
-- paciente existente — e todo paciente cadastrado enquanto só esta migration
-- estiver no ar — fica na regra antiga. A virada (default TRUE) é a 0083.
--
-- INVARIANTE: para `monitoring_starts_next_day = false` NADA muda. Em cada
-- função abaixo a condição de janela / o número do dia viraram dois ramos
-- DISJUNTOS, e o ramo antigo é a expressão viva copiada LITERALMENTE —
-- inclusive as particularidades de hoje (get_patient_by_token usa
-- `current_date` e não tem limite inferior em `within_window`; os enqueue usam
-- `current_date` e aceitam até alta + 10). O ramo novo usa o dia de São Paulo.
-- Nos três cálculos de dia, o ramo novo devolve NULL quando não há alta
-- (`greatest(1, null)` seria 1), igual ao ramo antigo.
--
-- O QUE ESTA MIGRATION TOCA:
--   1) public.patients — coluna nova `monitoring_starts_next_day` boolean not
--      null default false, com comentário.
--   2) public.protect_patient_monitoring_rule() + trigger
--      trg_protect_patient_monitoring_rule (before update on public.patients):
--      recusa qualquer mudança da coluna, sem exceção de papel.
--   3) public.submit_vital_record (21 args) — BASE: 0053. Muda só o v_day.
--   4) public.staff_insert_vital_record (21 args) — BASE: 0074. Muda só o v_day.
--   5) public.get_patient_by_token(text) — BASE: 0021 (privilégios da 0022).
--      Mudam só monitoring_day e within_window.
--   6) public.enqueue_measurement_reminders(text) — BASE: 0073. Muda só a
--      condição de janela (alias p).
--   7) public.enqueue_missed_measurement_alerts(text) — BASE: 0073. Muda só a
--      condição de janela (alias pt).
--
-- O QUE NÃO MUDA: nenhuma outra função; nenhum dado gravado (nenhum update em
-- vital_sign_records, nenhum backfill de monitoring_day). Assinaturas,
-- `security definer`, `search_path` e volatilidade são os do corpo vivo; como
-- as assinaturas são as mesmas, `create or replace` PRESERVA os privilégios
-- atuais, e os revoke/grant do corpo vivo são repetidos abaixo (idempotentes).
-- `submit_vital_record` não tem bloco de privilégios na 0053, então nenhum é
-- repetido para ela. Para `get_patient_by_token` repete-se a 0022, não o grant
-- da 0021 (que reabriria `anon`).
--
-- ADITIVA e IDEMPOTENTE. Rode após a 0081.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Coluna da regra da janela, por paciente. Default FALSE = regra antiga.
-- ----------------------------------------------------------------------------
alter table public.patients
  add column if not exists monitoring_starts_next_day boolean not null default false;

comment on column public.patients.monitoring_starts_next_day is
  'Regra da janela de monitoramento deste paciente. false = regra antiga: o dia 1 é o dia da alta (janela alta … alta + 9). true = regra nova: o dia 1 é o dia seguinte à alta (janela alta + 1 … alta + 10). Gravada no cadastro e IMUTÁVEL (trigger trg_protect_patient_monitoring_rule).';

-- ----------------------------------------------------------------------------
-- 2) Imutabilidade — modelo de protect_profile_privileged_fields (0006), mas
--    recusando (raise) em vez de preservar em silêncio, e sem exceção de papel.
--    Updates que não mexem na coluna passam normalmente.
-- ----------------------------------------------------------------------------
create or replace function public.protect_patient_monitoring_rule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.monitoring_starts_next_day is distinct from OLD.monitoring_starts_next_day then
    raise exception 'A regra da janela de monitoramento (monitoring_starts_next_day) é definida no cadastro e não pode ser alterada.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_patient_monitoring_rule on public.patients;
create trigger trg_protect_patient_monitoring_rule before update on public.patients
  for each row execute function public.protect_patient_monitoring_rule();

-- ----------------------------------------------------------------------------
-- 3) submit_vital_record — cópia da 0053. Única mudança: o cálculo de v_day.
-- ----------------------------------------------------------------------------
create or replace function public.submit_vital_record(
  p_token               text,
  p_period              text,
  p_temperature         numeric  default null,
  p_oxygen_saturation   int      default null,
  p_systolic            int      default null,
  p_diastolic           int      default null,
  p_heart_rate          int      default null,
  p_pain                int      default null,
  p_dyspnea             int      default null,
  p_urination_count     int      default null,
  p_vomiting_count      int      default null,
  p_has_bleeding        boolean  default false,
  p_steps               int      default null,
  p_wound_photo_path    text     default null,
  p_has_drain           boolean  default false,
  p_drain_photo_path    text     default null,
  p_urinated_normally   boolean  default null,
  p_had_vomit           boolean  default null,
  p_water_intake_ok     boolean  default null,
  p_drain_output_ml     int      default null,
  p_noticed_wound_change boolean default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_patient      public.patients;
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
  v_allow_resend boolean := false;
  v_msg_repetida text;
begin
  select * into v_patient from public.patients where secure_token = p_token and status = 'ACTIVE';
  if not found then raise exception 'Link inválido ou expirado.'; end if;

  v_period := p_period::public.measurement_period;

  select coalesce((s.data ->> 'allowResendSamePeriod')::boolean, false)
    into v_allow_resend
    from public.app_settings s
   where s.section = 'security';
  v_allow_resend := coalesce(v_allow_resend, false);

  v_msg_repetida := case when v_period = 'MORNING'
    then 'A medição da manhã de hoje já foi registrada. A próxima medição é à noite, antes de dormir.'
    else 'A medição da noite de hoje já foi registrada. A próxima medição é amanhã de manhã, ao acordar.' end;

  if not v_allow_resend
     and exists (
       select 1 from public.vital_sign_records vsr
        where vsr.patient_id = v_patient.id
          and vsr.record_date = v_today
          and vsr.period = v_period
     )
  then
    raise exception '%', v_msg_repetida;
  end if;

  -- Fecha qualquer reaferição de 2h pendente deste paciente: uma nova medição
  -- chegou, então a reaferição foi cumprida (independente do status dela).
  update public.clinical_alerts
     set recheck_completed_at = now()
   where patient_id = v_patient.id
     and recheck_due_at is not null
     and recheck_completed_at is null;

  v_had_vomit := coalesce(p_had_vomit, (coalesce(p_vomiting_count, 0) > 0));

  select vsr.steps into v_prev_steps
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
     and vsr.record_date <= v_today - 2
     and vsr.steps is not null
   order by vsr.record_date desc, vsr.period desc
   limit 1;

  select vsr.pain_level into v_prev_pain
    from public.vital_sign_records vsr
   where vsr.patient_id = v_patient.id
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

  -- Reaferição em 2h (protocolo 5.7.2): só quando o resultado é AMARELO com
  -- um único critério (isolado — seja de passos/diurese ou de outro sinal).
  -- Amarelo com ≥2 critérios escalona direto (sem reaferição).
  v_recheck_due := case when v_status = 'YELLOW' and v_yellow_count = 1 then now() + interval '2 hours' else null end;

  -- 0082: regra da janela por paciente. Ramo false = expressão da versão
  -- anterior, literal. Ramo true = dia 1 é alta + 1 (NULL sem alta).
  v_day := case when v_patient.monitoring_starts_next_day
                then case when v_patient.hospital_discharge_date is not null
                          then least(10, greatest(1, v_today - v_patient.hospital_discharge_date))
                     end
                else case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (v_today - v_patient.hospital_discharge_date) + 1))
                else null end
           end;

  if v_allow_resend then
    insert into public.vital_sign_records (
      patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
      systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
      urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test,
      water_intake_ok, drain_output_ml, noticed_wound_change
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false),
      p_water_intake_ok,
      case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
      p_noticed_wound_change
    )
    on conflict (patient_id, record_date, period) do update set
      temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
      systolic_pressure = excluded.systolic_pressure, diastolic_pressure = excluded.diastolic_pressure,
      heart_rate = excluded.heart_rate, pain_level = excluded.pain_level, dyspnea_level = excluded.dyspnea_level,
      urination_count = excluded.urination_count, urinated_normally = excluded.urinated_normally,
      vomiting_count = excluded.vomiting_count, had_vomit = excluded.had_vomit,
      has_bleeding = excluded.has_bleeding, steps = excluded.steps,
      wound_photo_path = coalesce(excluded.wound_photo_path, public.vital_sign_records.wound_photo_path),
      has_drain = excluded.has_drain,
      drain_photo_path = case when excluded.has_drain
        then coalesce(excluded.drain_photo_path, public.vital_sign_records.drain_photo_path)
        else null end,
      clinical_status = excluded.clinical_status,
      is_test = excluded.is_test,
      water_intake_ok = excluded.water_intake_ok,
      drain_output_ml = case when excluded.has_drain then excluded.drain_output_ml else null end,
      noticed_wound_change = excluded.noticed_wound_change
    returning id into v_record_id;
  else
    insert into public.vital_sign_records (
      patient_id, record_date, period, monitoring_day, temperature, oxygen_saturation,
      systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level,
      urination_count, urinated_normally, vomiting_count, had_vomit, has_bleeding, steps,
      wound_photo_path, has_drain, drain_photo_path, clinical_status, is_test,
      water_intake_ok, drain_output_ml, noticed_wound_change
    ) values (
      v_patient.id, v_today, v_period, v_day, p_temperature, p_oxygen_saturation,
      p_systolic, p_diastolic, p_heart_rate, p_pain, p_dyspnea,
      p_urination_count, p_urinated_normally, p_vomiting_count, v_had_vomit, coalesce(p_has_bleeding, false), p_steps,
      p_wound_photo_path, coalesce(p_has_drain, false),
      case when coalesce(p_has_drain, false) then p_drain_photo_path else null end,
      v_status, coalesce(v_patient.is_test, false),
      p_water_intake_ok,
      case when coalesce(p_has_drain, false) then p_drain_output_ml else null end,
      p_noticed_wound_change
    )
    on conflict (patient_id, record_date, period) do nothing
    returning id into v_record_id;

    if v_record_id is null then
      raise exception '%', v_msg_repetida;
    end if;
  end if;

  update public.patients set current_status = v_status where id = v_patient.id;

  if v_status <> 'GREEN' then
    insert into public.clinical_alerts (patient_id, team_id, vital_record_id, status, type, description, is_test, recheck_due_at)
    values (v_patient.id, v_patient.team_id, v_record_id, v_status, v_type,
      case when v_status = 'RED' then 'Alerta vermelho: ' || lower(v_type) || ' com valor crítico.'
           else 'Atenção: ' || lower(v_type) || ' em valor limítrofe.' end,
      coalesce(v_patient.is_test, false), v_recheck_due)
    returning id into v_alert_id;
    perform public.notify_team_of_alert(v_alert_id);
  end if;

  return v_status::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) staff_insert_vital_record — cópia da 0074. Única mudança: o cálculo de
--    v_day.
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

  -- 0082: regra da janela por paciente. Ramo false = expressão da versão
  -- anterior, literal. Ramo true = dia 1 é alta + 1 (NULL sem alta).
  v_day := case when v_patient.monitoring_starts_next_day
                then case when v_patient.hospital_discharge_date is not null
                          then least(10, greatest(1, v_today - v_patient.hospital_discharge_date))
                     end
                else case when v_patient.hospital_discharge_date is not null
                then least(10, greatest(1, (v_today - v_patient.hospital_discharge_date) + 1))
                else null end
           end;

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
-- 5) get_patient_by_token — cópia da 0021. Mudam só monitoring_day e
--    within_window. Privilégios: os da 0022 (o grant a anon da 0021 NÃO).
-- ----------------------------------------------------------------------------
create or replace function public.get_patient_by_token(p_token text)
returns table (
  id uuid,
  name text,
  birth_date date,
  surgery_date date,
  hospital_discharge_date date,
  current_status public.clinical_status,
  monitoring_day int,
  within_window boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.name, p.birth_date, p.surgery_date, p.hospital_discharge_date, p.current_status,
    -- 0082: ramo false = expressões da 0021, literais (current_date, sem limite
    -- inferior). Ramo true = dia de SP, janela alta + 1 … alta + 10.
    case when p.monitoring_starts_next_day
         then case when p.hospital_discharge_date is not null
                   then least(10, greatest(1, ((now() at time zone 'America/Sao_Paulo')::date) - p.hospital_discharge_date)) end
         else case when p.hospital_discharge_date is not null
         then least(10, greatest(1, (current_date - p.hospital_discharge_date) + 1)) end
    end as monitoring_day,
    (
      (not p.monitoring_starts_next_day and (p.status = 'ACTIVE'
       and p.hospital_discharge_date is not null
       and current_date <= p.hospital_discharge_date + 10))
      or
      (p.hospital_discharge_date is not null and p.monitoring_starts_next_day and ((now() at time zone 'America/Sao_Paulo')::date) between p.hospital_discharge_date + 1
                                                                                         and p.hospital_discharge_date + 10)
    ) as within_window
  from public.patients p
  where p.secure_token = p_token and p.status = 'ACTIVE';
$$;

revoke execute on function public.get_patient_by_token(text) from public;
revoke execute on function public.get_patient_by_token(text) from anon;
grant  execute on function public.get_patient_by_token(text) to service_role;

-- ----------------------------------------------------------------------------
-- 6) enqueue_measurement_reminders — cópia da 0073. Muda só a condição de
--    janela (alias p).
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_measurement_reminders(p_period text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mode       boolean;
  v_recipients text[];
  v_env        text;
  v_count      int := 0;
  r            record;
  v_status     text;
  v_error      text;
begin
  if p_period not in ('MORNING', 'NIGHT') then
    raise exception 'Período inválido: %', p_period;
  end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  for r in
    select p.id, p.name, p.phone, p.is_test
    from public.patients p
    where p.status = 'ACTIVE'
      -- 0082: ramo false = condição da 0073, literal. Ramo true = alta + 1 … alta + 10 (SP).
      and (
        (not p.monitoring_starts_next_day
      and p.hospital_discharge_date is not null
      and current_date >= p.hospital_discharge_date        -- NOVO: janela só abre na alta
      and p.hospital_discharge_date + 10 >= current_date)
        or
        (p.monitoring_starts_next_day and ((now() at time zone 'America/Sao_Paulo')::date) between p.hospital_discharge_date + 1
                                                                                           and p.hospital_discharge_date + 10)
      )
      and p.phone is not null
      and not exists (
        select 1 from public.vital_sign_records v
        where v.patient_id = p.id
          and v.record_date = current_date
          and v.period = p_period::public.measurement_period
      )
      and not exists (
        select 1 from public.reminder_logs rl
        where rl.patient_id = p.id
          and rl.period = p_period::public.measurement_period
          and rl.reminder_date = current_date
      )
  loop
    -- Em homologação: só enfileira de verdade para números na whitelist.
    if v_mode and not exists (
      select 1 from unnest(v_recipients) x
      where public.normalize_phone(x) = public.normalize_phone(r.phone)
    ) then
      v_status := 'SKIPPED_TEST_MODE';
      v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
    else
      v_status := 'PENDING';
      v_error  := null;
    end if;

    insert into public.reminder_logs
      (patient_id, period, reminder_date, recipient_phone, recipient_name,
       channel, status, template_name, environment, is_test, error_message, sent_at)
    values
      (r.id, p_period::public.measurement_period, current_date, r.phone, r.name,
       'whatsapp', v_status, 'lembrete_medicao_vitalsync', v_env,
       coalesce(r.is_test, false), v_error,
       case when v_status = 'PENDING' then null else now() end)
    on conflict (patient_id, period, reminder_date) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) enqueue_missed_measurement_alerts — cópia da 0073. Muda só a condição de
--    janela (alias pt).
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_missed_measurement_alerts(p_period text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mode        boolean;
  v_recipients  text[];
  v_env         text;
  v_count       int := 0;
  v_period      public.measurement_period;
  p             record;
  rec           record;
  v_origem      text;
  v_status      text;
  v_error       text;
  v_algum       boolean;
begin
  if p_period not in ('MORNING', 'NIGHT') then
    raise exception 'Período inválido: %', p_period;
  end if;
  v_period := p_period::public.measurement_period;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  for p in
    select pt.id, pt.name, pt.team_id, pt.hospital_id, pt.is_test
      from public.patients pt
     where pt.status = 'ACTIVE'
       -- 0082: ramo false = condição da 0073, literal. Ramo true = alta + 1 … alta + 10 (SP).
       and (
         (not pt.monitoring_starts_next_day
       and pt.hospital_discharge_date is not null
       and current_date >= pt.hospital_discharge_date       -- NOVO: janela só abre na alta
       and pt.hospital_discharge_date + 10 >= current_date)
         or
         (pt.monitoring_starts_next_day and ((now() at time zone 'America/Sao_Paulo')::date) between pt.hospital_discharge_date + 1
                                                                                             and pt.hospital_discharge_date + 10)
       )
       and not exists (
         select 1 from public.vital_sign_records v
          where v.patient_id = pt.id and v.record_date = current_date and v.period = v_period
       )
       and not exists (
         select 1 from public.missed_measurement_logs ml
          where ml.patient_id = pt.id and ml.period = v_period and ml.missed_date = current_date
       )
  loop
    v_algum := false;

    -- (1) enfermeiro LIVRE do pool → (2) qualquer membro ativo do pool
    for v_origem in select unnest(array['LIVRE', 'POOL']) loop
      exit when v_algum;
      for rec in
        select distinct m.profile_id as id, prof.name, prof.whatsapp
          from public.nurse_pool_members m
          join public.nurse_pools pool         on pool.id = m.pool_id and pool.is_active
          join public.nurse_pool_hospitals nph on nph.pool_id = pool.id and nph.hospital_id = p.hospital_id
          join public.profiles prof            on prof.id = m.profile_id and prof.status = 'ACTIVE'
         where m.is_active
           and p.hospital_id is not null
           and (v_origem <> 'LIVRE' or public.nurse_is_free(m.profile_id))
      loop
        if v_mode and not exists (
          select 1 from unnest(v_recipients) x
          where rec.whatsapp is not null
            and public.normalize_phone(x) = public.normalize_phone(rec.whatsapp)
        ) then
          v_status := 'SKIPPED_TEST_MODE';
          v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
        else
          v_status := 'PENDING';
          v_error  := null;
        end if;

        insert into public.missed_measurement_logs
          (patient_id, team_id, period, missed_date, recipient_profile_id, recipient_name,
           recipient_phone, recipient_is_nurse, channel, status, template_name, environment,
           is_test, error_message, sent_at)
        values
          (p.id, p.team_id, v_period, current_date, rec.id, rec.name,
           rec.whatsapp, true, 'whatsapp', v_status, 'alerta_medicao_esquecida_vitalsync', v_env,
           coalesce(p.is_test, false), v_error,
           case when v_status = 'PENDING' then null else now() end)
        on conflict (patient_id, period, missed_date, recipient_profile_id) do nothing;

        v_algum := true;
        v_count := v_count + 1;
      end loop;
    end loop;

    -- (3) fallback de EQUIPE (comportamento da 0061) quando não há pool.
    if not v_algum then
      for rec in
        select prof.id, prof.name, prof.whatsapp
          from (
            select t.main_surgeon_id as id from public.medical_teams t
             where t.id = p.team_id and t.main_surgeon_id is not null
            union
            select m.doctor_id as id from public.team_members m
             where m.team_id = p.team_id and m.status = 'ACTIVE'
          ) ids
          join public.profiles prof on prof.id = ids.id
         where prof.status = 'ACTIVE'
      loop
        if v_mode and not exists (
          select 1 from unnest(v_recipients) x
          where rec.whatsapp is not null
            and public.normalize_phone(x) = public.normalize_phone(rec.whatsapp)
        ) then
          v_status := 'SKIPPED_TEST_MODE';
          v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
        else
          v_status := 'PENDING';
          v_error  := null;
        end if;

        insert into public.missed_measurement_logs
          (patient_id, team_id, period, missed_date, recipient_profile_id, recipient_name,
           recipient_phone, recipient_is_nurse, channel, status, template_name, environment,
           is_test, error_message, sent_at)
        values
          (p.id, p.team_id, v_period, current_date, rec.id, rec.name,
           rec.whatsapp, false, 'whatsapp', v_status, 'alerta_medicao_esquecida_vitalsync', v_env,
           coalesce(p.is_test, false), v_error,
           case when v_status = 'PENDING' then null else now() end)
        on conflict (patient_id, period, missed_date, recipient_profile_id) do nothing;

        v_algum := true;
        v_count := v_count + 1;
      end loop;
    end if;

    -- (4) ninguém em lugar nenhum: registra o buraco em vez de silenciar.
    if not v_algum then
      insert into public.missed_measurement_logs
        (patient_id, team_id, period, missed_date, recipient_profile_id, recipient_name,
         recipient_phone, recipient_is_nurse, channel, status, template_name, environment,
         is_test, error_message, sent_at)
      values
        (p.id, p.team_id, v_period, current_date, null, null,
         null, false, 'whatsapp', 'NO_RECIPIENT', 'alerta_medicao_esquecida_vitalsync', v_env,
         coalesce(p.is_test, false),
         'Nenhum enfermeiro no pool que cobre o hospital e nenhum membro ativo na equipe do paciente.',
         now());

      insert into public.audit_logs (actor_name, actor_role, action, entity)
      values ('Sistema', 'SYSTEM', 'MISSED_MEASUREMENT_NO_RECIPIENT',
              'Paciente · ' || p.name || ' — sem destinatário para o aviso de medição esquecida');
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_measurement_reminders(text)       from public, anon, authenticated;
revoke execute on function public.enqueue_missed_measurement_alerts(text)   from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1) Coluna criada, NOT NULL, default false, e TODOS os existentes em false:
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'patients'
--      and column_name = 'monitoring_starts_next_day';
--   --> NO | false
--   select monitoring_starts_next_day, count(*) from public.patients group by 1;
--   --> só a linha false
--
--   -- 2) Trigger de imutabilidade (em transação, para não gravar nada):
--   begin;
--     update public.patients set monitoring_starts_next_day = true
--      where id = '<patient_id>';                     --> ERRO (regra imutável)
--   rollback;
--   begin;
--     update public.patients set name = name where id = '<patient_id>';  --> UPDATE 1
--   rollback;
--
--   -- 3) As 5 funções mantêm security definer, search_path, volatilidade e
--   --    privilégios (compare com o retrato tirado antes):
--   select p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('submit_vital_record', 'staff_insert_vital_record',
--                        'get_patient_by_token', 'enqueue_measurement_reminders',
--                        'enqueue_missed_measurement_alerts')
--    order by 1;
--   --> 1 linha por função (nenhuma sobrecarga nova); get_patient_by_token = 's',
--   --  as demais = 'v'; todas prosecdef = t e {search_path=public}
--
--   -- 4) Pacientes da regra antiga: monitoring_day / within_window idênticos
--   --    aos de antes da migration:
--   select p.name, p.hospital_discharge_date, g.monitoring_day, g.within_window
--     from public.patients p
--     left join lateral public.get_patient_by_token(p.secure_token) g on true
--    where not p.monitoring_starts_next_day
--    order by p.name;
-- ----------------------------------------------------------------------------
