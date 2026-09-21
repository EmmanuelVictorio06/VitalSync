-- ============================================================================
-- VitalSync — Registros com os TRÊS níveis de dispneia (DEV LOCAL)
--
-- ⚠️  NUNCA RODE ISTO EM PRODUÇÃO. Só faz sentido no Supabase local:
--     `supabase status` tem que mostrar API URL em 127.0.0.1:54321.
--
-- POR QUE ESTE SCRIPT EXISTE
-- O cenário de `dev_paciente_streak_10dias.sql` cobre dispneia 0 (Ausente) e 2
-- (Moderada/Intensa), mas não o nível 1 (Leve) — e sem os três não dá para
-- conferir o card categórico de dispneia nem o carrossel de registros.
-- Completa o MESMO paciente fictício daquele cenário (nenhum paciente novo),
-- preenchendo os dois turnos que faltavam: D3 noite e D4 manhã.
--
-- O `clinical_status` é DERIVADO por `public.eval_clinical_status`, a mesma
-- função da pipeline — nenhum status escrito à mão.
--
-- ADITIVO e IDEMPOTENTE: só INSERT de linhas novas; não altera registro algum.
-- ============================================================================

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
       (select e.status
          from public.eval_clinical_status(
                 m.temp, m.spo2, m.fc, m.dor, m.dispneia,
                 true, 5, false, false,
                 null, null, m.sis, m.dia_pa, true, null
               ) as e)
from public.patients p,
     (values
       -- dia, periodo,   temp, spo2, sis, dia_pa, fc,  dor, dispneia
       (3, 'NIGHT',   37.2, 96,  126, 84,  92,  5, 1),  -- dispneia LEVE
       (4, 'MORNING', 36.9, 97,  124, 81,  84,  3, 1)   -- dispneia LEVE
     ) as m(dia, periodo, temp, spo2, sis, dia_pa, fc, dor, dispneia)
where p.secure_token = 'teste-streak-10-dias'
  and not exists (
    select 1 from public.vital_sign_records v
     where v.patient_id = p.id and v.monitoring_day = m.dia
       and v.period = m.periodo::public.measurement_period
  );

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO — os três níveis de dispneia presentes, e um slide por turno.
-- ----------------------------------------------------------------------------
select v.monitoring_day as dia,
       v.period,
       v.dyspnea_level as nivel_dispneia,
       case v.dyspnea_level
         when 0 then 'Ausente'
         when 1 then 'Leve'
         when 2 then 'Moderada/Intensa'
       end as rotulo_esperado,
       v.pain_level as dor,
       v.clinical_status
  from public.vital_sign_records v
  join public.patients p on p.id = v.patient_id
 where p.secure_token = 'teste-streak-10-dias'
 order by v.monitoring_day desc, v.period desc;
