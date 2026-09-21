-- ============================================================================
-- VitalSync — Cenário de teste das VARIÁVEIS CLÍNICAS DO ESTUDO (DEV LOCAL)
--
-- ⚠️  NUNCA RODE ISTO EM PRODUÇÃO. Só faz sentido no Supabase local:
--     `supabase status` tem que mostrar API URL em 127.0.0.1:54321.
--
-- POR QUE ESTE SCRIPT EXISTE
-- Nem o `seed.sql` nem o `dev_teste_enfermagem.sql` preenchem as colunas do
-- estudo (0052: sex, weight_kg, height_cm, comorbidities, length_of_stay_days,
-- alternative_phone, tcle_accepted_at). Sem um paciente com esses campos, a
-- seção "Variáveis clínicas do estudo" do detalhe do alerta mostra "—" por
-- falta de DADO, e isso é fácil de confundir com bug de leitura.
-- Este script cria UM paciente fictício com TODAS as variáveis preenchidas e
-- faz o alerta nascer da pipeline real (`submit_vital_record`).
--
-- ADITIVO e IDEMPOTENTE: só INSERT de linhas novas; não altera paciente algum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Paciente fictício com TODAS as variáveis do estudo preenchidas.
--    Token FIXO para dar para colar no link público sem ir buscar no banco.
--    Alta ontem → cai em D+2, dentro da janela de 10 dias.
-- ----------------------------------------------------------------------------
insert into public.patients
  (name, birth_date, phone, surgery_type_id, surgery_date, hospital_discharge_date,
   hospital_id, team_id, secure_token, medical_record_summary,
   sex, weight_kg, height_cm, comorbidities, length_of_stay_days,
   alternative_phone, tcle_accepted_at)
select 'Paciente Ficticio Variaveis Estudo',
       date '1968-03-11',
       '41900000099',
       (select id from public.surgery_types order by name limit 1),
       current_date - 3,
       current_date - 1,
       (select id from public.hospitals order by name limit 1),
       (select id from public.medical_teams where team_number = 1),
       'teste-variaveis-estudo',
       '<p>Peso: 111kg &middot; Altura: 1,58m &middot; IMC: 44,57</p>',
       'F',
       111,
       158,
       '["Diabetes tipo 2", "Hipertensão"]'::jsonb,
       7,
       '41900000098',
       current_date - 10
where not exists (
  select 1 from public.patients where secure_token = 'teste-variaveis-estudo'
);

-- ----------------------------------------------------------------------------
-- 2) Medição pela PIPELINE REAL, só para existir um alerta com "Ver detalhes".
--    Pressão em faixa vermelha (>=140/100 nos defaults da 0075); resto verde.
--    Idempotente: `submit_vital_record` recusa a 2ª vez na mesma janela, então
--    só chama se ainda não houver medição deste paciente.
-- ----------------------------------------------------------------------------
do $$
declare v_status text;
begin
  if not exists (
    select 1 from public.vital_sign_records v
      join public.patients p on p.id = v.patient_id
     where p.secure_token = 'teste-variaveis-estudo'
  ) then
    select public.submit_vital_record(
      p_token              => 'teste-variaveis-estudo',
      p_period             => 'MORNING',
      p_temperature        => 36.6,
      p_oxygen_saturation  => 97,
      p_systolic           => 152,
      p_diastolic          => 104,
      p_heart_rate         => 78,
      p_pain               => 2,
      p_dyspnea            => 0,
      p_urination_count    => 5,
      p_had_vomit          => false,
      p_has_bleeding       => false,
      p_water_intake_ok    => true,
      p_urinated_normally  => true
    ) into v_status;
    raise notice 'submit_vital_record -> %', v_status;
  else
    raise notice 'medição já existe — nada a fazer';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) VERIFICAÇÃO — é isto que a seção "Variáveis clínicas do estudo" lê.
--    Nenhuma coluna pode voltar nula aqui.
-- ----------------------------------------------------------------------------
select p.name,
       p.sex,
       p.weight_kg,
       p.height_cm,
       round(p.weight_kg / ((p.height_cm / 100) ^ 2), 2) as imc_calculado,
       p.length_of_stay_days,
       p.alternative_phone,
       p.tcle_accepted_at,
       p.comorbidities,
       a.id as alerta_id,
       a.status,
       a.type,
       a.attendance_status
  from public.patients p
  left join public.clinical_alerts a on a.patient_id = p.id
 where p.secure_token = 'teste-variaveis-estudo';
