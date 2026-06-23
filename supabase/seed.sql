-- ============================================================================
-- VitalSync — Seed de demonstração (robusto)
--
-- PRÉ-REQUISITO: crie 3 usuários no Supabase (Authentication → Users → Add user,
-- "Auto Confirm User") com senha `senha123`:
--   admin@vitalsync.com · cirurgiao@vitalsync.com · medico@vitalsync.com
--
-- Este seed CRIA os profiles a partir de auth.users (não depende do trigger
-- nem da ordem em que você rodou as migrações). Idempotente.
-- ============================================================================

-- 1) Profiles dos 3 usuários (lidos de auth.users) com os papéis corretos.
insert into public.profiles (id, name, email, role)
select u.id,
       case u.email
         when 'admin@vitalsync.com'     then 'Administrador'
         when 'cirurgiao@vitalsync.com' then 'Dra. Ana Souza'
         when 'medico@vitalsync.com'    then 'Dr. Bruno Tavares'
       end,
       u.email,
       (case u.email
          when 'admin@vitalsync.com'     then 'ADMIN'
          when 'cirurgiao@vitalsync.com' then 'MAIN_SURGEON'
          when 'medico@vitalsync.com'    then 'ASSOCIATED_DOCTOR'
        end)::public.user_role
from auth.users u
where u.email in ('admin@vitalsync.com', 'cirurgiao@vitalsync.com', 'medico@vitalsync.com')
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

-- Verificação amigável: aborta com mensagem clara se faltar algum usuário.
do $$
declare missing text;
begin
  select string_agg(e, ', ') into missing
  from (select unnest(array['admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com']) e) x
  where not exists (select 1 from public.profiles p where p.email = x.e);
  if missing is not null then
    raise exception 'Faltam usuários no Auth: %. Crie-os em Authentication → Users e rode o seed de novo.', missing;
  end if;
end $$;

-- 2) Catálogos.
insert into public.hospitals (name, city, state) values
  ('Hospital Santa Vida', 'Curitiba', 'PR'),
  ('Hospital São Lucas', 'Curitiba', 'PR')
on conflict do nothing;

insert into public.surgery_types (name, specialty) values
  ('Bariátrica', 'Cirurgia Geral'),
  ('Ortopédica - Joelho', 'Ortopedia'),
  ('Artroplastia de Quadril', 'Ortopedia')
on conflict do nothing;

-- 3) Equipes (cirurgião responsável = cirurgiao@vitalsync.com).
insert into public.medical_teams (team_number, main_surgeon_id)
select v.num, (select id from public.profiles where email = 'cirurgiao@vitalsync.com')
from (values (1), (3), (7)) as v(num)
on conflict (team_number) do nothing;

-- 4) Vincula o médico associado à equipe 01.
insert into public.team_members (team_id, doctor_id, role_in_team)
select (select id from public.medical_teams where team_number = 1),
       (select id from public.profiles where email = 'medico@vitalsync.com'),
       'ASSOCIATED_DOCTOR'
on conflict (team_id, doctor_id) do nothing;

-- 5) Pacientes na equipe 01 (status clínico variado).
insert into public.patients (name, phone, surgery_type_id, surgery_date, hospital_discharge_date, hospital_id, team_id, current_status)
select p.name, p.phone,
       (select id from public.surgery_types where name = p.stype),
       p.sdate::date, p.ddate::date,
       (select id from public.hospitals where name = 'Hospital Santa Vida'),
       (select id from public.medical_teams where team_number = 1),
       p.cstatus::public.clinical_status
from (values
  ('Marcos Oliveira', '41999990001', 'Bariátrica',              '2026-06-15', '2026-06-18', 'RED'),
  ('Elena Ricci',     '41999990002', 'Ortopédica - Joelho',     '2026-06-16', '2026-06-19', 'YELLOW'),
  ('Julian Bass',     '41999990003', 'Artroplastia de Quadril', '2026-06-13', '2026-06-16', 'GREEN'),
  ('Beatriz Silva',   '41999990004', 'Bariátrica',              '2026-06-12', '2026-06-15', 'GREEN')
) as p(name, phone, stype, sdate, ddate, cstatus)
where not exists (select 1 from public.patients x where x.name = p.name);

-- 6) Uma medição por paciente (espelha o status clínico atual).
insert into public.vital_sign_records (patient_id, period, monitoring_day, temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level, clinical_status)
select x.id, 'MORNING', 3, t.temp, t.spo2, t.sys, t.dia, t.hr, t.pain, t.dysp, x.current_status
from public.patients x
join (values
  ('RED',    38.9, 92, 150, 95, 110, 8, 4),
  ('YELLOW', 37.8, 94, 135, 88, 96, 6, 2),
  ('GREEN',  36.5, 98, 120, 80, 72, 1, 0)
) as t(st, temp, spo2, sys, dia, hr, pain, dysp) on t.st = x.current_status::text
where x.team_id = (select id from public.medical_teams where team_number = 1)
  and not exists (select 1 from public.vital_sign_records v where v.patient_id = x.id);

-- 7) Alertas (não atendidos) para os pacientes amarelo/vermelho.
insert into public.clinical_alerts (patient_id, team_id, status, description, attended)
select x.id, x.team_id, x.current_status,
       case x.current_status when 'RED' then 'Alerta vermelho: sinais vitais críticos.'
                             else 'Atenção: sinais vitais limítrofes.' end,
       false
from public.patients x
where x.team_id = (select id from public.medical_teams where team_number = 1)
  and x.current_status <> 'GREEN'
  and not exists (select 1 from public.clinical_alerts a where a.patient_id = x.id);
