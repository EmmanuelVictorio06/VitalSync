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
- **Botão "Visitar site" (URL dinâmica)**, texto **"Registrar agora"**, URL:
  `https://vital-sync-frontend.vercel.app/registro-sinais/{{1}}` — onde o
  `{{1}}` do botão é o **`secure_token`** do paciente (a Edge Function envia só
  o token, não o path inteiro; o `/r/:token` é apenas um alias). Diferente do
  botão "Ver no VitalSync" do alerta clínico, que usa `patients/${patientId}`
  porque aquele link é da equipe — aqui o link é do próprio paciente.
- Se migrar para domínio próprio (`https://vitalsync.com.br`), o template
  precisa ser **editado na Meta** (a URL base do botão é fixa na aprovação, só
  o `{{1}}` é dinâmico) e `VITE_PUBLIC_APP_URL` em produção precisa continuar
  igual à base do template — hoje `https://vital-sync-frontend.vercel.app`.

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
