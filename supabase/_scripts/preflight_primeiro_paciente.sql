-- ============================================================================
-- PRÉ-VOO — antes do PRIMEIRO PACIENTE REAL
--
-- SOMENTE LEITURA. Nenhum INSERT/UPDATE/DELETE/DDL. Pode rodar em produção.
--
-- Como usar: cole inteiro no SQL Editor do Supabase e rode. Cada linha traz um
-- veredicto. Só libere o primeiro paciente com TODAS as linhas em OK — cada
-- ATENÇÃO é um modo de falha silencioso esperando acontecer.
--
-- A CHECAGEM Nº 1 É A MAIS IMPORTANTE: com o modo homologação LIGADO, todo
-- destinatário fora da whitelist vira SKIPPED_TEST_MODE. Um paciente real
-- cadastrado nesse estado gera alertas que NÃO chegam a ninguém — e nada no
-- sistema reclama.
-- ============================================================================

with checagens as (

  -- 1) MODO HOMOLOGAÇÃO ---------------------------------------------------
  select
    1 as ordem,
    'Modo homologação' as checagem,
    case when coalesce((select homologation_mode from public.homologation_settings where id), false)
         then 'ATENÇÃO' else 'OK' end as veredicto,
    case when coalesce((select homologation_mode from public.homologation_settings where id), false)
         then 'LIGADO — alertas de paciente real virariam SKIPPED_TEST_MODE e NINGUÉM seria avisado. Desligue antes de cadastrar.'
         else 'Desligado (produção). Notificações seguem para os destinatários reais.' end as detalhe

  -- 2) DADOS DE TESTE RESIDUAIS -------------------------------------------
  union all
  select 2, 'Pacientes de teste',
    case when (select count(*) from public.patients where is_test and deleted_at is null) > 0
         then 'ATENÇÃO' else 'OK' end,
    (select count(*) from public.patients where is_test and deleted_at is null)::text
      || ' paciente(s) is_test ativo(s). Limpe em Configurações → Homologação antes de abrir o piloto.'

  -- 3) JOBS DE pg_cron -----------------------------------------------------
  union all
  select 3, 'Extensão pg_cron',
    case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'OK' else 'ATENÇÃO' end,
    case when exists (select 1 from pg_extension where extname = 'pg_cron')
         then 'Habilitada.'
         else 'AUSENTE — nenhuma rede de segurança automática roda (lembretes, TTL de lock, SLA, retry de notificação).' end

  union all
  select 4, 'Jobs agendados',
    case when (
      select count(*) from cron.job
       where active and jobname in (
         'release-stale-alert-locks', 'check-unanswered-escalations',
         'nurse-queue-sweep', 'nurse-review-sampling',
         'missed-measurement-alert-morning', 'missed-measurement-alert-night',
         'measurement-reminder-morning', 'measurement-reminder-night',
         'retry-failed-notifications', 'alarm-exhausted-notifications'
       )) = 10 then 'OK' else 'ATENÇÃO' end,
    'Ativos: ' || (
      select coalesce(string_agg(jobname, ', ' order by jobname), '(nenhum)') from cron.job
       where active and jobname in (
         'release-stale-alert-locks', 'check-unanswered-escalations',
         'nurse-queue-sweep', 'nurse-review-sampling',
         'missed-measurement-alert-morning', 'missed-measurement-alert-night',
         'measurement-reminder-morning', 'measurement-reminder-night',
         'retry-failed-notifications', 'alarm-exhausted-notifications'
       )) || ' · esperados: 10'

  -- 4) POOL DE ENFERMAGEM --------------------------------------------------
  union all
  select 5, 'Pool de enfermagem — hospitais',
    case when exists (
      select 1 from public.nurse_pools p
      join public.nurse_pool_hospitals h on h.pool_id = p.id
      where p.is_active) then 'OK' else 'ATENÇÃO' end,
    'Pools ativos com hospital vinculado: ' || (
      select count(distinct p.id) from public.nurse_pools p
      join public.nurse_pool_hospitals h on h.pool_id = p.id where p.is_active)::text
      || '. Sem vínculo, is_nurse_for_patient() é sempre falso e a fila de triagem fica vazia.'

  union all
  select 6, 'Pool de enfermagem — membros',
    case when exists (
      select 1 from public.nurse_pool_members m
      join public.nurse_pools p on p.id = m.pool_id and p.is_active
      join public.profiles prof on prof.id = m.profile_id and prof.status = 'ACTIVE'
      where m.is_active) then 'OK' else 'ATENÇÃO' end,
    'Enfermeiros ativos em pool ativo: ' || (
      select count(*) from public.nurse_pool_members m
      join public.nurse_pools p on p.id = m.pool_id and p.is_active
      join public.profiles prof on prof.id = m.profile_id and prof.status = 'ACTIVE'
      where m.is_active)::text

  -- 5) HOSPITAIS SEM COBERTURA (buraco silencioso) -------------------------
  union all
  select 7, 'Hospitais sem pool',
    case when exists (
      select 1 from public.hospitals h
       where h.status = 'ACTIVE'
         and not exists (select 1 from public.nurse_pool_hospitals nph where nph.hospital_id = h.id)
    ) then 'ATENÇÃO' else 'OK' end,
    coalesce((select string_agg(h.name, ', ') from public.hospitals h
       where h.status = 'ACTIVE'
         and not exists (select 1 from public.nurse_pool_hospitals nph where nph.hospital_id = h.id)),
      'Todos os hospitais ativos estão cobertos por algum pool.')

  -- 6) EQUIPES ------------------------------------------------------------
  union all
  select 8, 'Equipes sem cirurgião principal',
    case when exists (select 1 from public.medical_teams where status = 'ACTIVE' and main_surgeon_id is null)
         then 'ATENÇÃO' else 'OK' end,
    (select count(*) from public.medical_teams where status = 'ACTIVE' and main_surgeon_id is null)::text
      || ' equipe(s) ativa(s) sem responsável — escalonamento e fallback não teriam destinatário.'

  union all
  select 9, 'Equipes sem membro ativo',
    case when exists (
      select 1 from public.medical_teams t
       where t.status = 'ACTIVE'
         and not exists (select 1 from public.team_members m where m.team_id = t.id and m.status = 'ACTIVE')
    ) then 'ATENÇÃO' else 'OK' end,
    (select count(*) from public.medical_teams t
      where t.status = 'ACTIVE'
        and not exists (select 1 from public.team_members m where m.team_id = t.id and m.status = 'ACTIVE'))::text
      || ' equipe(s) ativa(s) só com o cirurgião principal.'

  -- 7) NOTIFICAÇÕES FALHADAS ----------------------------------------------
  union all
  select 10, 'Notificações com falha',
    -- QUALQUER falha conta como ATENÇÃO. Já ter sido "alarmada"
    -- (escalated_failure_at preenchido) não resolve nada: significa que o
    -- retry esgotou e alguém REALMENTE não foi avisado.
    case when (select count(*) from public.notification_logs
                where status in ('FAILED','failed')) > 0
         then 'ATENÇÃO' else 'OK' end,
    (select count(*) from public.notification_logs where status in ('FAILED','failed'))::text
      || ' falha(s) no total · '
      || (select count(*) from public.notification_logs
           where status in ('FAILED','failed') and escalated_failure_at is not null)::text
      || ' já esgotaram o retry (só reenvio manual resolve).'

  -- 8) SECRETS DO VAULT ----------------------------------------------------
  union all
  select 11, 'Secrets do Vault',
    case when (select count(*) from vault.decrypted_secrets
                where name in ('project_url','service_role_key')) = 2
         then 'OK' else 'ATENÇÃO' end,
    'Encontrados: ' || coalesce((select string_agg(name, ', ') from vault.decrypted_secrets
       where name in ('project_url','service_role_key')), '(nenhum)')
      || '. Sem os dois, nenhum job consegue chamar Edge Function — as automações ficam mudas.'

  -- 9) PENDÊNCIA CLÍNICA (informativo) -------------------------------------
  union all
  select 12, 'Divergência clínica conhecida', 'ATENÇÃO',
    'Pressão sistólica: protocolo do estudo usa vermelho > 160; o código usa >= 140 (migration 0048). '
    'Decisão do cirurgião responsável — muda o volume de alertas do primeiro paciente. Ver docs/PONTOS_PENDENTES.md.'
)
select
  case veredicto when 'OK' then '[ OK ]' else '[ !! ]' end as status,
  checagem,
  detalhe
from checagens
order by
  case veredicto when 'OK' then 2 else 1 end,   -- problemas primeiro
  ordem;
