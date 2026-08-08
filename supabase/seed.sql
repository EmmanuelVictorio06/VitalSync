-- ============================================================================
-- VitalSync — Seed de desenvolvimento (autossuficiente)
--
-- ############################################################################
-- ##  ⚠️  NUNCA RODE ESTE ARQUIVO EM PRODUÇÃO.                              ##
-- ##                                                                        ##
-- ##  Ele CRIA CONTAS DE LOGIN COM SENHA FIXA E PÚBLICA (`senha123`).       ##
-- ##  Rodar contra o banco de produção entregaria acesso de ADMINISTRADOR   ##
-- ##  a qualquer pessoa que conheça este repositório.                       ##
-- ##                                                                        ##
-- ##  O passo 0 aborta sozinho se o banco não parecer local — mas essa      ##
-- ##  guarda é a última linha de defesa, não uma permissão para arriscar.   ##
-- ############################################################################
--
-- NÃO exige mais nenhum passo manual: roda sozinho a cada `supabase db reset`
-- (config.toml → [db.seed] enabled = true). Antes, dependia de usuários
-- criados à mão pelo Dashboard — e como o `db reset` apaga `auth.users`, todo
-- reset deixava o banco inutilizável até alguém recadastrar tudo.
--
-- CREDENCIAIS DE DESENVOLVIMENTO (todas com senha `senha123`):
--   admin@vitalsync.com       Administrador
--   cirurgiao@vitalsync.com   Médico Cirurgião (equipe 01)
--   medico@vitalsync.com      Médico Associado (equipe 01)
--   cirurgiao2@vitalsync.com  Médico Cirurgião (equipe 03)
--   gerente@vitalsync.com     Gerente de Equipe
--   enfermagem@vitalsync.com  Profissional de Enfermagem (pool + plantão aberto)
--
-- Idempotente: pode ser re-rodado sem duplicar nem falhar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) GUARDA ANTI-PRODUÇÃO. Aborta antes de criar qualquer senha conhecida.
--
--    Critério: o banco de dev do Supabase CLI chama-se `postgres` e roda com
--    a porta/host locais. Como isso também vale para um Postgres qualquer,
--    somamos um segundo sinal: produção TEM paciente real (is_test = false).
--    Um banco com paciente real nunca deve receber contas de senha fixa.
-- ----------------------------------------------------------------------------
do $$
declare v_reais int;
begin
  select count(*) into v_reais from public.patients where coalesce(is_test, false) = false;
  if v_reais > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = 'SEED BLOQUEADO: este banco tem % paciente(s) real(is) — parece produção.',
      detail  = 'O seed cria contas com a senha pública `senha123`. Rodá-lo aqui entregaria acesso de ADMIN.',
      hint    = 'Se este banco é mesmo descartável, apague os pacientes reais antes ou rode o seed manualmente.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 0b) Usuários de Auth. Padrão copiado de `admin_create_user` (0007).
--
--     ⚠️ O PAPEL VAI EM `raw_user_meta_data` DE PROPÓSITO — não é decoração.
--     O trigger `handle_new_user` (0001) lê `raw_user_meta_data->>'role'` no
--     INSERT do profile, então o papel já nasce correto. Isso contorna, sem
--     desabilitar nada, o trigger `protect_profile_privileged_fields` (0006),
--     que é BEFORE UPDATE e reverte `role`/`status` quando `is_admin()` é
--     falso — e `is_admin()` depende de `auth.uid()`, que é nulo aqui.
--     Sem o metadata, todos nasceriam ASSOCIATED_DOCTOR e o vínculo de
--     gerente falharia depois com INVALID_MANAGER_ROLE.
-- ----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       v.email, crypt('senha123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('name', v.name, 'role', v.role),
       now(), now(), '', '', '', ''
from (values
  ('admin@vitalsync.com',      'Administrador',       'ADMIN'),
  ('cirurgiao@vitalsync.com',  'Dra. Ana Souza',      'MEDICAL_SURGEON'),
  ('medico@vitalsync.com',     'Dr. Bruno Tavares',   'ASSOCIATED_DOCTOR'),
  ('cirurgiao2@vitalsync.com', 'Dr. Carlos Mendes',   'MEDICAL_SURGEON'),
  ('gerente@vitalsync.com',    'Gabriela Lima',       'TEAM_MANAGER'),
  ('enfermagem@vitalsync.com', 'Enf. Patrícia Nunes', 'NURSING_PROFESSIONAL')
) as v(email, name, role)
where not exists (select 1 from auth.users u where u.email = v.email);

-- Identidade de e-mail: sem ela o GoTrue não autentica por senha.
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id, u.email, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in ('admin@vitalsync.com', 'cirurgiao@vitalsync.com', 'medico@vitalsync.com',
                  'cirurgiao2@vitalsync.com', 'gerente@vitalsync.com', 'enfermagem@vitalsync.com')
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

-- 1) Profiles dos usuários (lidos de auth.users) com os papéis corretos.
--    O handle_new_user já criou as linhas com o papel certo (via metadata);
--    este passo apenas completa nome/e-mail e serve de rede caso o trigger
--    não exista no ambiente. O `do update` de `role` é inofensivo: repõe o
--    mesmo valor que já está lá.
insert into public.profiles (id, name, email, role)
select u.id,
       case u.email
         when 'admin@vitalsync.com'      then 'Administrador'
         when 'cirurgiao@vitalsync.com'  then 'Dra. Ana Souza'
         when 'medico@vitalsync.com'     then 'Dr. Bruno Tavares'
         when 'cirurgiao2@vitalsync.com' then 'Dr. Carlos Mendes'
         when 'gerente@vitalsync.com'    then 'Gabriela Lima'
         when 'enfermagem@vitalsync.com' then 'Enf. Patrícia Nunes'
       end,
       u.email,
       (case u.email
          when 'admin@vitalsync.com'      then 'ADMIN'
          when 'cirurgiao@vitalsync.com'  then 'MEDICAL_SURGEON'
          when 'medico@vitalsync.com'     then 'ASSOCIATED_DOCTOR'
          when 'cirurgiao2@vitalsync.com' then 'MEDICAL_SURGEON'
          when 'gerente@vitalsync.com'    then 'TEAM_MANAGER'
          when 'enfermagem@vitalsync.com' then 'NURSING_PROFESSIONAL'
        end)::public.user_role
from auth.users u
where u.email in ('admin@vitalsync.com', 'cirurgiao@vitalsync.com', 'medico@vitalsync.com',
                  'cirurgiao2@vitalsync.com', 'gerente@vitalsync.com', 'enfermagem@vitalsync.com')
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

-- Rede de segurança: com o passo 0b, isto NÃO deve mais disparar. Se disparar,
-- é sinal de que a criação em auth.users falhou (ou que o schema do GoTrue
-- mudou) — vale investigar em vez de recadastrar à mão.
do $$
declare missing text;
begin
  select string_agg(e, ', ') into missing
  from (select unnest(array['admin@vitalsync.com','cirurgiao@vitalsync.com','medico@vitalsync.com',
                            'enfermagem@vitalsync.com']) e) x
  where not exists (select 1 from public.profiles p where p.email = x.e);
  if missing is not null then
    raise exception 'Faltam usuários no Auth: %. O passo 0b deste seed deveria tê-los criado — verifique se auth.users/auth.identities aceitaram o insert.', missing;
  end if;
end $$;

-- Confere que o papel sobreviveu. Se algum vier ASSOCIATED_DOCTOR sem ser o
-- do médico associado, o `raw_user_meta_data->>'role'` não foi lido pelo
-- handle_new_user e o trigger de proteção reverteu o UPDATE do passo 1.
do $$
declare v_errado text;
begin
  select string_agg(p.email || ' (' || p.role::text || ')', ', ') into v_errado
  from public.profiles p
  where (p.email = 'admin@vitalsync.com'      and p.role::text <> 'ADMIN')
     or (p.email = 'gerente@vitalsync.com'    and p.role::text <> 'TEAM_MANAGER')
     or (p.email = 'enfermagem@vitalsync.com' and p.role::text <> 'NURSING_PROFESSIONAL');
  if v_errado is not null then
    raise exception 'Papéis não aplicados: %. Verifique o trigger handle_new_user (0001) e protect_profile_privileged_fields (0006).', v_errado;
  end if;
end $$;

-- 2) Catálogos. WHERE NOT EXISTS (não ON CONFLICT): name não tem constraint
--    única, então ON CONFLICT nunca dispara e re-rodar o seed duplicaria tudo.
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

-- 3) Equipes — no máximo UMA equipe ativa por cirurgião (trigger da migration
--    0033). Equipe 01 → Dra. Ana; equipe 03 → Dr. Carlos (só se o usuário
--    opcional existir). Guardas WHERE NOT EXISTS em vez de ON CONFLICT: o
--    trigger BEFORE INSERT dispara antes da resolução de conflito e quebraria
--    a idempotência ao re-rodar o seed.
insert into public.medical_teams (team_number, main_surgeon_id)
select 1, (select id from public.profiles where email = 'cirurgiao@vitalsync.com')
where not exists (select 1 from public.medical_teams where team_number = 1);

insert into public.medical_teams (team_number, main_surgeon_id)
select 3, p.id
from public.profiles p
where p.email = 'cirurgiao2@vitalsync.com'
  and not exists (select 1 from public.medical_teams where team_number = 3);

-- 3b) Vínculo Gerente↔Cirurgião (se gerente@vitalsync.com existir): Gabriela
--     gerencia os dois cirurgiões — cenário das Fases 2/4/5.
insert into public.team_manager_surgeons (team_manager_id, surgeon_id)
select g.id, s.id
from public.profiles g
join public.profiles s on s.email in ('cirurgiao@vitalsync.com', 'cirurgiao2@vitalsync.com')
where g.email = 'gerente@vitalsync.com'
  and not exists (
    select 1 from public.team_manager_surgeons t
    where t.team_manager_id = g.id and t.surgeon_id = s.id and t.is_active
  );

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

-- ----------------------------------------------------------------------------
-- 8) Triagem de enfermagem (migrations 0065–0068) pronta para uso.
--
--    Sem estes três passos a funcionalidade é IMPOSSÍVEL de exercitar em dev:
--    `is_nurse_for_patient()` seria falso para todo mundo e a fila ficaria
--    vazia, sem nenhum erro que explicasse o porquê.
-- ----------------------------------------------------------------------------

-- 8a) Vincula os hospitais ao pool geral.
--     O seed da própria 0065 já tenta isso, mas roda ANTES deste arquivo —
--     quando `public.hospitals` ainda está vazia. Por isso o vínculo precisa
--     ser refeito aqui, depois que o passo 2 criou os hospitais.
insert into public.nurse_pool_hospitals (pool_id, hospital_id)
select p.id, h.id
from public.nurse_pools p
cross join public.hospitals h
where p.is_active and h.status = 'ACTIVE'
on conflict (pool_id, hospital_id) do nothing;

-- 8b) Coloca a enfermeira no pool.
insert into public.nurse_pool_members (pool_id, profile_id)
select p.id, pr.id
from public.nurse_pools p
cross join public.profiles pr
where p.is_active
  and pr.email = 'enfermagem@vitalsync.com'
on conflict (pool_id, profile_id) do update set is_active = true;

-- 8c) Plantão aberto, para `is_nurse_on_duty()` ser verdadeiro e a fila de
--     oferta funcionar sem nenhuma configuração manual.
--
--     ⚠️ `ends_at` FICA NULO DE PROPÓSITO. `is_nurse_on_duty()` (0065) exige
--     `ends_at is null` — ou seja, trata QUALQUER `ends_at` preenchido como
--     turno encerrado, mesmo que a data esteja no futuro. É também o que
--     `nurse_open_shift()` grava (só profile_id + pool_id), e
--     `nurse_close_shift()` é quem preenche `ends_at = now()`.
--
--     Consequência para quem for construir escala de plantão depois: turno
--     AGENDADO (com fim futuro) não conta como ativo e não recebe oferta,
--     sem nenhum erro que explique. Se o produto precisar disso, o helper é
--     que tem de mudar (`ends_at is null or ends_at > now()`) — não adianta
--     só gravar a data aqui.
insert into public.nurse_shifts (profile_id, pool_id, starts_at)
select pr.id, m.pool_id, now() - interval '1 hour'
from public.profiles pr
join public.nurse_pool_members m on m.profile_id = pr.id and m.is_active
where pr.email = 'enfermagem@vitalsync.com'
  and not exists (
    select 1 from public.nurse_shifts s
    where s.profile_id = pr.id and s.ends_at is null
  );
