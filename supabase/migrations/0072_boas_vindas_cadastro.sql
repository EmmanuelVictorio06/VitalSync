-- ============================================================================
-- Migration: 0072_boas_vindas_cadastro
--
-- Mensagem de BOAS-VINDAS por WhatsApp no momento do cadastro do paciente.
-- É a primeira mensagem que ele recebe: explica o acompanhamento, os dois
-- horários de medição e entrega o link do primeiro acesso (secure_token).
--
-- Por que uma tabela NOVA (welcome_logs) em vez de reutilizar reminder_logs:
-- reminder_logs é modelada em torno de (patient_id, period, reminder_date) —
-- "1 lembrete por paciente/período/dia". Boas-vindas é "1 por paciente, para
-- sempre", uma unicidade diferente (UNIQUE (patient_id)). O restante do
-- desenho (environment/is_test, gate de homologação, status PENDING →
-- SENT/FAILED/logged/SKIPPED_TEST_MODE) espelha reminder_logs (0038) de
-- propósito, para reaproveitar o mesmo modo de homologação (0018) e o mesmo
-- formato que as Edge Functions de envio já sabem ler.
--
-- DISPARO: trigger AFTER INSERT em public.patients (mesmo padrão da 0034 para
-- clinical_alerts). Assim a Edge Function create-patient NÃO precisa mudar —
-- qualquer caminho de cadastro (Edge Function, SQL Editor, seed) dispara as
-- boas-vindas do mesmo jeito.
--
-- BEST-EFFORT, por decisão de desenho: uma falha de WhatsApp NUNCA pode
-- impedir o cadastro do paciente. O corpo do trigger fica dentro de um bloco
-- `exception when others` que só emite `raise warning` — o INSERT do paciente
-- segue normalmente e a resposta da create-patient não muda.
--
-- PRÉ-REQUISITOS para o envio real (mesmo padrão da 0034/0038):
--   1) Secrets do Vault 'project_url' e 'service_role_key'.
--   2) Edge Function deployada e template aprovado na Meta:
--        supabase functions deploy send-welcome-message
--        supabase secrets set WHATSAPP_WELCOME_TEMPLATE_NAME=boas_vindas_vitalsync
--   Sem (1), a linha fica PENDING e o disparo só avisa — nada se perde: a
--   Edge Function varre TODOS os PENDING quando invocada sem patient_id.
--
-- Não usa pg_cron: o gatilho é o cadastro, não o relógio.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0071.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela de log/idempotência das boas-vindas.
--    UNIQUE (patient_id) = "1 boas-vindas por paciente". Reprocessar o mesmo
--    paciente (reenvio manual, retry do trigger, re-execução do seed) não
--    duplica a mensagem.
-- ----------------------------------------------------------------------------
create table if not exists public.welcome_logs (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(id) on delete cascade,
  recipient_phone      text,
  recipient_name       text,
  channel              text not null default 'whatsapp',
  status               text not null default 'PENDING',
  template_name        text,
  environment          text not null default 'production',
  is_test              boolean not null default false,
  provider_message_id  text,
  error_message        text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  unique (patient_id)
);

create index if not exists idx_welcome_logs_status on public.welcome_logs(status);

comment on table public.welcome_logs is
  'Mensagem de boas-vindas enviada ao paciente no cadastro. UNIQUE (patient_id): uma por paciente, para sempre.';

alter table public.welcome_logs enable row level security;

-- Mesmo padrão de reminder_logs/notification_logs: ADMIN lê tudo pelo app; a
-- criação/atualização das linhas passa por função SECURITY DEFINER ou pela
-- Edge Function (service_role), que ignora RLS.
drop policy if exists welcome_logs_admin_read on public.welcome_logs;
create policy welcome_logs_admin_read on public.welcome_logs for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2) enqueue_welcome_message — cria o log PENDING (ou SKIPPED_TEST_MODE, sob o
--    gate de homologação) para UM paciente. Idempotente via UNIQUE +
--    ON CONFLICT DO NOTHING.
--
--    Só enfileira paciente ATIVO, não excluído e COM telefone — sem telefone
--    não há para onde enviar, e uma linha PENDING eterna só sujaria o painel.
--
--    Retorna quantas linhas realmente nasceram (0 quando já existia), para o
--    dispatch abaixo não fazer POST à toa em reprocessamento.
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_welcome_message(p_patient_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mode       boolean;
  v_recipients text[];
  v_env        text;
  v_status     text;
  v_error      text;
  v_count      int := 0;
  p            record;
begin
  select pt.id, pt.name, pt.phone, pt.is_test
    into p
    from public.patients pt
   where pt.id = p_patient_id
     and pt.status = 'ACTIVE'
     and pt.deleted_at is null
     and pt.phone is not null;

  if not found then
    return 0;
  end if;

  select homologation_mode, test_recipients into v_mode, v_recipients
    from public.homologation_settings where id;
  v_mode       := coalesce(v_mode, false);
  v_recipients := coalesce(v_recipients, '{}');
  v_env        := case when v_mode then 'homologation' else 'production' end;

  -- Em homologação: só enfileira de verdade para números na whitelist.
  if v_mode and not exists (
    select 1 from unnest(v_recipients) x
    where public.normalize_phone(x) = public.normalize_phone(p.phone)
  ) then
    v_status := 'SKIPPED_TEST_MODE';
    v_error  := 'Envio bloqueado pelo modo homologação: destinatário não está na lista de teste.';
  else
    v_status := 'PENDING';
    v_error  := null;
  end if;

  insert into public.welcome_logs
    (patient_id, recipient_phone, recipient_name,
     channel, status, template_name, environment, is_test, error_message, sent_at)
  values
    (p.id, p.phone, p.name,
     'whatsapp', v_status, 'boas_vindas_vitalsync', v_env,
     coalesce(p.is_test, false), v_error,
     case when v_status = 'PENDING' then null else now() end)
  on conflict (patient_id) do nothing;

  -- ON CONFLICT DO NOTHING não conta a linha ignorada: row_count = 0 quando o
  -- paciente já tinha boas-vindas.
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) dispatch_welcome_message — enfileira e, se nasceu linha nova e os secrets
--    do Vault estiverem configurados, chama a Edge Function
--    send-welcome-message via pg_net (mesmo padrão da 0034/0038).
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_welcome_message(p_patient_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url      text;
  v_key      text;
  v_enqueued int;
begin
  v_enqueued := public.enqueue_welcome_message(p_patient_id);
  if v_enqueued = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'send-welcome-message não disparado: configure os secrets project_url/service_role_key no Vault.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-welcome-message',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := jsonb_build_object('patient_id', p_patient_id)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Trigger AFTER INSERT em patients — o cadastro é o gatilho.
--
--    AFTER INSERT (não BEFORE) para que o paciente já exista com o
--    secure_token gerado quando a Edge Function for lê-lo.
--
--    O bloco `exception when others` é o que torna o envio BEST-EFFORT: erro
--    de pg_net, Vault ausente ou qualquer falha do caminho de notificação vira
--    warning, e o INSERT do paciente segue. Sem ele, uma indisponibilidade do
--    WhatsApp impediria o cadastro — inaceitável.
--
--    Corolário benigno da assincronia do pg_net: o POST pode chegar à Edge
--    Function antes do COMMIT desta transação. Por isso a função varre TODOS
--    os welcome_logs PENDING quando o patient_id ainda não está visível — o
--    cadastro seguinte (ou uma invocação manual) recolhe o retardatário.
-- ----------------------------------------------------------------------------
create or replace function public.trg_dispatch_welcome_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.phone is not null then
    begin
      perform public.dispatch_welcome_message(new.id);
    exception when others then
      raise warning 'Boas-vindas não enviadas ao paciente % (cadastro NÃO afetado): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_patient_welcome_message on public.patients;
create trigger trg_patient_welcome_message
  after insert on public.patients
  for each row
  execute function public.trg_dispatch_welcome_message();

-- ----------------------------------------------------------------------------
-- 5) Privilégios — funções de sistema, ninguém do app as chama diretamente.
--    Toda função nova nasce executável por anon E authenticated por GRANT
--    DIRETO do Supabase (ALTER DEFAULT PRIVILEGES), então revogar de `public`
--    NÃO basta: é preciso revogar dos dois papéis explicitamente.
--    O trigger continua funcionando: ele roda SECURITY DEFINER (dono) e chama
--    dispatch_welcome_message já como dono.
-- ----------------------------------------------------------------------------
revoke execute on function public.enqueue_welcome_message(uuid)  from public, anon, authenticated;
revoke execute on function public.dispatch_welcome_message(uuid) from public, anon, authenticated;
revoke execute on function public.trg_dispatch_welcome_message() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1) Cadastro cria UMA linha PENDING (paciente de teste na whitelist):
--   insert into public.patients (name, phone, team_id, hospital_discharge_date, is_test)
--   values ('Paciente Boas-Vindas', '+5541999998888',
--           (select id from public.medical_teams limit 1), current_date, true);
--   select status, recipient_name, template_name, environment, is_test
--     from public.welcome_logs order by created_at desc limit 1;
--   --> PENDING / boas_vindas_vitalsync
--
--   -- 2) Idempotência: reenfileirar o MESMO paciente não duplica.
--   select public.enqueue_welcome_message('<patient_id>');   --> 0
--   select count(*) from public.welcome_logs where patient_id = '<patient_id>';  --> 1
--
--   -- 3) Paciente SEM telefone não gera linha nenhuma:
--   insert into public.patients (name, team_id, is_test)
--   values ('Sem Telefone', (select id from public.medical_teams limit 1), true);
--   select count(*) from public.welcome_logs w
--     join public.patients p on p.id = w.patient_id where p.name = 'Sem Telefone';  --> 0
--
--   -- 4) Homologação ligada + número FORA da whitelist → SKIPPED_TEST_MODE:
--   update public.homologation_settings set homologation_mode = true,
--          test_recipients = array['+5541999998888'];
--   -- (cadastre um paciente com outro telefone e confira)
--   select status, error_message from public.welcome_logs order by created_at desc limit 1;
--
--   -- 5) Modo simulado (sem WHATSAPP_API_TOKEN/PHONE_NUMBER_ID): depois de
--   --    invocar a Edge Function, o status vira 'logged' — nunca 'SENT'.
--   --    supabase functions invoke send-welcome-message --body '{}'
--   select status, sent_at from public.welcome_logs order by created_at desc limit 1;
--
--   -- 6) Privilégios: anon e authenticated NÃO podem chamar as funções.
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('enqueue_welcome_message', 'dispatch_welcome_message');
--   --> f / f nas duas linhas
-- ----------------------------------------------------------------------------
