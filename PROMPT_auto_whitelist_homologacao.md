# Prompt — Auto-incluir profissionais cadastrados na whitelist de homologação

Cole o bloco abaixo para a IA implementar. Objetivo: durante a **semana de teste** (modo homologação ligado), todo profissional cadastrado pelo sistema passa a receber os alertas por WhatsApp **automaticamente**, sem precisar editar a whitelist na mão.

---

## Contexto (arquitetura atual — respeitar)
- Banco de produção é **Supabase**. Implementar em `supabase/migrations/` (SQL/trigger). **Não** tocar em `backend/` legado.
- Fluxo de alerta: `submit_vital_record` → `notify_team_of_alert` cria linhas em `notification_logs`. Em **modo homologação** (`public.homologation_settings.homologation_mode = true`), só ficam `PENDING` (envio real) os destinatários cujo WhatsApp está na whitelist `homologation_settings.test_recipients` (`text[]`); os demais viram `SKIPPED_TEST_MODE`. Fora do modo homologação, **todos** os médicos da equipe recebem (comportamento de produção — já funciona).
- Destinatários de um alerta = **cirurgião responsável + médicos associados** da equipe do paciente; o número vem de `profiles.whatsapp`.
- Cadastro de profissional grava `profiles.whatsapp` (só dígitos) por **duas** vias: Edge Functions `admin-create-user` (admin cria) e `accept-invite` (profissional convidado se cadastra). Existe também `TEAM_MANAGER` como papel.
- Helper `public.normalize_phone(text)` (migration `0018`) é o que a `notify_team_of_alert` usa para comparar números — a whitelist precisa casar por essa mesma normalização.
- Migrations: numeração sequencial; a próxima livre é **`0040`** (não repetir número; `ALTER TYPE ... ADD VALUE` sempre isolado; aditivo e idempotente).

## Solução pedida
Criar um **trigger no `public.profiles`** (AFTER INSERT OR UPDATE OF whatsapp, role, status) que, quando o modo homologação está ligado, adiciona automaticamente o WhatsApp do profissional na whitelist `test_recipients`. Como grava no ponto único `profiles`, cobre as duas Edge Functions de cadastro sem alterá-las.

## Detalhes de implementação
1. **Migration `supabase/migrations/0040_auto_whitelist_homologacao.sql`** (aditiva/idempotente):
   - Função `public.sync_homologation_whitelist()` `returns trigger language plpgsql security definer set search_path = public`:
     - Sai cedo (`return NEW`) se `NEW.whatsapp` é nulo/vazio.
     - Lê `homologation_mode` de `homologation_settings where id = true`; se **desligado**, não faz nada (`return NEW`) — em produção a whitelist é irrelevante.
     - Considera só **perfis profissionais** que podem receber alerta: papéis `MEDICAL_SURGEON`, `ASSOCIATED_DOCTOR` (e avaliar se `TEAM_MANAGER`/`ADMIN` devem entrar — ver "Confirmar"). Ignorar perfis de paciente, se houver.
     - Normaliza com `public.normalize_phone(NEW.whatsapp)` e adiciona à `test_recipients` **sem duplicar** (comparando já normalizado). Ex.: `update homologation_settings set test_recipients = array(select distinct unnest(test_recipients || array[NEW.whatsapp])) where id = true;` — mas garantir que o valor guardado/compare seja consistente com `normalize_phone` (guardar como o `notify_team_of_alert` espera; se ele normaliza dos dois lados, guardar o número cru já basta — **verificar a implementação real de `normalize_phone` e do match em `0008`/`0018` antes de decidir o formato guardado**).
     - Idempotente: rodar duas vezes não cria número repetido.
   - Trigger `trg_sync_homologation_whitelist` AFTER INSERT OR UPDATE OF `whatsapp`, `role`, `status` ON `public.profiles` FOR EACH ROW EXECUTE FUNCTION `public.sync_homologation_whitelist();`.
   - `DROP TRIGGER IF EXISTS ...` / `CREATE OR REPLACE FUNCTION` para idempotência.
2. **Backfill único** (na mesma migration): inserir na whitelist os profissionais **já cadastrados** com WhatsApp (mesmos papéis), para quem cadastrou antes do trigger existir — também sem duplicar.
3. **Não** alterar `notify_team_of_alert` nem as Edge Functions de cadastro (o trigger é o único ponto novo). Se for estritamente necessário tocar em algo além do trigger, justificar.

## Confirmar antes de codar
- Quais papéis entram na auto-whitelist: só `MEDICAL_SURGEON` + `ASSOCIATED_DOCTOR`, ou também `TEAM_MANAGER` e `ADMIN`? (sugestão: os que de fato aparecem como destinatários em `notify_team_of_alert` — cirurgião + associados; gerente é somente-leitura, provavelmente **não** recebe alerta.)
- Formato a guardar na `test_recipients`: número cru (dígitos) confiando na normalização do match, ou já normalizado por `normalize_phone`? Decidir lendo o código real do match para não quebrar a comparação.
- Ao **remover** um profissional ou **desativá-lo** (`status`), deve **sair** da whitelist? (sugestão: manter simples — só adiciona; a whitelist é limpa ao sair do modo homologação. Confirmar.)

## Validação
- Ligar `homologation_mode = true`, cadastrar um médico com WhatsApp pelo sistema (via `admin-create-user` e via `accept-invite`) e conferir que o número aparece em `test_recipients` normalizado, sem duplicar.
- Simular um alerta de paciente na equipe desse médico e confirmar que o `notification_logs` do médico fica `PENDING` (não `SKIPPED_TEST_MODE`).
- Rodar o backfill duas vezes e confirmar ausência de duplicatas.
- Desligar `homologation_mode` e confirmar que novos cadastros não mexem mais na whitelist (e que os alertas passam a ir para todos os médicos da equipe normalmente).
