# Migrando o envio de WhatsApp para 360dialog

Este documento cobre a TROCA DE PROVEDOR (transporte HTTP). Os gates de
homologação/whitelist, os agendamentos `pg_cron` e tudo o mais descrito em
`docs/CONFIG_WHATSAPP_CLOUD_API.md` continuam **exatamente iguais** —
nenhuma migration SQL muda. Os **templates precisam ser resubmetidos** no
caminho realista de hoje (número novo — ver "Situação em 2026-09" abaixo);
só não precisariam se um dia der pra migrar o número atual pra mesma WABA.

## Por que trocar

Hoje o VitalSync está no modo de teste da Meta Cloud API direta (sem
verificação de negócio, limite de 5 destinatários — ver
`CONFIG_WHATSAPP_CLOUD_API.md`). Para o piloto real (mais de 5
médicos/pacientes), a Meta exige verificação de negócio (CNPJ, contrato
social) do Business Portfolio — esse processo, feito diretamente pelo
Business Manager da Meta ("Verificação Clássica"), é a parte burocrática. O
360dialog oferece **Partner-led Business Verification (PLBV)**: você manda
os documentos pra eles e é o parceiro deles junto à Meta que conduz a
verificação — mesmo efeito final da Verificação Clássica, só que mais rápido
e sem você mesmo brigar com o Business Manager.

A verificação de negócio em si **não desaparece** — é exigência da Meta para
qualquer rota oficial, não do BSP escolhido. O que muda é quem carrega esse
processo.

## Situação em 2026-09 (confirmado com o suporte do 360dialog)

- O 360dialog **pausou temporariamente** novas solicitações de PLBV
  ("reviewing the integrity process with Meta"). Sem previsão de volta.
- **Migrar** um número que já está ativo direto na Meta Cloud API **exige**
  o Business Portfolio já **verificado** — isso é checado no próprio Hub
  (tela "Onboard number" → opção "Yes, Business API" → pergunta "Is your
  Meta Business Portfolio verified?"). Sem PLBV disponível, essa verificação
  só sai pela Verificação Clássica (self-service).
- **Adicionar um número NOVO** (não migração) **não exige** portfolio
  verificado. Um portfolio não-verificado aceita **até 2 números de
  telefone**.
- Verificação Clássica e PLBV têm **a mesma finalidade** — contam igual pro
  status "Verified" do portfolio. Ou seja: **não é preciso esperar o PLBV
  voltar** para avançar. Rodar a Verificação Clássica agora (Meta Business
  Suite → Security Centre → Start Verification; até 14 dias úteis, feito
  pela própria empresa — parceiros/BSPs não podem enviar documento em nome
  dela) resolve tanto o "verificado" que a migração pede quanto qualquer
  outro gate futuro que dependa disso.

### Caminho recomendado agora

1. No Hub, escolha **"Choose another number"** (número novo, dentro do
   limite de 2 pro portfolio ainda não-verificado) — **não** "Re-onboard
   phone number" nem migração do número atual, pra não arriscar interromper
   o que já está funcionando hoje.
2. Conecte esse número novo via Embedded Signup normal (sem exigir
   verificação).
3. Resubmeta os MESMOS 4 templates (mesmo nome/texto/idioma `pt_BR`/
   categoria Utilidade) pra aprovação sob essa WABA nova — o número atual
   (Meta direta) continua rodando sem interrupção enquanto isso.
4. Em paralelo, inicie a Verificação Clássica do Business Portfolio (não
   depende do 360dialog nem da pausa do PLBV).
5. Quando os templates novos saírem aprovados: siga os Passos 2-7 abaixo
   (secrets, deploy, webhook, teste). Aí sim é seguro cortar
   `WHATSAPP_PROVIDER` pro 360dialog.
6. Quando o portfolio sair "Verified": dá pra decidir se migra o número
   antigo (de teste) pra dentro da mesma WABA do 360dialog pra consolidar
   tudo num só número, ou simplesmente manter os dois (o limite de 2 só
   existia por não-verificado).

## O que já foi preparado no código (antes de você ter a conta 360dialog)

`supabase/functions/_shared/whatsapp.ts` é o ponto único que fala com o
provedor de WhatsApp. As 4 Edge Functions que enviam mensagem
(`send-whatsapp-alert`, `send-measurement-reminder`,
`send-missed-measurement-alert`, `send-welcome-message`) foram refatoradas
para chamar esse módulo em vez de duplicar a chamada HTTP à Meta cada uma —
troca de provedor agora é mudar SÓ este arquivo, nunca as 4 funções de novo.

O módulo decide o provedor pelo secret `WHATSAPP_PROVIDER`:

- `meta` (default — nada muda se você não configurar nada)
- `360dialog`

## Passo a passo

### 1. Conta no 360dialog + número + templates

Ver "Caminho recomendado agora" acima (passos 1-4). Resultado esperado ao
final: um número novo conectado no Hub, com os 4 templates aprovados sob
essa WABA.

### 2. Pegar a API key

No 360dialog Hub, no número/canal conectado: **Settings → API Keys** (ou
equivalente na versão atual do Hub) → copie a chave (`D360-API-KEY`).

### 3. Configurar os secrets no Supabase

```bash
supabase secrets set \
  WHATSAPP_PROVIDER=360dialog \
  WHATSAPP_360DIALOG_API_KEY=<chave_do_360dialog>
```

Os secrets antigos (`WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) podem
ficar guardados sem uso — não interferem enquanto `WHATSAPP_PROVIDER` estiver
`360dialog`. Isso também dá um jeito rápido de VOLTAR pro Meta direto se
precisar: `supabase secrets set WHATSAPP_PROVIDER=meta` (ou apagar a
variável), sem mexer em código.

### 4. Deploy das funções

O deploy é necessário porque `_shared/whatsapp.ts` mudou (novo código, não só
secret):

```bash
supabase functions deploy send-whatsapp-alert
supabase functions deploy send-measurement-reminder
supabase functions deploy send-missed-measurement-alert
supabase functions deploy send-welcome-message
```

### 5. Configurar o webhook de status (sent/delivered/read/failed)

No 360dialog Hub, cole a MESMA Callback URL que já existe
(`https://<project>.functions.supabase.co/whatsapp-webhook`) — diferente da
Meta, não há passo de verificação (`hub.challenge`); é só colar a URL.

⚠️ **Verificar antes de confiar em produção**: o parser do webhook
(`whatsapp-webhook/index.ts`) assume o payload
`entry[].changes[].value.statuses[]` do formato Meta Cloud API. O 360dialog
se posiciona como compatível com esse formato, mas isso **não foi confirmado
com um payload real** — na primeira mensagem de teste, adicione um
`console.log(JSON.stringify(body))` temporário na função e confira nos logs
do Supabase (Dashboard → Functions → Logs) se a estrutura bate. Se vier
diferente, ajuste o parser (a lógica de idempotência/rank de status pode
ficar igual, só muda onde ler `providerId`/`status`/`timestamp` no JSON).

### 6. Testar de ponta a ponta

Mesmo roteiro de `CONFIG_WHATSAPP_CLOUD_API.md` (Passo 8): paciente de teste
com `is_test = true`, gerar um alerta YELLOW/RED, confirmar
`notification_logs` indo `PENDING` → `SENT` com `provider_message_id`
preenchido, e a mensagem chegando no WhatsApp.

Se ficar `logged` em vez de `SENT`: os secrets do 360dialog não foram lidos
(revise o Passo 3). Se der erro no `try/catch` (linha `FAILED` com
`error_message`), o corpo do erro devolvido pelo 360dialog aparece ali —
geralmente indica template não aprovado, número não verificado ainda, ou
API key errada.

### 7. Mantenha o modo homologação ligado

Igual ao fluxo Meta: `homologation_settings.test_recipients` continua sendo
quem realmente decide quem recebe mensagem de verdade — independente do
provedor de transporte.
