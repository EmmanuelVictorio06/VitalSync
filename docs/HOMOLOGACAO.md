# Modo de Homologação Médica — VitalSync / CuraPath

Guia da **semana de testes com médicos** antes da liberação para pacientes reais.
O modo de homologação permite simular todo o fluxo (cadastro fictício, sinais vitais,
alertas, WhatsApp, atendimentos) **sem** disparar mensagens indevidas nem poluir os dados
oficiais.

## Como funciona

- **Gate real no banco**: o disparo de alerta que o app executa é a função SQL
  `notify_team_of_alert` (RPC `submit_vital_record`). Em homologação, ela cria os logs de
  notificação mas só deixa `PENDING` (a serem enviados de verdade) os destinatários cuja
  whatsapp está na **whitelist**; os demais ficam `SKIPPED_TEST_MODE`.
- **Envio Meta real** pela Edge Function `send-whatsapp-alert` (template aprovado, sem dados
  clínicos). Sem credenciais configuradas, ela registra como `logged` (simulado).
- **Status de entrega** atualizados pela Edge Function `whatsapp-webhook`
  (`SENT → DELIVERED → READ`, ou `FAILED`).
- **Dados de teste** marcados com `is_test` em `patients`, `vital_sign_records`,
  `clinical_alerts`, `attendance_confirmations` e `notification_logs` (+ `environment`).

## 1. Banco de dados

Rode no **SQL Editor** do Supabase, após `0001..0009`:

```
supabase/migrations/0018_homologation.sql
```

É aditivo e idempotente (não apaga dados).

## 2. Secrets do WhatsApp (Meta Cloud API)

```bash
supabase secrets set \
  WHATSAPP_API_TOKEN="<token permanente do app Meta>" \
  WHATSAPP_PHONE_NUMBER_ID="<phone number id>" \
  WHATSAPP_VERIFY_TOKEN="<string à sua escolha>" \
  WHATSAPP_TEMPLATE_NAME="alerta_clinico_vitalsync" \
  WHATSAPP_TEMPLATE_LANG="pt_BR"
```

> Sem esses secrets, o fluxo funciona em modo simulado (`logged`) — útil para testar o gate
> sem enviar mensagens reais.

## 3. Template aprovado (Meta)

Crie e aprove o template `alerta_clinico_vitalsync` (idioma `pt_BR`), corpo:

```
Olá, {{1}}. Um paciente da sua equipe apresentou alteração no acompanhamento pós-operatório.
Acesse o VitalSync para verificar os detalhes.
```

`{{1}}` = nome do médico. **Nunca** envie foto, diagnóstico ou valores clínicos.

## 4. Edge Functions

```bash
supabase functions deploy send-whatsapp-alert
supabase functions deploy whatsapp-webhook --no-verify-jwt   # a Meta não envia JWT
```

- **Database Webhook** (Dashboard → Database → Webhooks): no `INSERT` de
  `public.clinical_alerts`, chamar `send-whatsapp-alert` (HTTP POST). Ele entrega os logs
  `PENDING` do alerta.
- **Webhook da Meta** (Painel do app → WhatsApp → Configuration):
  - Callback URL: `https://<project>.functions.supabase.co/whatsapp-webhook`
  - Verify token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
  - Assine o campo `messages`.

## 5. Frontend (Vite)

Para um deploy dedicado de testes, fixe o modo na build:

```
VITE_APP_ENV=homologation
VITE_HOMOLOGATION_MODE=true
```

Caso contrário, o **Administrador** liga/desliga o modo em runtime no painel
**Configurações → Homologação** (a flag fica no banco e vale para todos).

## 6. Painel do Administrador (Configurações → Homologação)

- Liga/desliga o **modo de homologação**.
- Métricas: pacientes de teste, alertas de teste, WhatsApps enviados, falhas, bloqueados,
  números autorizados.
- **Whitelist** de números (um por linha, com DDI/DDD; ex.: `5541999990000`).
- Botão **Limpar dados de teste** (remove apenas `is_test`).

## 7. Testes da semana (resumo)

1. Médico loga e vê só seus pacientes/equipes (RLS inalterado).
2. Cadastrar paciente **de teste** (toggle pré-marcado em homologação).
3. Abrir link público `/r/:token` sem login.
4. Enviar sinal estável → **sem** WhatsApp.
5. Enviar sinal amarelo/vermelho → alerta criado.
6. Número na whitelist → `PENDING`/`SENT`; fora → `SKIPPED_TEST_MODE`.
7. Alerta aparece em Alertas e no Dashboard; ao atender, sai dos recentes e vai para
   **Meus Atendimentos**.
8. Webhook atualiza `DELIVERED`/`READ`.
9. Responsividade no celular.

## 8. Checklist antes da divulgação oficial

- [ ] Modo de homologação **desativado** (painel) e `VITE_HOMOLOGATION_MODE=false`.
- [ ] `VITE_APP_ENV=production`.
- [ ] Whitelist de teste esvaziada (ou irrelevante com o modo desligado).
- [ ] Template aprovado e token permanente configurado.
- [ ] Database Webhook e webhook da Meta funcionando.
- [ ] **Dados de teste limpos** (botão "Limpar dados de teste").
- [ ] RLS/permissões revisadas (sem afrouxamento).
- [ ] Link público do paciente funcionando.
- [ ] `cd frontend && npm run build` passa.
