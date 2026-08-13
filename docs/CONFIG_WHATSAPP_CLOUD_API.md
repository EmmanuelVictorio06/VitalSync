# Configuração do WhatsApp Cloud API (modo teste, sem verificação de empresa)

Guia para ligar o envio automático de alertas via **Meta WhatsApp Cloud API**
usando o modo de desenvolvimento/teste — que **não exige verificação de negócio
(CNPJ)** e permite enviar para **até 5 números** cadastrados. Isso encaixa
exatamente no gate de homologação do VitalSync (`homologation_settings.test_recipients`).

Pré-requisitos que você já tem: conta no WhatsApp Manager, número configurado e o
template **`alerta_clinico_vitalsync`** (`pt_BR`) aprovado.

---

## Visão geral

Em modo de teste, mensagens **iniciadas pela empresa** (o nosso alerta) exigem um
**template aprovado** — que já temos. A Cloud API só entrega para destinatários
que você **cadastrar e verificar** (limite de 5). Portanto, os médicos de teste
precisam estar em DOIS lugares:

1. Lista de destinatários do app Meta (até 5).
2. Whitelist de homologação do VitalSync (`test_recipients`).

---

## Passo 1 — App no Meta for Developers com o produto WhatsApp

1. Acesse <https://developers.facebook.com/apps> e abra (ou crie) o app ligado ao
   seu Business/WhatsApp Manager.
2. Adicione o produto **WhatsApp** ao app (se ainda não estiver).
3. Vá em **WhatsApp → Configuração da API** (API Setup).

## Passo 2 — Anotar os IDs

Nessa tela, copie:

- **Identificação do número de telefone** (*Phone number ID*) → vira
  `WHATSAPP_PHONE_NUMBER_ID`.
- **Identificação da conta do WhatsApp Business** (*WhatsApp Business Account ID / WABA*)
  → útil para gerenciar templates.

> Use o **seu** número já configurado como "From". O número de teste gratuito da
> Meta também funciona, mas como você já tem número e template, prefira o seu.

## Passo 3 — Cadastrar os destinatários de teste (até 5)

Ainda em **API Setup**, no campo **"Para" (To)**, adicione os números dos médicos
que vão receber os alertas de teste. Cada número recebe um código de verificação
no WhatsApp e precisa ser confirmado. Sem isso, a Meta bloqueia o envio (erro
`#131030` / "recipient not in allowed list").

## Passo 4 — Gerar um token PERMANENTE (System User)

O token que aparece na tela ("Gerar token de acesso") é **temporário (~24h)** —
serve só para um teste rápido. Para produção/homologação contínua, crie um token
permanente:

1. **Business Settings → Usuários → Usuários do sistema** (System Users).
2. Crie um System User com papel **Admin** (ou Employee com acesso ao ativo).
3. **Adicionar ativos** → selecione seu app/WABA e dê permissão total.
4. **Gerar novo token** → selecione o app → marque as permissões
   `whatsapp_business_messaging` e `whatsapp_business_management`.
5. Copie o token (ele **não** aparece de novo) → vira `WHATSAPP_API_TOKEN`.

## Passo 5 — Setar os secrets no Supabase

O token e o phone number ID **nunca** vão para o frontend. Ficam como secrets da
Edge Function:

```bash
supabase secrets set \
  WHATSAPP_API_TOKEN=<token_permanente_do_system_user> \
  WHATSAPP_PHONE_NUMBER_ID=<phone_number_id>
# opcionais (já têm default no código):
#   WHATSAPP_TEMPLATE_NAME=alerta_clinico_vitalsync
#   WHATSAPP_TEMPLATE_LANG=pt_BR
```

Confirme no WhatsApp Manager que o idioma do template é **`pt_BR`** ("Portuguese (BR)");
o código usa esse code exato.

## Passo 6 — Deploy da função e do disparo automático

```bash
supabase functions deploy send-whatsapp-alert
supabase db push        # aplica a migration 0034 (trigger de disparo automático)
```

E os segredos do Vault (uma vez, no SQL Editor), para o trigger conseguir chamar
a função:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>',                 'service_role_key');
```

## Passo 7 — Ativar homologação e a whitelist

Como a Meta só entrega para os 5 números cadastrados, mantenha o **modo
homologação ligado** e coloque os MESMOS números dos médicos de teste em
`test_recipients`. Assim o `notify_team_of_alert` só marca esses como `PENDING`
(os demais viram `SKIPPED_TEST_MODE`), evitando erro da Meta com números não
cadastrados.

```sql
-- Ligar homologação e definir a whitelist (formato E.164, ex.: +5541999998888)
update public.homologation_settings
   set homologation_mode = true,
       test_recipients   = array['+5541999998888', '+5541988887777'];
```

## Passo 8 — Testar de ponta a ponta

1. Garanta que o(s) médico(s) de teste estejam: (a) cadastrados no Meta (Passo 3)
   e (b) na whitelist (Passo 7), e que tenham `whatsapp` preenchido no `profiles`.
2. Envie uma medição de teste (paciente com `is_test = true`) que gere status
   YELLOW/RED — ex.: temperatura ≥ 37,8.
3. Verifique:
   - `notification_logs`: linha `PENDING` → depois `SENT` (com `provider_message_id`).
   - Logs da Edge Function `send-whatsapp-alert` (painel Supabase → Functions).
   - A mensagem chegando no WhatsApp do médico: *"Olá, {nome}. Um paciente da sua
     equipe apresentou alteração no acompanhamento pós-operatório..."*

Se o log ficar `logged` em vez de `SENT`, os secrets da Meta não foram lidos
(revise o Passo 5). Se der `FAILED` com "recipient not in allowed list", o número
não foi cadastrado no Passo 3.

---

## Limites do modo teste

- Máximo de **5 destinatários** cadastrados. Para liberar qualquer número e
  aumentar limites, aí sim é preciso **verificação de negócio** na Meta.
- Mensagens iniciadas pela empresa **sempre** exigem template aprovado (o nosso já
  está). Texto livre só dentro da janela de 24h após o usuário responder — não é o
  nosso caso.
- O template não deve transportar dado clínico sensível — só o nome do médico (`{{1}}`).

---

## Lembrete de medição (horário-limite da janela)

Segunda automação, independente do alerta clínico: avisa o PACIENTE (não o
médico) quando o horário-limite da janela de medição está próximo (09:30 e
19:30 America/Sao_Paulo, 30 min antes do fim de cada janela) e ele ainda não
enviou o registro daquele período. Implementada na migration
`0038_lembrete_medicao.sql` (tabela `reminder_logs`, função
`enqueue_measurement_reminders`, agendamento via `pg_cron`) + Edge Function
`send-measurement-reminder`.

### Template novo a submeter na Meta

- **Nome**: `lembrete_medicao_vitalsync` (minúsculas + underscore — precisa bater
  com `WHATSAPP_REMINDER_TEMPLATE_NAME`, cujo default no código já é esse nome).
- **Idioma**: `pt_BR`.
- **Categoria: Utilidade (Utility)** — é lembrete transacional, não Marketing.
- **Corpo** (`{{1}}` = nome do paciente, sem dado clínico):
  > "Olá {{1}}! Está chegando o horário-limite para registrar seus sinais
  > vitais no VitalSync. Toque no botão abaixo para registrar antes que a
  > janela feche. 🙏
  > Lembrete: os horários são das 8h às 10h (manhã) e das 18h às 20h (noite)."
- **Botão "Visitar site" (URL dinâmica)**, texto **"Registrar agora"**. Na URL
  do botão, a **base termina em `/registro-sinais/`** (SEM `{{1}}`): a Meta anexa
  a variável dinâmica automaticamente **no final** da URL.
    - URL do site (base): `https://vital-sync-frontend-iota.vercel.app/registro-sinais/`
    - Variável `{{1}}` (anexada pela Meta) = o **`secure_token`** do paciente.
    - URL de amostra: `https://vital-sync-frontend-iota.vercel.app/registro-sinais/<token-exemplo>`
  ⚠️ **Não** digite `{{1}}` dentro da base (ex.: `.../registro-sinais/{{1}}`):
  isso deixa o `{{1}}` literal no meio e a Meta ainda anexa o token no fim,
  gerando `.../registro-sinais/{{1}}<token>` — link quebrado (404). A Edge
  Function envia só o token como parâmetro do botão, não o path inteiro; o
  `/r/:token` é apenas um alias. Diferente do botão "Ver no VitalSync" do alerta
  clínico, que usa `patients/${patientId}` porque aquele link é da equipe.
- Se migrar para domínio próprio (`https://vitalsync.com.br`), o template
  precisa ser **editado na Meta** (a URL base do botão é fixa na aprovação, só
  o `{{1}}` é dinâmico) e `VITE_PUBLIC_APP_URL` em produção precisa continuar
  igual à base do template — hoje `https://vital-sync-frontend-iota.vercel.app`.

### Deploy e agendamento

```bash
supabase functions deploy send-measurement-reminder
supabase db push        # aplica a migration 0038 (tabela + funções + cron)
# opcional (já tem default no código):
#   supabase secrets set WHATSAPP_REMINDER_TEMPLATE_NAME=lembrete_medicao_vitalsync
```

Reaproveita os MESMOS secrets `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
e os MESMOS segredos do Vault (`project_url`, `service_role_key`) já
configurados para o alerta clínico (Passo 5/6 acima). Se `pg_cron` não puder
ser habilitado direto pelo `db push` (erro de permissão), habilite pelo
Dashboard → Database → Extensions e rode `supabase db push` de novo — a
migration recria os dois jobs (`measurement-reminder-morning` /
`measurement-reminder-night`) de forma idempotente.

### Como testar sem enviar de verdade

- **Modo simulado**: sem `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`
  configurados, a Edge Function marca os `reminder_logs` como `logged` em vez
  de `SENT` — dá pra validar toda a lógica de elegibilidade sem gastar
  mensagens da Meta.
- **Disparo manual** (sem esperar o cron): no SQL Editor,
  `select public.enqueue_measurement_reminders('MORNING');` e depois invoque a
  função (`supabase functions invoke send-measurement-reminder --body '{"period":"MORNING"}'`).
- **Idempotência**: rodar `enqueue_measurement_reminders` duas vezes no mesmo
  dia/período não duplica linhas (constraint `UNIQUE (patient_id, period, reminder_date)`
  junto com `ON CONFLICT DO NOTHING`) — confirme contando `reminder_logs` antes/depois.
- **Gate dos 10 dias**: crie um paciente de teste (`is_test = true`) com
  `hospital_discharge_date` = hoje − 11 dias e confirme que ele NÃO entra na
  lista (paciente com alta há 9 dias entra; há 11 dias, não).
- **Gate de medição já enviada**: envie um `submit_vital_record` de teste para
  o período antes de rodar o enqueue — o paciente não deve receber lembrete
  daquele período no mesmo dia.
- Assim como o alerta clínico, mantenha o **modo homologação** ligado durante
  os testes (Passo 7) — só os números da whitelist ficam `PENDING`; os demais
  viram `SKIPPED_TEST_MODE` em `reminder_logs`.

---

## Alerta de esquecimento à equipe (+ lançamento pela enfermagem)

Terceira automação: quando o paciente NÃO registrou um período mesmo depois do
horário-limite (janela fechada — 10:00/20:00 America/Sao_Paulo), avisa a
EQUIPE (priorizando o Profissional de Enfermagem; sem enfermeiro na equipe,
cai para os demais membros ativos), 15 minutos após o fechamento da janela.
Aditivo ao lembrete ao paciente acima — não o substitui. Implementado nas
migrations `0059_vital_sign_records_source.sql` (colunas `source`/
`entered_by_profile_id` em `vital_sign_records`), `0060_missed_measurement_logs.sql`
(tabela `missed_measurement_logs`) e `0061_missed_measurement_alerts.sql`
(`enqueue_missed_measurement_alerts`/`dispatch_missed_measurement_alerts` +
`pg_cron`) + Edge Function `send-missed-measurement-alert`. A RPC
`staff_insert_vital_record` (`0062_staff_insert_vital_record.sql`) permite que
Enfermagem/Cirurgião/Associado lancem, em nome do paciente, só o período de
HOJE já fechado — resolve automaticamente o alerta de esquecimento ao gravar.

### Template novo a submeter na Meta

- **Nome**: `alerta_medicao_esquecida_vitalsync` (precisa bater com
  `WHATSAPP_MISSED_MEASUREMENT_TEMPLATE_NAME`, cujo default no código já é
  esse nome).
- **Idioma**: `pt_BR`.
- **Categoria: Utilidade (Utility)** — alerta operacional, não Marketing.
- **Corpo** (`{{1}}` = nome do destinatário, `{{2}}` = nome do paciente,
  `{{3}}` = "manhã"/"noite" — sem dado clínico):
  > "Olá, {{1}}. O paciente {{2}} não registrou a medição da {{3}} de hoje.
  > Acesse o VitalSync para verificar e, se necessário, registrar em nome
  > dele(a)."
- **Botão "Visitar site" (URL dinâmica)**, texto **"Ver paciente"** — mesmo
  padrão do template `alerta_clinico_vitalsync` (link é da equipe, não do
  paciente): base fixa `https://vital-sync-frontend-iota.vercel.app/`, `{{1}}`
  (anexado pela Meta) = `patients/<patientId>`.

### Deploy e agendamento

```bash
supabase functions deploy send-missed-measurement-alert
supabase db push        # aplica 0059-0062 (colunas + tabela + funções + cron + RPC)
# opcional (já tem default no código):
#   supabase secrets set WHATSAPP_MISSED_MEASUREMENT_TEMPLATE_NAME=alerta_medicao_esquecida_vitalsync
```

Reaproveita os MESMOS secrets `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
`WHATSAPP_TEMPLATE_LANG` e os MESMOS segredos do Vault já configurados acima.
Cria dois jobs `pg_cron` idempotentes (`missed-measurement-alert-morning`/
`missed-measurement-alert-night`, 10:15/20:15 America/Sao_Paulo) — mesma
ressalva de permissão do `pg_cron` descrita acima para o lembrete.

### Como testar sem enviar de verdade

- **Modo simulado**: sem credenciais Meta, a Edge Function marca os
  `missed_measurement_logs` como `logged` em vez de `SENT`.
- **Disparo manual**: `select public.enqueue_missed_measurement_alerts('MORNING');`
  no SQL Editor, depois `supabase functions invoke send-missed-measurement-alert
  --body '{"period":"MORNING"}'`.
- **Prioridade de enfermagem**: com um `NURSING_PROFESSIONAL` ativo na equipe,
  confirme que só ele(s) recebe(m) (`recipient_is_nurse = true`); removendo o
  enfermeiro da equipe, confirme o fallback para os demais membros ativos.
- **Resolução automática**: chame `staff_insert_vital_record` (autenticado,
  depois do fechamento da janela) para o paciente/período de teste e confirme
  que as linhas `missed_measurement_logs` em aberto viram `resolved_at`
  preenchido (e `status='CANCELLED'` se ainda estavam `PENDING`).
- Mantenha o **modo homologação** ligado durante os testes, como nos dois
  fluxos acima.

---

## Boas-vindas no cadastro (primeira mensagem do paciente)

Quarta automação — e, cronologicamente, a **primeira** mensagem que o paciente
recebe: no momento em que ele é cadastrado, explica o acompanhamento, os dois
horários de medição e entrega o link do primeiro acesso. Implementada na
migration `0072_boas_vindas_cadastro.sql` (tabela `welcome_logs`, funções
`enqueue_welcome_message`/`dispatch_welcome_message` e **trigger AFTER INSERT em
`patients`**) + Edge Function `send-welcome-message`.

Não usa `pg_cron`: o gatilho é o cadastro, não o relógio. Como o disparo é um
trigger no banco, a Edge Function `create-patient` **não muda** — qualquer
caminho de cadastro (Edge Function, SQL Editor, seed) dispara as boas-vindas.
O envio é **best-effort**: uma falha de WhatsApp vira `warning` e **nunca**
impede o cadastro do paciente.

### Template novo a submeter na Meta

- **Nome**: `boas_vindas_vitalsync` (precisa bater com
  `WHATSAPP_WELCOME_TEMPLATE_NAME`, cujo default no código já é esse nome).
- **Idioma**: `pt_BR`.
- **Categoria: Utilidade (Utility)** — onboarding transacional, não Marketing.
- **Corpo** (`{{1}}` = nome do paciente, sem dado clínico):
  > "Olá, {{1}}! Você foi incluído(a) no acompanhamento pós-operatório do
  > VitalSync pela sua equipe de saúde. Nos próximos 10 dias, registre seus
  > sinais vitais 2x ao dia — manhã (8h às 10h) e noite (18h às 20h). Em cada
  > período você receberá um lembrete por aqui. Toque no botão abaixo para
  > fazer seu primeiro acesso."
- **Botão "Visitar site" (URL dinâmica)**, texto **"Acessar VitalSync"** —
  idêntico ao botão do template `lembrete_medicao_vitalsync`: a **base termina
  em `/registro-sinais/`** (SEM `{{1}}`), e a Meta anexa a variável dinâmica
  automaticamente no final da URL.
    - URL do site (base): `https://vital-sync-frontend-iota.vercel.app/registro-sinais/`
    - Variável `{{1}}` (anexada pela Meta) = o **`secure_token`** do paciente.
    - URL de amostra: `https://vital-sync-frontend-iota.vercel.app/registro-sinais/<token-exemplo>`
  ⚠️ Mesma armadilha do lembrete: **não** digite `{{1}}` dentro da base — o
  link sai quebrado (404).

### Deploy e agendamento

```bash
supabase functions deploy send-welcome-message
supabase db push        # aplica a 0072 (tabela + funções + trigger)
# opcional (já tem default no código):
#   supabase secrets set WHATSAPP_WELCOME_TEMPLATE_NAME=boas_vindas_vitalsync
```

Reaproveita os MESMOS secrets `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
`WHATSAPP_TEMPLATE_LANG` e os MESMOS segredos do Vault (`project_url`,
`service_role_key`) já configurados acima. Sem os segredos do Vault, a linha
fica `PENDING` e nada se perde: a Edge Function varre **todos** os `PENDING`
quando invocada sem `patient_id`.

### Como testar sem enviar de verdade

- **Modo simulado**: sem credenciais Meta, a Edge Function marca os
  `welcome_logs` como `logged` em vez de `SENT`.
- **Disparo manual**: `select public.enqueue_welcome_message('<patient_id>');`
  no SQL Editor, depois `supabase functions invoke send-welcome-message
  --body '{}'`.
- **Idempotência (1 por paciente)**: cadastrar/reenfileirar o mesmo paciente
  não duplica — `UNIQUE (patient_id)` + `ON CONFLICT DO NOTHING`.
  `enqueue_welcome_message` devolve `0` quando a linha já existia.
- **Sem telefone, sem linha**: paciente cadastrado sem `phone` não gera
  `welcome_logs` (não há para onde enviar).
- Mantenha o **modo homologação** ligado durante os testes — só os números da
  whitelist ficam `PENDING`; os demais viram `SKIPPED_TEST_MODE`.

---

## Gate de início da janela (0073)

Correção transversal às automações de medição: o filtro de elegibilidade de
`enqueue_measurement_reminders` (0038) e `enqueue_missed_measurement_alerts`
(0069) só tinha limite **superior** (`hospital_discharge_date + 10 >=
current_date`), então um paciente cadastrado com alta **agendada para o
futuro** já recebia lembrete e alerta de esquecimento antes de ter alta. A
migration `0073_gate_inicio_janela.sql` acrescenta o limite inferior
`current_date >= hospital_discharge_date`: a janela de 10 dias só **abre no dia
da alta**. Nenhuma outra lógica muda.

```bash
supabase db push        # aplica a 0073 (CREATE OR REPLACE das duas funções)
```
