-- ============================================================================
-- VitalSync — Cenário do carrossel de FOTOS de acompanhamento (DEV LOCAL)
--
-- ⚠️  NUNCA RODE ISTO EM PRODUÇÃO. Só faz sentido no Supabase local:
--     `supabase status` tem que mostrar API URL em 127.0.0.1:54321.
--
-- POR QUE ESTE SCRIPT EXISTE
-- Nenhum paciente local tem registro "relevante para foto" (`wound_photo_path`,
-- `drain_photo_path` ou `has_drain`), então a seção "Fotos de acompanhamento"
-- caía sempre no estado vazio — e sem ela não dá para testar o carrossel
-- (setas, contador, pontinhos), que é compartilhado com o de indicadores.
--
-- Cria UM paciente fictício com três noites marcadas como "possui dreno". Sem
-- arquivo: o slide existe pela informação do dreno, que é o suficiente para
-- exercitar a navegação. O `clinical_status` é derivado por
-- `public.eval_clinical_status`, a mesma função da pipeline.
--
-- ADITIVO e IDEMPOTENTE: só INSERT de linhas novas; não altera nada existente.
-- ============================================================================

insert into public.patients
  (name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date,
   hospital_id, team_id, secure_token)
select 'Paciente Carrossel Fotos',
       date '1980-11-23',
       '41900000066',
       (select id from public.surgery_types order by name limit 1),
       ((now() at time zone 'America/Sao_Paulo')::date) - 5,
       ((now() at time zone 'America/Sao_Paulo')::date) - 3,
       (select id from public.hospitals order by name limit 1),
       (select id from public.medical_teams where team_number = 1),
       'teste-carrossel-fotos'
where not exists (
  select 1 from public.patients where secure_token = 'teste-carrossel-fotos'
);

insert into public.vital_sign_records
  (patient_id, record_date, period, monitoring_day,
   temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate,
   pain_level, dyspnea_level, urination_count, urinated_normally, had_vomit,
   has_bleeding, water_intake_ok, has_drain, is_test, source, clinical_status)
select p.id,
       ((now() at time zone 'America/Sao_Paulo')::date) - 3 + (m.dia - 1),
       'NIGHT'::public.measurement_period,
       m.dia,
       m.temp, 97, 120, 80, 76,
       m.dor, m.dispneia, 5, true, false,
       false, true, true, p.is_test, 'PATIENT',
       (select e.status
          from public.eval_clinical_status(
                 m.temp, 97, 76, m.dor, m.dispneia,
                 true, 5, false, false,
                 null, null, 120, 80, true, null
               ) as e)
from public.patients p,
     (values
       -- dia, temp, dor, dispneia
       (1, 36.6, 2, 0),
       (2, 37.1, 3, 1),
       (3, 36.8, 1, 0)
     ) as m(dia, temp, dor, dispneia)
where p.secure_token = 'teste-carrossel-fotos'
  and not exists (
    select 1 from public.vital_sign_records v
     where v.patient_id = p.id and v.monitoring_day = m.dia
       and v.period = 'NIGHT'::public.measurement_period
  );

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO — 3 slides de foto (um por noite com dreno).
-- ----------------------------------------------------------------------------
select p.id as patient_id,
       v.monitoring_day as dia,
       v.period,
       v.has_drain,
       v.dyspnea_level,
       v.clinical_status
  from public.vital_sign_records v
  join public.patients p on p.id = v.patient_id
 where p.secure_token = 'teste-carrossel-fotos'
 order by v.monitoring_day;
