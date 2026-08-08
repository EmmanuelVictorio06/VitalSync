-- ============================================================================
-- Matriz de LEITURA por papel (Seção 2.1) — via impersonação real de RLS.
--
-- Técnica: `set local role authenticated` + `request.jwt.claims` com o sub do
-- profile. NUNCA rode como postgres/service_role achando que testou RLS.
--
-- Massa: seed (equipe 1: 4 pacientes no Santa Vida, 2 alertas, 4 medições) +
-- fixture 00 (equipe 3: 1 paciente no São Lucas + 1 alerta; Pool Restrito só
-- Santa Vida). Totais: pacientes=5, alertas=3, medições=4.
--
-- Saída: uma linha PASS/FAIL por afirmação. Avalie com: grep -c FAIL == 0.
-- Transação única com ROLLBACK — não deixa resíduo.
-- ============================================================================
begin;

create temp table _ids on commit drop as select email, id::text as id from public.profiles;
grant select on _ids to public;

create function pg_temp.chk(cond boolean, nome text) returns text language sql as
$$ select case when cond then 'PASS  '||nome else 'FAIL  '||nome end $$;

create function pg_temp.entrar(p_email text) returns void language sql as
$$ select set_config('request.jwt.claims',
     json_build_object('sub', (select id from _ids where email = p_email), 'role', 'authenticated')::text, true) $$;

-- ---------------- CIRURGIÃO (equipe 1) ----------------
set local role authenticated;
select pg_temp.entrar('cirurgiao@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 4, 'L01 cirurgião vê exatamente os 4 pacientes da própria equipe');
select pg_temp.chk(not exists (select 1 from public.patients where name = 'Paciente EquipeTres'), 'L02 cirurgião NÃO vê o paciente da equipe 3');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 2, 'L03 cirurgião vê só os 2 alertas da própria equipe');
select pg_temp.chk((select count(*) from public.vital_sign_records) = 4, 'L04 cirurgião vê só as medições da própria equipe');
reset role;

-- ---------------- CIRURGIÃO 2 (equipe 3) ----------------
set local role authenticated;
select pg_temp.entrar('cirurgiao2@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 1, 'L05 cirurgião2 vê só o próprio paciente (equipe 3)');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 1, 'L06 cirurgião2 vê só o alerta da equipe 3');
reset role;

-- ---------------- MÉDICO ASSOCIADO (equipe 1) ----------------
set local role authenticated;
select pg_temp.entrar('medico@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 4, 'L07 associado vê os 4 pacientes da equipe 1');
-- Colegas da MESMA equipe (e o gerente vinculado) são visíveis por desenho —
-- a tela "Integrantes da Equipe" mostra e-mail/whatsapp deles (shares_team_with,
-- 0028/0036/0037). O invariante real é: NINGUÉM de fora do escopo aparece.
select pg_temp.chk(not exists (select 1 from public.profiles
                    where email in ('cirurgiao2@vitalsync.com','suporte@vitalsync.com',
                                    'enfermagem@vitalsync.com','enfermagem2@vitalsync.com','admin@vitalsync.com')),
                   'L08 associado NÃO lê perfil de quem não compartilha equipe (e-mail não vaza além do escopo)');
select pg_temp.chk((select count(*) from public.client_error_logs) = 0, 'L09 associado NÃO lê client_error_logs (só admin)');
select pg_temp.chk((select count(*) from public.app_settings) = 0, 'L10 associado NÃO lê app_settings');
select pg_temp.chk((select count(*) from public.homologation_settings) = 0, 'L11 associado NÃO lê homologation_settings (whitelist não vaza)');
select pg_temp.chk((select count(*) from public.patient_access_logs) = 0, 'L12 associado NÃO lê a trilha LGPD');
reset role;

-- ---------------- GERENTE (gerencia equipes 1 e 3) ----------------
set local role authenticated;
select pg_temp.entrar('gerente@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 5, 'L13 gerente vê os 5 pacientes das equipes vinculadas');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 3, 'L14 gerente vê os 3 alertas das equipes vinculadas');
reset role;

-- ---------------- SUPORTE ----------------
set local role authenticated;
select pg_temp.entrar('suporte@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 5, 'L15 suporte vê pacientes (papel operacional, por desenho — 0016)');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 0, 'L16 suporte NÃO vê alertas clínicos');
select pg_temp.chk((select count(*) from public.vital_sign_records) = 0, 'L17 suporte NÃO vê medições (dado clínico)');
reset role;

-- ---------------- ENFERMAGEM (Pool Geral: todos os hospitais) ----------------
set local role authenticated;
select pg_temp.entrar('enfermagem@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 5, 'L18 enfermeira do pool geral vê pacientes de TODAS as equipes cobertas');
select pg_temp.chk(exists (select 1 from public.patients where name = 'Paciente EquipeTres'), 'L19 enfermeira vê paciente de equipe da qual NÃO é membro (razão do pool)');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 3, 'L20 enfermeira vê os alertas de todo o pool');
select public.log_patient_access((select id from public.patients where name = 'Paciente EquipeTres'), 'teste-matriz-leitura');
reset role;

-- ---------------- ENFERMAGEM 2 (Pool Restrito: só Santa Vida) ----------------
set local role authenticated;
select pg_temp.entrar('enfermagem2@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 4, 'L21 enfermeira do pool restrito vê SÓ os pacientes do hospital coberto');
select pg_temp.chk(not exists (select 1 from public.patients where name = 'Paciente EquipeTres'), 'L22 enfermeira do pool restrito NÃO vê hospital fora do pool');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 2, 'L23 enfermeira do pool restrito vê só alertas do hospital coberto');
reset role;

-- ---------------- USUÁRIO INACTIVE (membro ativo da equipe 1) ----------------
set local role authenticated;
select pg_temp.entrar('inativo@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 0, 'L24 usuário INACTIVE não acessa pacientes');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 0, 'L25 usuário INACTIVE não acessa alertas');
reset role;

-- ---------------- ADMIN ----------------
set local role authenticated;
select pg_temp.entrar('admin@vitalsync.com');
select pg_temp.chk((select count(*) from public.patients) = 5, 'L26 admin vê todos os pacientes');
select pg_temp.chk((select count(*) from public.client_error_logs) >= 1, 'L27 admin lê client_error_logs');
select pg_temp.chk((select count(*) from public.patient_access_logs) >= 1, 'L28 admin lê a trilha LGPD (registro da enfermeira aparece)');
reset role;

-- ---------------- ANON (paciente sem login) ----------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.chk((select count(*) from public.patients) = 0, 'L29 anon não lê pacientes');
select pg_temp.chk((select count(*) from public.clinical_alerts) = 0, 'L30 anon não lê alertas');
select pg_temp.chk((select count(*) from public.vital_sign_records) = 0, 'L31 anon não lê medições');
select pg_temp.chk((select count(*) from public.profiles) = 0, 'L32 anon não lê profiles');
reset role;

rollback;
