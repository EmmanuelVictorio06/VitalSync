-- ============================================================================
-- VitalSync — Seed de demonstração (robusto, DEV LOCAL)
--
-- COMO APLICAR MUDANÇAS SEM PERDER DADOS (leia isto):
--   • Para aplicar migrations novas mantendo login + pacientes:  supabase migration up
--   • `supabase db reset` APAGA o banco inteiro e reconstrói a partir das
--     migrations + deste seed. Ou seja, tudo o que você criou em runtime
--     (usuários novos, pacientes novos, senhas trocadas) é DESCARTADO, e só
--     volta o que está escrito aqui. Use db reset SÓ quando quiser zerar.
--
-- O QUE ESTE SEED GARANTE (idempotente; pode rodar quantas vezes quiser):
--   0) CRIA/GARANTE os 3 usuários de Auth (senha SEMPRE `senha123`), com
--      auth.identities e com as colunas de token preenchidas ('') — sem isso o
--      GoTrue local pode devolver 500 no login ("linhas em auth.users inseridas
--      na mão quebram o login"). Em DO block: se o schema do Auth diferir, AVISA
--      e segue (você cria no Studio, Auto Confirm, e roda o seed de novo).
--   1) Define os papéis corretos DESLIGANDO trg_protect_profile (0006), que
--      senão reverte a role pro default ASSOCIATED_DOCTOR.
--   5) Pacientes com datas RELATIVAS a hoje (current_date - N), pra caírem
--      sempre dentro da janela de 10 dias e aparecerem na lista.
--
-- ⚠️  O bloco 0 é SÓ PARA DEV LOCAL. Nunca rode em produção.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Usuários de Auth (DEV LOCAL). Cria/garante admin/cirurgiao/medico com
--    senha `senha123`, confirmados, + auth.identities. Tudo em DO block com
--    tratamento de erro: se o schema do Auth for diferente, avisa e NÃO aborta.
-- ----------------------------------------------------------------------------
do $$
begin
  -- 0.a) cria os usuários que ainda não existem.
  --      As colunas de token vão como '' (não NULL) de propósito: várias versões
  --      do GoTrue estouram 500 ao ler NULL nesses campos.
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
     confirmation_token, recovery_token, email_change, email_change_token_new)
  select '00000000-0000-0000-0000-000000000000'::uuid,
         gen_random_uuid(), 'authenticated', 'authenticated', e.email,
         crypt('senha123', gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         now(), now(),
         '', '', '', ''
  from (values ('admin@vitalsync.com'),
               ('cirurgiao@vitalsync.com'),
               ('medico@vitalsync.com')) as e(email)
  where not exists (select 1 from auth.users u where u.email = e.email);

  -- 0.b) GARANTE senha e confirmação dos usuários-semente, mesmo se já existirem
  --      (login previsível após qualquer reset; conserta senha trocada em runtime).
  update auth.users u
     set encrypted_password = crypt('senha123', gen_salt('bf')),
         email_confirmed_at = coalesce(u.email_confirmed_at, now()),
         confirmation_token = coalesce(nullif(u.confirmation_token, ''), ''),
         recovery_token     = coalesce(nullif(u.recovery_token, ''), ''),
         email_change       = coalesce(nullif(u.email_change, ''), ''),
         email_change_token_new = coalesce(nullif(u.email_change_token_new, ''), ''),
         updated_at = now()
   where u.email in ('admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com');

  -- 0.c) identities (provider 'email') — sem isto o login dá 500.
  insert into auth.identities
    (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from auth.users u
  where u.email in ('admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com')
    and not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    );
exception when others then
  raise warning 'Não criei/garanti os usuários de Auth automaticamente (%). Crie admin@/cirurgiao@/medico@vitalsync.com no Studio (Auth -> Users -> Add user, Auto Confirm, senha senha123) e rode o seed de novo.', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 1) Profiles com os papéis corretos.
--    trg_protect_profile (0006) reverte a troca de role quando quem executa não
--    é admin — e no seed não há sessão admin. Desligamos a trava SÓ neste upsert.
-- ----------------------------------------------------------------------------
alter table public.profiles disable trigger trg_protect_profile;

insert into public.profiles (id, name, email, role)
select u.id,
       case u.email
         when 'admin@vitalsync.com'      then 'Administrador'
         when 'cirurgiao@vitalsync.com'  then 'Dra. Ana Souza'
         when 'medico@vitalsync.com'     then 'Dr. Bruno Tavares'
         when 'cirurgiao2@vitalsync.com' then 'Dr. Carlos Mendes'
         when 'gerente@vitalsync.com'    then 'Gabriela Lima'
       end,
       u.email,
       (case u.email
          when 'admin@vitalsync.com'      then 'ADMIN'
          when 'cirurgiao@vitalsync.com'  then 'MEDICAL_SURGEON'
          when 'medico@vitalsync.com'     then 'ASSOCIATED_DOCTOR'
          when 'cirurgiao2@vitalsync.com' then 'MEDICAL_SURGEON'
          when 'gerente@vitalsync.com'    then 'TEAM_MANAGER'
        end)::public.user_role
from auth.users u
where u.email in ('admin@vitalsync.com', 'cirurgiao@vitalsync.com', 'medico@vitalsync.com',
                  'cirurgiao2@vitalsync.com', 'gerente@vitalsync.com')
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

alter table public.profiles enable trigger trg_protect_profile;

-- Verificação amigável: AVISA (não aborta) se faltar algum usuário, para o reset
-- não morrer no meio e os pacientes/catálogos ainda entrarem.
do $$
declare missing text;
begin
  select string_agg(e, ', ') into missing
  from (select unnest(array['admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com']) e) x
  where not exists (select 1 from public.profiles p where p.email = x.e);
  if missing is not null then
    raise warning 'Faltam usuários no Auth: %. Crie-os em Authentication -> Users (Auto Confirm, senha senha123) e rode o seed de novo.', missing;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) Catálogos. WHERE NOT EXISTS (não ON CONFLICT): name não tem constraint
--    única, então ON CONFLICT nunca dispara e re-rodar o seed duplicaria tudo.
-- ----------------------------------------------------------------------------
insert into public.hospitals (name, city, state)
select v.name, v.city, v.state
from (values
  ('Hospital Santa Vida', 'Curitiba', 'PR'),
  ('Hospital São Lucas', 'Curitiba', 'PR')
) as v(name, city, state)
where not exists (select 1 from public.hospitals h where h.name = v.name);

insert into public.surgery_types (name, specialty)
select v.name, v.specialty
from (values
  ('Bariátrica', 'Cirurgia Geral'),
  ('Ortopédica - Joelho', 'Ortopedia'),
  ('Artroplastia de Quadril', 'Ortopedia')
) as v(name, specialty)
where not exists (select 1 from public.surgery_types s where s.name = v.name);

-- ----------------------------------------------------------------------------
-- 3) Equipes — no máximo UMA equipe ativa por cirurgião (trigger da 0033).
-- ----------------------------------------------------------------------------
insert into public.medical_teams (team_number, main_surgeon_id)
select 1, (select id from public.profiles where email = 'cirurgiao@vitalsync.com')
where not exists (select 1 from public.medical_teams where team_number = 1);

insert into public.medical_teams (team_number, main_surgeon_id)
select 3, p.id
from public.profiles p
where p.email = 'cirurgiao2@vitalsync.com'
  and not exists (select 1 from public.medical_teams where team_number = 3);

-- 3b) Vínculo Gerente<->Cirurgião (se gerente@vitalsync.com existir).
insert into public.team_manager_surgeons (team_manager_id, surgeon_id)
select g.id, s.id
from public.profiles g
join public.profiles s on s.email in ('cirurgiao@vitalsync.com', 'cirurgiao2@vitalsync.com')
where g.email = 'gerente@vitalsync.com'
  and not exists (
    select 1 from public.team_manager_surgeons t
    where t.team_manager_id = g.id and t.surgeon_id = s.id and t.is_active
  );

-- ----------------------------------------------------------------------------
-- 4) Vincula o médico associado à equipe 01.
-- ----------------------------------------------------------------------------
insert into public.team_members (team_id, doctor_id, role_in_team)
select (select id from public.medical_teams where team_number = 1),
       (select id from public.profiles where email = 'medico@vitalsync.com'),
       'ASSOCIATED_DOCTOR'
on conflict (team_id, doctor_id) do nothing;

-- ----------------------------------------------------------------------------
-- 5) Pacientes na equipe 01 — DATAS RELATIVAS a hoje (dentro dos 10 dias).
--    sd = dias desde a cirurgia, dd = dias desde a alta.
-- ----------------------------------------------------------------------------
insert into public.patients (name, phone, surgery_type_id, surgery_date, hospital_discharge_date, hospital_id, team_id, current_status)
select p.name, p.phone,
       (select id from public.surgery_types where name = p.stype),
       current_date - p.sd, current_date - p.dd,
       (select id from public.hospitals where name = 'Hospital Santa Vida'),
       (select id from public.medical_teams where team_number = 1),
       p.cstatus::public.clinical_status
from (values
  ('Marcos Oliveira', '41999990001', 'Bariátrica',              5, 2, 'RED'),
  ('Elena Ricci',     '41999990002', 'Ortopédica - Joelho',     4, 1, 'YELLOW'),
  ('Julian Bass',     '41999990003', 'Artroplastia de Quadril', 6, 3, 'GREEN'),
  ('Beatriz Silva',   '41999990004', 'Bariátrica',              4, 1, 'GREEN')
) as p(name, phone, stype, sd, dd, cstatus)
where not exists (select 1 from public.patients x where x.name = p.name);

-- ----------------------------------------------------------------------------
-- 6) Uma medição por paciente (espelha o status clínico atual). monitoring_day
--    calculado a partir da alta relativa.
-- ----------------------------------------------------------------------------
insert into public.vital_sign_records (patient_id, period, monitoring_day, temperature, oxygen_saturation, systolic_pressure, diastolic_pressure, heart_rate, pain_level, dyspnea_level, clinical_status)
select x.id, 'MORNING',
       least(10, greatest(1, (current_date - x.hospital_discharge_date) + 1)),
       t.temp, t.spo2, t.sys, t.dia, t.hr, t.pain, t.dysp, x.current_status
from public.patients x
join (values
  ('RED',    38.9, 92, 150, 95, 110, 8, 4),
  ('YELLOW', 37.8, 94, 135, 88, 96, 6, 2),
  ('GREEN',  36.5, 98, 120, 80, 72, 1, 0)
) as t(st, temp, spo2, sys, dia, hr, pain, dysp) on t.st = x.current_status::text
where x.team_id = (select id from public.medical_teams where team_number = 1)
  and not exists (select 1 from public.vital_sign_records v where v.patient_id = x.id);

-- ----------------------------------------------------------------------------
-- 7) Alertas (não atendidos) para os pacientes amarelo/vermelho.
-- ----------------------------------------------------------------------------
insert into public.clinical_alerts (patient_id, team_id, status, description, attended)
select x.id, x.team_id, x.current_status,
       case x.current_status when 'RED' then 'Alerta vermelho: sinais vitais críticos.'
                             else 'Atenção: sinais vitais limítrofes.' end,
       false
from public.patients x
where x.team_id = (select id from public.medical_teams where team_number = 1)
  and x.current_status <> 'GREEN'
  and not exists (select 1 from public.clinical_alerts a where a.patient_id = x.id);
