-- ============================================================================
-- VitalSync — Seed de demonstração
--
-- PRÉ-REQUISITO: crie 3 usuários no Supabase (Authentication → Users → Add user,
-- "Auto Confirm User") com senha `senha123`:
--   admin@vitalsync.com        (Admin)
--   cirurgiao@vitalsync.com    (Cirurgião principal)
--   medico@vitalsync.com       (Médico associado)
-- O trigger handle_new_user cria os profiles automaticamente. Depois rode ESTE
-- script (idempotente) para definir papéis e popular os dados de exemplo.
-- ============================================================================

-- Papéis dos usuários de teste.
update public.profiles set role = 'ADMIN',             name = 'Administrador'   where email = 'admin@vitalsync.com';
update public.profiles set role = 'MAIN_SURGEON',      name = 'Dra. Ana Souza'  where email = 'cirurgiao@vitalsync.com';
update public.profiles set role = 'ASSOCIATED_DOCTOR', name = 'Dr. Bruno Tavares' where email = 'medico@vitalsync.com';

-- Catálogos.
insert into public.hospitals (name, city, state) values
  ('Hospital Santa Vida', 'Curitiba', 'PR'),
  ('Hospital São Lucas', 'Curitiba', 'PR')
on conflict do nothing;

insert into public.surgery_types (name, specialty) values
  ('Bariátrica', 'Cirurgia Geral'),
  ('Ortopédica - Joelho', 'Ortopedia'),
  ('Artroplastia de Quadril', 'Ortopedia')
on conflict do nothing;

-- Equipes (cirurgião responsável = cirurgiao@vitalsync.com).
insert into public.medical_teams (team_number, main_surgeon_id)
select v.num, (select id from public.profiles where email = 'cirurgiao@vitalsync.com')
from (values (1), (3), (7)) as v(num)
on conflict (team_number) do nothing;

-- Vincula o médico associado à equipe 01.
insert into public.team_members (team_id, doctor_id, role_in_team)
select (select id from public.medical_teams where team_number = 1),
       (select id from public.profiles where email = 'medico@vitalsync.com'),
       'ASSOCIATED_DOCTOR'
on conflict (team_id, doctor_id) do nothing;

-- Pacientes na equipe 01 (com status clínico variado).
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

-- Uma medição por paciente (espelha o status clínico atual).
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

-- Alertas (não atendidos) para os pacientes amarelo/vermelho.
insert into public.clinical_alerts (patient_id, team_id, status, description, attended)
select x.id, x.team_id, x.current_status,
       case x.current_status when 'RED' then 'Alerta vermelho: sinais vitais críticos.'
                             else 'Atenção: sinais vitais limítrofes.' end,
       false
from public.patients x
where x.team_id = (select id from public.medical_teams where team_number = 1)
  and x.current_status <> 'GREEN'
  and not exists (select 1 from public.clinical_alerts a where a.patient_id = x.id);
