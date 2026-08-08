-- ============================================================================
-- Fixture da matriz de autorização (Seção 2 do plano de testes).
--
-- Cria o que o seed NÃO cria de propósito, para que os testes de escopo tenham
-- o que discriminar:
--   • paciente na EQUIPE 3, em OUTRO hospital (São Lucas) + um alerta dele —
--     sem isso, "cirurgião não vê equipe alheia" é inconclusivo;
--   • POOL RESTRITO cobrindo SÓ o Hospital Santa Vida, com uma segunda
--     enfermeira que NÃO está no Pool Geral — sem isso, "enfermeiro não vê
--     hospital fora do pool" é inconclusivo (aviso explícito do plano);
--   • usuário SUPPORT (não existe no seed);
--   • usuário INACTIVE que é membro ATIVO de equipe — o caso esquecido.
--
-- Idempotente. Rode como postgres no banco LOCAL, depois do seed.
-- ============================================================================

-- Usuários de Auth (mesmo padrão do seed/0007; papel no metadata para o
-- handle_new_user gravar certo no INSERT — o trigger de proteção é só UPDATE).
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
  ('suporte@vitalsync.com',     'Sueli Suporte',       'SUPPORT'),
  ('enfermagem2@vitalsync.com', 'Enf. Regina Restrita','NURSING_PROFESSIONAL'),
  ('inativo@vitalsync.com',     'Inácio Inativo',      'ASSOCIATED_DOCTOR')
) as v(email, name, role)
where not exists (select 1 from auth.users u where u.email = v.email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.email, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in ('suporte@vitalsync.com','enfermagem2@vitalsync.com','inativo@vitalsync.com')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- INACTIVE de verdade: precisa do contexto service_role (0073) — nem o
-- superusuário postgres passa pelo trigger de proteção.
begin;
  set local role service_role;
  update public.profiles set status = 'INACTIVE' where email = 'inativo@vitalsync.com';
commit;

-- O inativo é membro ATIVO da equipe 1 (membership ACTIVE, profile INACTIVE):
-- é exatamente a combinação que os testes de acesso precisam exercitar.
insert into public.team_members (team_id, doctor_id, role_in_team)
select t.id, p.id, 'ASSOCIATED_DOCTOR'
from public.medical_teams t, public.profiles p
where t.team_number = 1 and p.email = 'inativo@vitalsync.com'
on conflict (team_id, doctor_id) do nothing;

-- Paciente da equipe 3, no OUTRO hospital.
insert into public.patients (name, phone, surgery_type_id, surgery_date, hospital_discharge_date, hospital_id, team_id, current_status)
select 'Paciente EquipeTres', '41999990009',
       (select id from public.surgery_types where name = 'Bariátrica'),
       current_date - 3, current_date - 1,
       (select id from public.hospitals where name = 'Hospital São Lucas'),
       (select id from public.medical_teams where team_number = 3),
       'YELLOW'
where not exists (select 1 from public.patients where name = 'Paciente EquipeTres');

insert into public.clinical_alerts (patient_id, team_id, status, description, attended)
select p.id, p.team_id, 'YELLOW', 'Alerta de teste da equipe 3.', false
from public.patients p
where p.name = 'Paciente EquipeTres'
  and not exists (select 1 from public.clinical_alerts a where a.patient_id = p.id);

-- Pool Restrito: cobre SÓ o Santa Vida; só a enfermagem2 é membro.
insert into public.nurse_pools (name)
select 'Pool Restrito (teste)'
where not exists (select 1 from public.nurse_pools where name = 'Pool Restrito (teste)');

insert into public.nurse_pool_hospitals (pool_id, hospital_id)
select pool.id, h.id
from public.nurse_pools pool, public.hospitals h
where pool.name = 'Pool Restrito (teste)' and h.name = 'Hospital Santa Vida'
on conflict (pool_id, hospital_id) do nothing;

insert into public.nurse_pool_members (pool_id, profile_id)
select pool.id, p.id
from public.nurse_pools pool, public.profiles p
where pool.name = 'Pool Restrito (teste)' and p.email = 'enfermagem2@vitalsync.com'
on conflict (pool_id, profile_id) do update set is_active = true;

-- Linha em client_error_logs (via papel anon, como a tela do paciente faria)
-- para o teste "só admin lê".
do $$
begin
  set local role anon;
  insert into public.client_error_logs (contexto, message) values ('fixture-teste', 'erro de teste');
  reset role;
exception when others then
  reset role;
  raise notice 'client_error_logs insert como anon FALHOU: % (isso em si é um achado)', sqlerrm;
end $$;

select 'FIXTURE OK · pacientes='||(select count(*) from public.patients)
     ||' · pools='||(select count(*) from public.nurse_pools)
     ||' · perfis='||(select count(*) from public.profiles);
