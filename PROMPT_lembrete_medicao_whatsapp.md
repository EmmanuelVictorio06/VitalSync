# Prompt — Lembrete de medição por WhatsApp (proximidade do horário-limite)

Copie e cole o bloco abaixo para implementar a feature. Ajuste os valores marcados como **[CONFIGURÁVEL]** conforme decisão de negócio/clínica.

---

## Contexto
No VitalSync (CuraPath), o paciente registra sinais vitais **2×/dia** durante os **10 dias pós-alta**, via link de WhatsApp. As medições só podem ser enviadas em duas janelas (fuso **America/Sao_Paulo**):

- **Manhã (`MORNING`)**: 08:00 → 10:00
- **Noite (`NIGHT`)**: 18:00 → 20:00

Preciso de um **lembrete automático por WhatsApp** que avisa o paciente para fazer a medição quando o horário-limite da janela estiver se aproximando **e** ele ainda não tiver enviado a medição daquele período.

## Regra de negócio a implementar
1. **Disparo do lembrete**: **[CONFIGURÁVEL — sugestão 30 min antes do fim]**
   - Manhã: às **09:30** (se ainda não enviou o registro `MORNING` do dia).
   - Noite: às **19:30** (se ainda não enviou o registro `NIGHT` do dia).
2. **Só enviar se**: o paciente está **ativo** e **dentro dos 10 dias pós-alta** (`hospital_discharge_date` + 10 dias ≥ hoje) **e** ainda **não existe** medição daquele `period` para a data de hoje.
3. **Idempotência**: no máximo **1 lembrete por paciente, por período, por dia**. Nunca reenviar se já foi enviado ou se a medição chegou nesse meio-tempo.
4. **Conteúdo**: mensagem curta, **sem dado clínico sensível**, apenas nome do paciente + aviso de que o horário-limite está próximo + link da tela de registro (`/registro-sinais/:token` ou alias `/r/:token`).

## Restrições técnicas (arquitetura atual — respeitar)
- Banco de produção é o **Supabase**. Trabalho novo vai em `supabase/migrations/` e `supabase/functions/`. **Não** tocar em `backend/` legado.
- Enum já existe: `public.measurement_period` = `('MORNING','NIGHT')` (migration `0001_init.sql`).
- **Reaproveitar o padrão de envio** da Edge Function `send-whatsapp-alert` (Meta Cloud API, `WHATSAPP_*` como secrets, whitelist de teste, modo simulado sem credenciais). **Não** colocar token no frontend.
- É necessário um **novo template WhatsApp aprovado** (lembrete), separado do `alerta_clinico_vitalsync`. Definições do template:
  - Nome: `lembrete_medicao_vitalsync` (minúsculas + underscore; deve bater com `WHATSAPP_TEMPLATE_NAME` da Edge Function).
  - **Categoria: Utilidade (Utility)** — é lembrete transacional, **não** Marketing.
  - Corpo `{{1}}` = **nome do paciente**.
  - **Botão "Visitar site" (URL dinâmica)**, texto ex. "Registrar agora", com URL:
    `https://vital-sync-frontend.vercel.app/registro-sinais/{{1}}` — onde o botão `{{1}}` = **token do paciente** (o `/r/:token` é só alias; o token já é único por paciente).
  - Na Edge Function, o botão passa **apenas o token**: `sub_type: 'url'`, `index: '0'`, `parameters: [{ type: 'text', text: token }]`. (Diferente do `send-whatsapp-alert`, que usa `patients/${patientId}` porque aquele link é da equipe.)
  - Se migrar para domínio próprio (`https://vitalsync.com.br`), o template precisa ser **editado na Meta** — o domínio base fica fixo, só o `{{1}}` é dinâmico. Garantir que `VITE_PUBLIC_APP_URL` em produção = `https://vital-sync-frontend.vercel.app`.
- Migrations: **numeração sequencial** — a próxima livre é `0038_...` (não repetir número; ver gotchas do `CLAUDE.md`).
- Fuso: todos os cálculos de janela em **America/Sao_Paulo**, mesmo que o servidor rode em UTC.

## Entregáveis esperados
1. **Migration** (`supabase/migrations/0038_lembrete_medicao.sql`):
   - Tabela/coluna de controle de idempotência (ex.: `reminder_logs` com `patient_id`, `period`, `reminder_date`, `status`, `sent_at`, UNIQUE `(patient_id, period, reminder_date)`), **ou** reutilizar `notification_logs` se fizer sentido — justificar a escolha.
   - Função SQL (ex.: `enqueue_measurement_reminders(p_period)`) que seleciona os pacientes elegíveis (ativos, dentro dos 10 dias, sem medição do período hoje, sem lembrete já enfileirado) e cria os logs `PENDING`.
2. **Agendamento**: uma **Scheduled Edge Function** (ou `pg_cron`) rodando às **09:30** e **19:30** America/Sao_Paulo, que chama a função de enfileiramento e em seguida dispara o envio. Documentar o comando de deploy/registro do cron.
3. **Edge Function de envio** (`supabase/functions/send-measurement-reminder/`): entrega os `reminder_logs` PENDENTES via template Meta, marcando `SENT`/`FAILED` — espelhando a lógica de `send-whatsapp-alert` (reutilizar helpers de `_shared/`).
4. **Texto do template** (pt_BR, categoria **Utilidade**) para submeter à aprovação da Meta:
   > Corpo:
   > "Olá {{1}}! Está chegando o horário-limite para registrar seus sinais vitais no VitalSync. Toque no botão abaixo para registrar antes que a janela feche. 🙏
   > Lembrete: os horários são das 8h às 10h (manhã) e das 18h às 20h (noite)."
   >
   > Botão (Visitar site, URL dinâmica): "Registrar agora" → `https://vital-sync-frontend.vercel.app/registro-sinais/{{1}}`
5. **Testes/validação**: como testar sem enviar de verdade (modo simulado sem credenciais) e como validar a idempotência e o gate dos 10 dias.

## Perguntas a confirmar antes de codar
- Antecedência do lembrete: **30 min** antes do fim está ok, ou prefere outro valor (ex.: 15 min)? Enviar também um lembrete no **início** da janela?
- Se o paciente perder a janela, deve receber alguma mensagem de "janela encerrada"? (fora do escopo desta feature, confirmar.)
- Origem do fuso: usar sempre America/Sao_Paulo global, ou um fuso por paciente no futuro?
