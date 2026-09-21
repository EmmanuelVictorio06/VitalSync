-- ============================================================================
-- VitalSync — Cenário do widget "Adesão ao monitoramento" (DEV LOCAL)
--
-- ⚠️  NUNCA RODE ISTO EM PRODUÇÃO. Só faz sentido no Supabase local:
--     `supabase status` tem que mostrar API URL em 127.0.0.1:54321.
--
-- POR QUE ESTE SCRIPT EXISTE
-- O widget dos 10 dias precisa de um paciente com dias MISTOS (turnos verdes,
-- amarelos, vermelhos e faltando) para ser conferido de verdade. Nem o
-- `seed.sql` nem os outros scripts de dev têm isso: o `submit_vital_record`
-- só aceita a janela de HOJE, então dias anteriores não têm como nascer pela
-- pipeline real. Aqui os registros antigos entram por INSERT direto, mas o
-- `clinical_status` de cada um é DERIVADO por `public.eval_clinical_status` —
-- a mesma função que a pipeline usa. Nenhuma cor é escrita à mão.
--
-- Datas ancoradas no dia civil da CLÍNICA (America/Sao_Paulo), não em
-- `current_date` (que no banco é UTC e vira o dia seguinte depois das 21h).
--
-- ADITIVO e IDEMPOTENTE: só INSERT de linhas novas; não altera paciente algum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Paciente fictício. Alta há 4 dias → HOJE é o dia 5 de monitoramento,
--    então sobram os dias 6..10 como futuros (células "bloqueadas").
-- ----------------------------------------------------------------------------
insert into public.patients
  (name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date,
   hospital_id, team_id, secure_token, sex, weight_kg, height_cm, length_of_stay_days)
select 'Paciente Streak Teste',
       date '1972-06-04',
       '41900000077',
       (select id from public.surgery_types order by name limit 1),
       ((now() at time zone 'America/Sao_Paulo')::date) - 6,
       ((now() at time zone 'America/Sao_Paulo')::date) - 4,
       (select id from public.hospitals order by name limit 1),
       (select id from public.medical_teams where team_number = 1),
       'teste-streak-10-dias',
       'M', 82, 176, 2
where not exists (
  select 1 from public.patients where secure_token = 'teste-streak-10-dias'
);

-- ----------------------------------------------------------------------------
-- 2) Medições com dias mistos. O `clinical_status` sai de
--    `eval_clinical_status` a partir dos próprios sinais vitais.
--
--    D1 manhã verde   | D1 noite verde
--    D2 manhã amarela | D2 noite verde
--    D3 manhã VERMELHA| D3 noite FALTANDO
--    D4 manhã FALTANDO| D4 noite verde
--    D5 (hoje) manhã verde | D5 noite FALTANDO
--
--    Adesão esperada depois das 20h: 7 de 10 medições (70%).
-- ----------------------------------------------------------------------------
insert into public.vital_sign_records
  (patient_id, record_date, period, monitoring_day,
   temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate,
   pain_level, dyspnea_level, urination_count, urinated_normally, had_vomit,
   has_bleeding, water_intake_ok, has_drain, is_test, source, clinical_status)
select p.id,
       ((now() at time zone 'America/Sao_Paulo')::date) - 4 + (m.dia - 1),
       m.periodo::public.measurement_period,
       m.dia,
       m.temp, m.spo2, m.sis, m.dia_pa, m.fc,
       m.dor, m.dispneia, 5, true, false,
       false, true, false, p.is_test, 'PATIENT',
       -- eval_clinical_status devolve TABLE(status, vtype, ...): pega só o status.
       (select e.status
          from public.eval_clinical_status(
                 m.temp, m.spo2, m.fc, m.dor, m.dispneia,
                 true, 5, false, false,
                 null, null, m.sis, m.dia_pa, true, null
               ) as e)
from public.patients p,
     (values
       -- dia, periodo,   temp, spo2, sis, dia_pa, fc,  dor, dispneia
       (1, 'MORNING', 36.5, 98,  120, 80,  72,  1, 0),  -- verde
       (1, 'NIGHT',   36.7, 97,  118, 78,  75,  2, 0),  -- verde
       (2, 'MORNING', 37.9, 96,  124, 82,  88,  4, 0),  -- amarelo (temperatura)
       (2, 'NIGHT',   36.6, 98,  120, 80,  74,  2, 0),  -- verde
       (3, 'MORNING', 39.1, 91,  152, 104, 118, 8, 2),  -- vermelho
       (4, 'NIGHT',   36.8, 97,  122, 79,  76,  2, 0),  -- verde
       (5, 'MORNING', 36.4, 98,  119, 77,  70,  1, 0)   -- verde (hoje)
     ) as m(dia, periodo, temp, spo2, sis, dia_pa, fc, dor, dispneia)
where p.secure_token = 'teste-streak-10-dias'
  and not exists (
    select 1 from public.vital_sign_records v
     where v.patient_id = p.id and v.monitoring_day = m.dia
       and v.period = m.periodo::public.measurement_period
  );

-- ----------------------------------------------------------------------------
-- 3) VERIFICAÇÃO — é isto que o widget deve desenhar, dia a dia.
-- ----------------------------------------------------------------------------
select v.monitoring_day as dia,
       v.record_date,
       to_char(v.record_date, 'Dy') as dia_semana,
       v.period,
       v.clinical_status
  from public.vital_sign_records v
  join public.patients p on p.id = v.patient_id
 where p.secure_token = 'teste-streak-10-dias'
 order by v.monitoring_day, v.period desc;

-- Adesão esperada (turnos vencidos x registrados), com as janelas de hoje já fechadas.
select count(*) filter (where true) as registradas_ate_agora
  from public.vital_sign_records v
  join public.patients p on p.id = v.patient_id
 where p.secure_token = 'teste-streak-10-dias';
