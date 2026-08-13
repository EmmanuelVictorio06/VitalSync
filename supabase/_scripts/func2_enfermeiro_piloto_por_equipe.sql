-- ============================================================================
-- FUNC 2 — Profissional de Enfermagem com ESCOPO ESTRITO POR EQUIPE (piloto)
--
-- NÃO É MIGRATION. Script operacional de configuração: rodar no SQL Editor do
-- Supabase (role `postgres`). Não cria nem altera nenhum objeto de schema —
-- só DADOS: `profiles`, `team_members`, `nurse_pool_members.is_active`,
-- `patients.hospital_id`.
--
-- CENÁRIO: um médico atua como enfermeiro por uma semana. Ele vê e tria os
-- alertas de UMA equipe — e só dela. A fronteira é `team_members`
-- (`is_team_member()`), NUNCA o pool (`is_nurse_for_patient()`).
--
-- POR QUE NÃO PRECISA DE CÓDIGO (verificado no repo):
--   • RLS de leitura (0066): alerts_select / patients_select / vitals_select /
--     attendance_select / missed_measurement_logs_select são
--     `is_admin() OR is_team_member(...) OR is_nurse_for_patient(...)`.
--     O ramo de EQUIPE é de primeira classe; o pool é só um `or` ao lado.
--   • Guarda de escrita (0067): `can_act_on_alert()` =
--     `is_admin() OR is_team_member(team) OR is_nurse_for_patient(patient)`.
--     Usada por alert_set_in_analysis / alert_mark_attended / alert_ignore /
--     alert_release_analysis / alert_register_contact e, indiretamente, por
--     `nurse_claim_alert` (0068).
--   • `is_team_member()` (0001) NÃO distingue `role_in_team`: basta a linha
--     ATIVA em team_members.
--   • `is_nurse()` (0065) lê `profiles.role` — não o pool, não o plantão. O
--     enfermeiro do piloto é "enfermeiro" para todos os efeitos (bloqueio de
--     vermelho incluído) SEM estar em pool nenhum.
--   • A fila do frontend (`NurseTriage` → `alertService.getAlerts()`) mostra o
--     que a RLS permite e não exige plantão aberto para renderizar.
--
-- PLACEHOLDERS — substitua antes de rodar:
--   <PROFILE_ID>       = profiles.id (= auth.users.id) do médico-enfermeiro
--   <EQUIPE_DO_PILOTO> = medical_teams.id da equipe do piloto
-- (mais adiante aparecem <HOSPITAL_ID>, <PACIENTE_DE_OUTRA_EQUIPE> e
--  <EQUIPE_DE_FORA>, usados só na verificação.)
--
-- ORDEM: rode os blocos 0 → 5 em sequência. O bloco 0 não escreve nada.
-- ============================================================================


-- ############################################################################
-- 0) DIAGNÓSTICO — rode ANTES e leia. Nada aqui escreve.
-- ############################################################################

-- 0.1 Quem é o profissional e como está hoje.
select id, name, email, role, status, whatsapp, professional_tag
  from public.profiles
 where id = '<PROFILE_ID>';

-- 0.2 Qual é a equipe e quem é o cirurgião responsável.
select t.id, t.team_number, t.status, t.main_surgeon_id, p.name as cirurgiao
  from public.medical_teams t
  left join public.profiles p on p.id = t.main_surgeon_id
 where t.id = '<EQUIPE_DO_PILOTO>';

-- 0.3 VAZAMENTO DE ESCOPO Nº 1 — vínculos de equipe que ele JÁ tem.
--     `is_team_member()` também é true para quem é `main_surgeon_id`. Se este
--     profile for cirurgião responsável de outra equipe, ele verá os alertas
--     DELA também. Depois do bloco 2, esta consulta deve listar SÓ a equipe do
--     piloto. Se listar mais, use uma conta SEPARADA para o papel de enfermeiro.
select 'main_surgeon' as vinculo, t.id as team_id, t.team_number, t.status
  from public.medical_teams t
 where t.main_surgeon_id = '<PROFILE_ID>'
union all
select 'team_member (' || m.role_in_team::text || '/' || m.status || ')',
       t.id, t.team_number, t.status
  from public.team_members m
  join public.medical_teams t on t.id = m.team_id
 where m.doctor_id = '<PROFILE_ID>';

-- 0.4 VAZAMENTO DE ESCOPO Nº 2 — ele já está em algum pool?
--     A seed da 0065 (linhas 350-357) incluiu no "Pool Geral" TODO
--     NURSING_PROFESSIONAL ativo que existia quando a migration rodou.
--     Deve retornar ZERO linhas ativas — o bloco 3.1 garante isso.
select m.pool_id, pool.name, m.is_active
  from public.nurse_pool_members m
  join public.nurse_pools pool on pool.id = m.pool_id
 where m.profile_id = '<PROFILE_ID>';

-- 0.5 Estado dos pools: quantos enfermeiros ATIVOS cada um tem hoje.
--     Alvo do piloto: enfermeiros_ativos = 0 (ver bloco 3.2 e a nota do 3.4).
select pool.id, pool.name, pool.is_active,
       (select count(*) from public.nurse_pool_hospitals h where h.pool_id = pool.id) as hospitais,
       (select count(*) from public.nurse_pool_members m
          join public.profiles pr on pr.id = m.profile_id and pr.status = 'ACTIVE'
         where m.pool_id = pool.id and m.is_active) as enfermeiros_ativos
  from public.nurse_pools pool;

-- 0.6 Distribuição automática de ofertas: DEVE ficar FALSE no piloto.
--     Com autoRouting=true, `offer_yellow_alert()` (0068) só oferece a membros
--     do POOL — o enfermeiro do piloto nunca receberia oferta. O modo manual
--     (fila aberta + botão "Assumir") é o caminho correto aqui.
--     Se vier `true`, desligue:
--       update public.app_settings
--          set data = data || '{"autoRouting": false}'::jsonb
--        where section = 'nursing';
select data->'autoRouting' as auto_routing, data->'wipLimit' as wip_limit
  from public.app_settings where section = 'nursing';


-- ############################################################################
-- 1) PROFILES — papel, status e WhatsApp.
--
--    Sem `whatsapp`, `notify_team_of_alert` grava a linha em notification_logs
--    com telefone nulo e a Edge Function a marca FAILED ("Destinatário sem
--    telefone cadastrado") — o enfermeiro não recebe nada.
--
--    FORMATO: E.164 SEM o '+', só dígitos (55 + DDD + número). É como
--    `admin_create_user` grava (`regexp_replace(..., '\D', '', 'g')`) e o que
--    a Meta Cloud API espera. Ex.: +55 (41) 99999-9999 -> '5541999999999'.
-- ############################################################################

update public.profiles
   set role     = 'NURSING_PROFESSIONAL',
       status   = 'ACTIVE',
       whatsapp = '5541999999999'      -- <<< TROQUE pelo número real
 where id = '<PROFILE_ID>';


-- ############################################################################
-- 2) TEAM_MEMBERS — o vínculo que DEFINE o escopo.
--
--    role_in_team = 'ASSOCIATED_DOCTOR' — deliberado, não descuido. A tabela
--    tem DUAS check constraints vivas que só aceitam esse valor:
--      • team_members_assoc_only_chk       (0026 — NOT VALID, mas ativa p/ INSERT)
--      • team_members_role_associate_only  (0030 — VALID)
--    e nenhuma migration posterior as removeu. Inserir 'NURSING_PROFESSIONAL'
--    aqui falharia com violação de check.
--
--    DÍVIDA TÉCNICA ACEITA: relaxar a constraint exigiria migration, e não
--    compra nada — NADA no fluxo de enfermagem lê `role_in_team`:
--      • `is_team_member()` (0001) ignora role_in_team  -> escopo de leitura OK
--      • `notify_team_of_alert()` (0018) manda para main_surgeon + TODOS os
--        team_members ATIVOS, sem olhar role_in_team    -> recebe WhatsApp OK
--      • fallback de EQUIPE da medição esquecida (0069/0073, passo 3) idem
--      • `nurse_may_finalize()` (0067) usa `is_nurse()`, que lê profiles.role
--                                                        -> bloqueio de vermelho OK
--    O papel real do profissional mora em `profiles.role`, e é ele que o app
--    inteiro consulta (menu, guardas, dashboard).
--
--    Efeitos colaterais conhecidos e aceitáveis: consome 1 das 10 vagas de
--    associado da equipe (trigger `trg_team_doctor_limit`, 0028) e dispara o
--    aviso "você foi adicionado à equipe" (trigger `trg_notify_team_member_added`,
--    0030) — que neste caso é desejável.
-- ############################################################################

insert into public.team_members (team_id, doctor_id, role_in_team, status)
values ('<EQUIPE_DO_PILOTO>', '<PROFILE_ID>', 'ASSOCIATED_DOCTOR', 'ACTIVE')
on conflict (team_id, doctor_id) do update   -- unique(team_id, doctor_id) da 0001
   set status       = 'ACTIVE',
       role_in_team = 'ASSOCIATED_DOCTOR';


-- ############################################################################
-- 3) POOL GERAL DE ENFERMAGEM — deve ficar SEM MEMBROS ATIVOS no piloto.
--
--    DUAS razões, ambas de escopo:
--
--    (i) O enfermeiro do piloto fora do pool  -> `is_nurse_for_patient()` é
--        falso para ele em qualquer paciente, então o único acesso que tem é o
--        de equipe. É isso que torna o escopo ESTRITO.
--
--   (ii) O pool sem NINGUÉM  -> a medição esquecida chega nele. A versão viva de
--        `enqueue_missed_measurement_alerts` é a 0073 (cópia da 0069) e roteia
--        POOL-PRIMEIRO:
--           (1) enfermeiro LIVRE do pool que cobre o hospital
--           (2) qualquer membro ATIVO do pool
--           (3) fallback de EQUIPE (main_surgeon + team_members ativos)
--           (4) NO_RECIPIENT
--        O passo 3 só roda se 1 e 2 não acharem NINGUÉM. Com outros enfermeiros
--        ativos no pool, o aviso vai para ELES e o enfermeiro do piloto não
--        recebe nada.
--
--    `nurse_pool_members` não tem granularidade por hospital: desativar um
--    membro o tira do pool inteiro (e o Pool Geral cobre todos os hospitais).
--    Por isso o passo 3.2 LISTA antes de o 3.3 desativar — e o 3.5 desfaz.
-- ############################################################################

-- 3.1 O próprio enfermeiro do piloto: fora do pool (idempotente).
--     Desativar em vez de deletar preserva o histórico do vínculo.
update public.nurse_pool_members
   set is_active = false
 where profile_id = '<PROFILE_ID>'
   and is_active;

-- 3.2 OUTROS membros ativos de pool que cobre o hospital dos pacientes desta
--     equipe. **SALVE O RESULTADO** (os profile_id) antes de rodar o 3.3 — é a
--     lista que o 3.5 usa para reverter no fim do piloto.
select m.profile_id, pr.name, pr.email, pr.role, pool.name as pool, m.is_active
  from public.nurse_pool_members m
  join public.nurse_pools pool         on pool.id = m.pool_id and pool.is_active
  join public.nurse_pool_hospitals nph on nph.pool_id = pool.id
  join public.profiles pr              on pr.id = m.profile_id
 where m.is_active
   and m.profile_id <> '<PROFILE_ID>'
   and nph.hospital_id in (
     select distinct p.hospital_id
       from public.patients p
      where p.team_id = '<EQUIPE_DO_PILOTO>'
        and p.hospital_id is not null
   )
 order by pr.name;

-- 3.3 Desativa exatamente os listados em 3.2 (mesmo predicado — reversível).
--     Se 3.2 não retornou nada, este UPDATE afeta 0 linhas e pode ser rodado
--     sem medo.
update public.nurse_pool_members m
   set is_active = false
 where m.is_active
   and m.profile_id <> '<PROFILE_ID>'
   and exists (
     select 1
       from public.nurse_pools pool
       join public.nurse_pool_hospitals nph on nph.pool_id = pool.id
      where pool.id = m.pool_id
        and pool.is_active
        and nph.hospital_id in (
          select distinct p.hospital_id
            from public.patients p
           where p.team_id = '<EQUIPE_DO_PILOTO>'
             and p.hospital_id is not null
        )
   );

-- 3.4 Confirmação: deve retornar 0.
--     CONSEQUÊNCIA OPERACIONAL, registrada de propósito — com o pool vazio, o
--     marcador de atraso da fila amarela para de funcionar:
--     `reoffer_expired_alerts()` (0068, item c) só grava `sla_breached_at` se
--     existir alguém do pool DE PLANTÃO cobrindo o hospital. O selo "atrasado"
--     na fila não vai acender no piloto. A rede de segurança que importa
--     continua ativa: o item (d) da mesma função escala sozinho todo amarelo
--     com mais de `slaMaxHours` (8h) de vida, e NÃO consulta pool nenhum.
select count(*) as membros_ativos_no_pool_deve_ser_zero
  from public.nurse_pool_members m
  join public.nurse_pools pool on pool.id = m.pool_id and pool.is_active
  join public.profiles pr      on pr.id = m.profile_id and pr.status = 'ACTIVE'
 where m.is_active;

-- 3.5 REVERSÃO no fim do piloto (não rode agora). Use os profile_id salvos
--     no passo 3.2 — reativar em bloco reativaria também quem já estava
--     inativo antes do piloto.
-- update public.nurse_pool_members
--    set is_active = true
--  where profile_id in ('<ID_1>', '<ID_2>');


-- ############################################################################
-- 4) HIGIENE DE DADO — hospital_id nos pacientes do piloto.
--
--    Não é o que dá acesso ao enfermeiro (o acesso é por equipe), mas
--    `hospital_id` nulo é fail-closed em vários caminhos: `offer_yellow_alert()`
--    aborta, `is_nurse_for_patient()` é sempre falso, o preflight acusa buraco
--    de cobertura e o predicado de hospital do bloco 3.2 não enxerga o paciente.
-- ############################################################################

-- 4.1 Pacientes da equipe sem hospital.
select p.id, p.name, p.status, p.hospital_id
  from public.patients p
 where p.team_id = '<EQUIPE_DO_PILOTO>'
   and p.hospital_id is null;

-- 4.2 Catálogo de hospitais — confira o id, não chute.
select id, name, status from public.hospitals order by name;

-- 4.3 Preencha (descomente depois de escolher o hospital).
-- update public.patients
--    set hospital_id = '<HOSPITAL_ID>'
--  where team_id = '<EQUIPE_DO_PILOTO>' and hospital_id is null;

-- 4.4 Se acabou de preencher hospital_id agora, REVISITE o bloco 3.2/3.3:
--     o predicado de hospital depende deste campo e pode ter deixado passar
--     membros de pool que agora entram na conta.


-- ############################################################################
-- 5) VERIFICAÇÃO — como o BANCO vê o enfermeiro do piloto.
--
--    Simula o JWT dele para avaliar RLS e guardas sem fazer login. Rode o bloco
--    INTEIRO de uma vez: os `set local` só valem dentro da transação, e o
--    `rollback` no fim garante que nada é persistido.
-- ############################################################################

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<PROFILE_ID>', true);
  select set_config('request.jwt.claims',
                    json_build_object('sub', '<PROFILE_ID>', 'role', 'authenticated')::text,
                    true);

  -- 5.1 Identidade e escopo.
  --     esperado: e_enfermeiro=true, e_admin=false, membro_equipe=true
  select auth.uid()                                  as uid,
         public.is_nurse()                            as e_enfermeiro,
         public.is_admin()                            as e_admin,
         public.is_team_member('<EQUIPE_DO_PILOTO>')  as membro_equipe;

  -- 5.2 Alertas visíveis — TODOS devem ser da equipe do piloto.
  select a.id, a.status, a.attendance_status, t.team_number, p.name as paciente
    from public.clinical_alerts a
    join public.medical_teams t on t.id = a.team_id
    left join public.patients p on p.id = a.patient_id
   order by a.created_at desc;

  -- 5.3 TESTE NEGATIVO DE ESCOPO — leitura. Ambos devem ser 0.
  select (select count(*) from public.clinical_alerts a
           where a.team_id <> '<EQUIPE_DO_PILOTO>')  as alertas_de_fora_visiveis,
         (select count(*) from public.patients p
           where p.team_id <> '<EQUIPE_DO_PILOTO>')  as pacientes_de_fora_visiveis;

  -- 5.4 TESTE NEGATIVO DE ESCOPO — escrita. Ambos devem ser FALSE.
  --     Pegue os dois ids como `postgres`, fora deste bloco (a RLS esconde a
  --     linha aqui dentro):
  --       select id, team_id, hospital_id from public.patients
  --        where team_id <> '<EQUIPE_DO_PILOTO>' and status = 'ACTIVE' limit 1;
  select public.is_nurse_for_patient('<PACIENTE_DE_OUTRA_EQUIPE>') as pool_alcanca,
         public.can_act_on_alert('<EQUIPE_DE_FORA>',
                                 '<PACIENTE_DE_OUTRA_EQUIPE>')     as pode_agir;
rollback;


-- ############################################################################
-- 6) VERIFICAÇÃO DE AÇÃO (muda estado — faça no fim, ou desfaça com rollback).
--    O caminho real do piloto é pela INTERFACE, logado como o enfermeiro.
--    Em SQL, repita o preâmbulo do bloco 5 e chame:
--
--      -- amarelo da equipe: assumir e finalizar (esperado: sucesso)
--      select public.alert_set_in_analysis('<ALERTA_YELLOW_DA_EQUIPE>');
--      select public.alert_mark_attended('<ALERTA_YELLOW_DA_EQUIPE>', null,
--                                        'Contato feito, orientada hidratação.');
--
--      -- vermelho da equipe: BLOQUEADO ao finalizar (nurse_may_finalize, 0067)
--      select public.alert_set_in_analysis('<ALERTA_RED_DA_EQUIPE>');
--      select public.alert_mark_attended('<ALERTA_RED_DA_EQUIPE>', null, 'teste');
--      --> ERRO: 'Alertas vermelhos são atendidos pelo médico da equipe...'
--
--      -- alerta de OUTRA equipe: BLOQUEADO
--      select public.alert_set_in_analysis('<ALERTA_DE_OUTRA_EQUIPE>');
--      --> ERRO: 'Sem permissão para este alerta.'
--          (ou 'Alerta não encontrado.' — a RLS pode esconder a linha antes)
-- ############################################################################


-- ############################################################################
-- 7) MEDIÇÃO ESQUECIDA — teste do fallback de equipe.
--
--    Rode como `postgres` (SQL Editor). NÃO funciona dentro do bloco 5: a 0073
--    revogou EXECUTE de `anon`/`authenticated` nesta função (é de cron).
-- ############################################################################

-- 7.1 Elegibilidade do paciente (gates da 0073): ACTIVE, alta preenchida,
--     current_date entre a alta e alta+10, sem registro do período hoje e sem
--     linha de missed já gravada hoje.
select p.id, p.name, p.status, p.hospital_id, p.hospital_discharge_date,
       (current_date >= p.hospital_discharge_date
        and p.hospital_discharge_date + 10 >= current_date)               as na_janela,
       exists (select 1 from public.vital_sign_records v
                where v.patient_id = p.id and v.record_date = current_date
                  and v.period = 'MORNING')                              as ja_registrou,
       exists (select 1 from public.missed_measurement_logs ml
                where ml.patient_id = p.id and ml.period = 'MORNING'
                  and ml.missed_date = current_date)                      as ja_avisado
  from public.patients p
 where p.team_id = '<EQUIPE_DO_PILOTO>' and p.status = 'ACTIVE';

-- 7.2 Se `ja_avisado` = true, a função pula o paciente inteiro. Para repetir o
--     teste hoje, limpe as linhas do dia DESTE paciente:
-- delete from public.missed_measurement_logs
--  where patient_id = '<PACIENTE_DO_PILOTO>' and missed_date = current_date;

-- 7.3 Dispara. Retorna o nº de linhas gravadas (> 0 se havia elegível).
--
--     ATENÇÃO — a função é GLOBAL: enfileira avisos para TODOS os pacientes
--     elegíveis do banco, não só os do piloto. Chamada fora da hora do cron,
--     ela antecipa avisos reais de outras equipes (o gate de deduplicação
--     impede a repetição, mas não desfaz o envio antecipado). Faça este teste
--     com o modo homologação LIGADO, ou em ambiente local, ou aceitando que os
--     avisos do dia sairão agora.
select public.enqueue_missed_measurement_alerts('MORNING');

-- 7.4 Resultado esperado: uma linha PARA O ENFERMEIRO (via fallback de equipe),
--     `recipient_is_nurse = false` (o passo 3 grava false fixo — selo cosmético,
--     aceito), status PENDING (ou SKIPPED_TEST_MODE em modo homologação).
--     Haverá também uma linha para o cirurgião responsável: o fallback de
--     equipe avisa main_surgeon + todos os team_members ativos.
--     NÃO deve haver linha NO_RECIPIENT.
select m.missed_date, m.period, m.recipient_name, m.recipient_is_nurse,
       m.recipient_phone, m.status, m.environment, m.error_message
  from public.missed_measurement_logs m
  join public.patients p on p.id = m.patient_id
 where p.team_id = '<EQUIPE_DO_PILOTO>'
   and m.missed_date = current_date
 order by m.created_at desc;


-- ############################################################################
-- 8) EVIDÊNCIAS APÓS UM ALERTA REAL (como `postgres`).
-- ############################################################################

-- 8.1 O enfermeiro foi notificado (`notify_team_of_alert`, 0018).
--     PENDING     = enfileirado, aguardando a Edge Function send-whatsapp-alert
--     logged      = modo simulado (sem credenciais Meta configuradas)
--     SENT        = entregue pela Meta Cloud API
--     SKIPPED_TEST_MODE = modo homologação e o número dele não está na
--                         whitelist (docs/HOMOLOGACAO.md)
select n.created_at, n.recipient_name, n.recipient_phone, n.status,
       n.environment, n.error_message
  from public.notification_logs n
 where n.recipient_profile_id = '<PROFILE_ID>'
 order by n.created_at desc
 limit 10;

-- 8.2 Timeline das ações dele (IN_ANALYSIS / ATTENDED / CONTACT / ESCALATED).
select c.created_at, c.status, c.observation, c.alert_id
  from public.attendance_confirmations c
 where c.attended_by = '<PROFILE_ID>'
 order by c.created_at desc
 limit 20;

-- 8.3 Trilha LGPD (0067) — gravada por cada RPC de triagem.
select l.created_at, l.context, p.name as paciente
  from public.patient_access_logs l
  join public.patients p on p.id = l.patient_id
 where l.profile_id = '<PROFILE_ID>'
 order by l.created_at desc
 limit 20;

-- 8.4 Auditoria.
select a.created_at, a.action, a.entity
  from public.audit_logs a
 where a.actor_name = (select name from public.profiles where id = '<PROFILE_ID>')
 order by a.created_at desc
 limit 20;


-- ############################################################################
-- 9) PENDÊNCIAS CONHECIDAS (fora do escopo desta configuração).
--
--   • `alert_register_contact` (0067) existe no banco e em
--     `alertService.registerContact`, mas NÃO está ligada a nenhuma tela. Em um
--     alerta VERMELHO o enfermeiro não consegue documentar o contato ativo pela
--     interface — só escalar (`EscalateModal`, em NurseTriage.tsx). Durante o
--     piloto, contato em vermelho fica sem registro na timeline, a menos que
--     seja gravado por SQL.
--
--   • `role_in_team = 'ASSOCIATED_DOCTOR'` para um enfermeiro é dívida técnica
--     aceita (ver bloco 2). Consequência visível: telas que rotulam o membro
--     pelo `role_in_team` mostram "Médico Associado" para ele. O papel correto
--     aparece em `profiles.role` e no perfil do usuário.
--
--   • `recipient_is_nurse = false` na medição esquecida do piloto (ver 7.4).
--     Cosmético; não altera o roteamento nem o envio.
--
--   • Pool vazio desliga o marcador `sla_breached_at` (ver 3.4). O escalonamento
--     automático de 8h continua funcionando.
--
--   • Fim do piloto: reverter o bloco 3.5, e devolver `profiles.role` do
--     profissional se a conta for reaproveitada.
-- ############################################################################
