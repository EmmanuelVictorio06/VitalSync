# Prompt de Correção — VitalSync
**Base:** `AUDITORIA_VitalSync_2026-06-28.md` (mesmo diretório). Os IDs (C-01, M-01…) referenciam aquele relatório.
**Como usar:** este documento é a especificação de implementação. Siga as fases na ordem. Cada item tem: arquivos, estado atual, comportamento-alvo, passos, critérios de aceite e testes. **Não pule etapas, não “otimize” fora do escopo, e valide cada fase antes de seguir.**

---

## 0. Regras invioláveis (guardrails)

1. **Faça mudanças cirúrgicas.** Corrija o que está descrito; não refatore o que não foi pedido. Se identificar algo novo, **registre num comentário/TODO e pergunte** — não conserte por conta própria.
2. **Migrations só por adição e idempotentes.** Nunca edite uma migration já versionada/aplicada. Crie sempre uma **nova** migration com prefixo numérico sequencial (`0020_…`, `0021_…`). Use `if not exists`, `create or replace`, `drop … if exists`, blocos `do $$ … exception when … $$`. **Não** apague dados.
3. **Não rode migration/seed/deploy** nem `supabase db push` sem autorização explícita. Entregue os arquivos `.sql` e descreva o comando; a execução é decisão do dono.
4. **Uma fonte única de verdade clínica.** Limiares e faixas vêm de `packages/shared/src/clinical/thresholds.ts`. Qualquer cópia (SQL/edge) deve **espelhar exatamente** esses valores. Se houver divergência clínica (ex.: pressão arterial — M-06), **NÃO** invente: marque como pendente e exija confirmação médica (ver Fase 2).
5. **Preserve a segurança existente.** Não exponha `service_role` no frontend. Não afrouxe RLS. CPF nunca em texto puro no frontend/logs.
6. **Não quebre logins existentes.** Mexer em criação de usuário (C-06) exige caminho compatível com contas já criadas.
7. **Tudo em PT-BR** nas mensagens de usuário, mantendo o tom humano já existente.
8. **Git:** trabalhe em **uma branch por fase** (ex.: `fix/c01-submit-vital-record`). Não faça commit/push/PR sem autorização. Um arquivo de migration por fase quando possível.
9. **Verificação obrigatória ao final de cada fase** (build + teste manual descrito). Se um teste falhar, **pare** e relate.
10. **Não cometa erros silenciosos:** ao terminar cada item, confirme explicitamente os critérios de aceite, um a um.

---

## 1. Ordem de execução (fases)

As fases respeitam dependências. **C-02 depende de M-01** (precisa das colunas booleanas), por isso são feitas juntas na Fase 2. **C-01 e C-02/M-01 alteram a mesma RPC** → consolide numa única migration coerente.

| Fase | Itens | Branch sugerida |
|---|---|---|
| 1 | C-03, C-05 (segurança do link/Storage) | `fix/security-public-link-storage` |
| 2 | **C-01 + C-02 + M-01 + M-07** (medição/alerta/status/datas) numa migration consolidada + ajustes de frontend | `fix/measurement-status-pipeline` |
| 3 | C-04 (gate de CPF — decisão de arquitetura) | `fix/cpf-gate` |
| 4 | C-07 (status do paciente × alertas ativos) | `fix/patient-status-vs-alerts` |
| 5 | C-06 (criação de usuário via Auth Admin) | `fix/user-creation-auth-admin` |
| 6 | M-02, M-03, M-08, M-09 (permissões/RLS) | `fix/permissions-rls` |
| 7 | M-04, M-13, M-11, M-12 (consistência/constraints) | `fix/data-constraints` |
| 8 | M-05, M-10, M-14, M-15, M-16, D-04 + limpeza de código morto | `chore/cleanup-and-dedup` |

> Cada fase é entregável e testável de forma independente. Se o tempo for limitado, **Fases 1 e 2 são prioridade máxima**.

---

## FASE 1 — Segurança do link público e do Storage

### Item C-03 — Proteger/remover `generate-patient-link`
**Arquivo:** `supabase/functions/generate-patient-link/index.ts`.
**Estado atual:** stub sem autenticação; devolve `secure_token` para qualquer chamador com um `patient_id`.
**Alvo:** a função **não pode** revelar o token sem autorização.
**Passos (escolha A se não for usada hoje; é o caso atual):**
- **A (recomendado):** **remover** a função do diretório `supabase/functions/generate-patient-link/` e qualquer referência/deploy. Confirme com `grep -rn "generate-patient-link" .` que não há chamadas no frontend (hoje não há).
- **B (se for mantida):** exigir `Authorization: Bearer <jwt>`; validar o usuário (`admin.auth.getUser(jwt)`); autorizar **ADMIN, cirurgião responsável da equipe do paciente, ou SUPPORT**; só então montar o link. Verifique também `verify_jwt` em `supabase/config.toml` para esta função.
**Critérios de aceite:**
- Não existe caminho anônimo que retorne `secure_token`.
- `grep` não encontra chamadas órfãs quebradas.
**Teste:** tentar `POST` à função (sem/inadequado JWT) com um `patient_id` válido → **negado** (ou função inexistente).

### Item C-05 — Restringir escrita no bucket `patient-photos`
**Arquivos:** nova migration `00xx_storage_patient_photos_write.sql` (revisa policies de `storage.objects`).
**Estado atual:** `patient_photos_write` (authenticated) e `patient_photos_anon_write` (anon) só checam `bucket_id`, sem amarrar o caminho ao paciente.
**Alvo:** escrita restrita ao prefixo do paciente correto; idealmente o upload do paciente passa a ser intermediado por Edge Function que valida o token.
**Decisão de arquitetura (escolha e documente):**
- **Opção 1 (mais segura):** criar/usar uma Edge Function (service_role) que recebe o `secure_token` + arquivo, valida o token, e faz o upload em `{patientId}/...`. Então **remover** as policies de INSERT anônimas/autenticadas amplas. O `storageService.uploadPatientPhoto` passa a chamar a função.
- **Opção 2 (mínima, se Opção 1 for inviável agora):** manter o upload direto, mas **endurecer a policy** para exigir que o primeiro segmento do path seja um `patientId` existente e ativo (sem revelar a equipe). Para autenticados, restringir por equipe (`is_team_member`). Anon continua sem LER (já é o caso).
**Critérios de aceite:**
- Não é possível subir arquivo para uma pasta de paciente arbitrária a partir do cliente.
- Upload legítimo do fluxo do paciente continua funcionando.
- Leitura por equipe (policy `patient_photos_read` da 0014) permanece intacta.
**Teste:** tentar upload em `outroPaciente/x.jpg` → negado; fluxo normal de foto da cicatriz/dreno → sucesso.

---

## FASE 2 — Pipeline de medição → status → alerta (C-01 + C-02 + M-01 + M-07)

> **Esta é a fase mais crítica. Faça com extremo cuidado.** Tudo numa **única migration** consolidada (`00xx_fix_measurement_pipeline.sql`) para deixar o banco coerente, mais ajustes de frontend.

### 2.1 Modelo de dados (M-01)
**Arquivo:** migration.
**Problema:** `vital_sign_records` só tem `urination_count` e `vomiting_count`; o “Sim/Não” de diurese e vômito é descartado/ambíguo.
**Alvo:** persistir os booleanos de forma não-ambígua.
**Passos:**
- `alter table public.vital_sign_records add column if not exists urinated_normally boolean;`
- `alter table public.vital_sign_records add column if not exists had_vomit boolean;`
- **Backfill compatível:** para linhas existentes, inferir de forma conservadora: `update … set urinated_normally = (urination_count is not null) where urinated_normally is null;` e `update … set had_vomit = (coalesce(vomiting_count,0) > 0) where had_vomit is null;` (mantém o comportamento atual para o histórico, sem perder dados).
- **Não** remover `urination_count`/`vomiting_count` (compatibilidade); a contagem continua opcional.

### 2.2 Função de avaliação clínica única (C-02)
**Arquivo:** migration.
**Problema:** 4 cópias divergentes do cálculo de status; a RPC ignora vômito/dispneia/FC/diurese.
**Alvo:** uma função SQL `eval_clinical_status(...)` que **espelha exatamente** `packages/shared/src/clinical/thresholds.ts`. **Pressão arterial fica de fora do disparo de alerta** até validação médica (ver M-06 / nota abaixo).
**Tabela de limiares a usar (copie de `thresholds.ts`, confira valor a valor):**

| Dimensão | GREEN | YELLOW | RED |
|---|---|---|---|
| Temperatura (°C) | < 37,8 | 37,8–38,4 | ≥ 38,5 |
| Saturação SpO₂ (%) | > 94 | 92,1–94 | ≤ 92 |
| Frequência cardíaca (bpm) | ≤ 110 | 111–119 | ≥ 120 |
| Dor (0–10) | 0–6 | 7–8 | ≥ 9 |
| Dispneia (0–10) | 0 | 1–5 | ≥ 6 |
| Diurese (micções/dia) | ≥ 4 | 2–3 | ≤ 1 |
| Vômito (Sim/Não) | Não | — | Sim |
| Sangramento (Sim/Não) | Não | — | Sim |
| Passos | sem queda relevante | queda ≥ 25% vs. dia anterior | queda ≥ 50% vs. dia anterior |
| **Pressão arterial** | **EXCLUÍDA do disparo** | **EXCLUÍDA** | **EXCLUÍDA** (pendente validação médica — M-06) |

**Regras de avaliação:**
- Avalie **apenas dimensões com valor informado** (NULL → não avalia, não dispara).
- **Diurese:** se `urination_count` informado → use a faixa por contagem; senão → `urinated_normally = true ? GREEN : YELLOW`.
- **Passos:** precisa do total de passos do dia anterior do mesmo paciente; se ausente/zero → GREEN.
- **`overall` = pior severidade** (GREEN < YELLOW < RED).
- **`type`** = rótulo da dimensão que determinou o pior status (prioridade de desempate sugerida: Sangramento → Temperatura → Saturação → Frequência cardíaca → Dispneia → Vômito → Dor → Diurese → Passos). Se nada disparou, `type = 'Sinais vitais'`.
**Nota M-06 (obrigatória):** os limiares de pressão arterial no `thresholds.ts` estão clinicamente suspeitos (RED a partir de ~120 mmHg sistólica). **Não** inclua PA no disparo de alerta enquanto a equipe médica não confirmar. Deixe um comentário `-- PENDENTE VALIDAÇÃO MÉDICA` e um item no checklist de sign-off.

### 2.3 Consolidar `submit_vital_record` (C-01) — eliminar a sobrecarga
**Arquivo:** migration.
**Problema:** existem duas sobrecargas (14 e 16 args); o app chama a de 16 (sem tipo/notify/is_test).
**Alvo:** **uma única** função, com **todos** os parâmetros necessários, que: grava a medição (incluindo dreno, `urinated_normally`, `had_vomit`, `is_test` do paciente), calcula status via `eval_clinical_status`, atualiza `patients.current_status`, e, se YELLOW/RED, cria o alerta **com `type` e `is_test`** e chama `notify_team_of_alert`.
**Passos:**
1. **Dropar AS DUAS sobrecargas existentes**, explicitamente, para não restar duplicata:
   - `drop function if exists public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text);`
   - `drop function if exists public.submit_vital_record(text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text);`
2. **Criar uma única** `submit_vital_record` com a assinatura final (acrescente `p_urinated_normally boolean`, `p_had_vomit boolean` aos 16 já existentes). Internamente:
   - resolve o paciente por token (ativo);
   - calcula `(v_status, v_type)` via `eval_clinical_status(...)` (buscando passos do dia anterior quando for período NOITE);
   - faz o `insert … on conflict (patient_id, record_date, period) do update` gravando **todas** as colunas, inclusive `urinated_normally`, `had_vomit`, `has_drain`, `drain_photo_path` (com a regra “sem dreno → foto do dreno = null” que já existe na 0009), e `is_test = coalesce(v_patient.is_test,false)`;
   - `update patients set current_status = v_status`;
   - se `v_status <> 'GREEN'`: `insert into clinical_alerts (… type, description, is_test)` e `perform notify_team_of_alert(v_alert_id);`
   - `grant execute … to anon, authenticated;`
3. **Verificação pós-migration (obrigatória):**
   `select proname, pronargs from pg_proc where proname = 'submit_vital_record';` → deve retornar **exatamente uma** linha.

### 2.4 Frontend — passar os novos campos
**Arquivos:** `frontend/src/services/vitalSignsService.ts` (`VitalSubmission`, `submitByToken`), `frontend/src/components/patient-measurement/PatientMeasurementWizard.tsx` (`submit`).
**Passos:**
- Acrescentar `urinated_normally?: boolean` e `had_vomit?: boolean` em `VitalSubmission` e enviá-los na `supabase.rpc('submit_vital_record', { … p_urinated_normally, p_had_vomit })`.
- No `submit()` do wizard, enviar `urinated_normally: form.urinatedNormally ?? undefined` e `had_vomit: form.hadVomit ?? undefined`. **Não** condicionar mais o significado à presença da contagem.
- **Validação (M-01):** quando `urinatedNormally === true`, manter a contagem **opcional** (o booleano agora resolve a ambiguidade) — OU torná-la obrigatória, se a equipe preferir. Documente a escolha. O essencial: “urinou normalmente sem contagem” **não pode** mais virar YELLOW.

### 2.5 Datas / `monitoring_day` (M-07)
**Arquivos:** migration (RPCs) e/ou frontend.
**Alvo:** `monitoring_day` consistente com `@vitalsync/shared` (1..10, `null`/encerrado fora da janela). Dentro da RPC, manter o cap em 10 ou retornar coerente com `within_window`. Não introduzir regressão no `get_patient_by_token`.

**Critérios de aceite da Fase 2:**
- `pg_proc` mostra **uma** `submit_vital_record`.
- Medição com **vômito = Sim** gera alerta RED; **dispneia ≥ 6**, **FC ≥ 120**, **diurese ≤ 1** geram alerta; **pressão arterial NÃO** dispara alerta.
- Alerta criado tem `type` correto (ex.: “Temperatura”, “Dor”) e `is_test` herdado do paciente.
- `notification_logs` recebe linhas no envio de alerta (respeitando o gate de homologação quando ligado).
- “Urinou normalmente sem contagem” → diurese **GREEN** (não YELLOW).
- O `overall` gravado bate com o `statusByVital` exibido no acompanhamento (mesmos limiares).
**Testes:** matriz por dimensão (um valor GREEN/YELLOW/RED de cada), paciente real e paciente de teste (homologação ligada/desligada), períodos manhã/noite com e sem passos.

---

## FASE 3 — Gate de CPF do paciente (C-04)
**Arquivos:** `supabase/migrations/0002_patient_rpc.sql` (grants), `validate-patient-access` (edge), `frontend/src/services/vitalSignsService.ts` / `publicAccessService.ts`.
**Problema:** o gate de CPF é só de UI; as RPCs anônimas são chamáveis direto só com o token.
**Decisão de arquitetura (escolha e documente uma):**
- **Opção 1 (CPF como barreira real):** mover leitura/envio para Edge Function que valida CPF + rate-limit (`public_access_attempts`) e **revogar** `grant execute … to anon` de `get_patient_by_token` e `submit_vital_record` (passam a ser chamadas só pela função service_role). O frontend deixa de chamar as RPCs diretamente.
- **Opção 2 (assumir o token como segredo):** manter as RPCs anônimas, **assumir e documentar** que o CPF é uma camada extra de UX, não de segurança, e remover qualquer texto/teatro que prometa proteção de CPF na camada de dados.
**Critérios de aceite:** o comportamento real corresponde ao prometido; sem promessa de segurança inexistente.
**Teste:** chamar `submit_vital_record`/`get_patient_by_token` direto como `anon` (sem CPF) → resultado coerente com a opção escolhida.

---

## FASE 4 — `current_status` do paciente × alertas ativos (C-07)
**Arquivos:** RPC `submit_vital_record` e/ou consultas em `MonitoringPage.tsx`, `dashboardService.ts`, `teamViewService.ts`.
**Problema:** `current_status` reflete só a última medição; um paciente com alerta pendente pode aparecer GREEN e sumir de filtros.
**Alvo (escolha e documente uma regra única, aplicada em TODAS as telas):**
- **Regra A:** `current_status` = pior entre (status da última medição) e (existência de alerta pendente não atendido).
- **Regra B:** manter `current_status` = última medição, mas todas as telas que filtram/ordenam por status **combinam** com `hasUnattendedAlert` (padronizar o que `teamViewService.getPriorityPatients` já faz, em monitoramento e dashboard).
**Critérios de aceite:** paciente com alerta pendente **não some** do filtro/lista crítica quando a última medição é GREEN; comportamento idêntico entre dashboard, monitoramento e equipes.
**Teste:** manhã RED (gera alerta) + noite GREEN → paciente continua sinalizado enquanto o alerta estiver pendente; após atender, normaliza.

---

## FASE 5 — Criação de usuário via Auth Admin (C-06)
**Arquivos:** `supabase/migrations/0004`/`0007`/`0016` (`admin_create_doctor`, `admin_create_user`), `frontend/src/services/userService.ts`, `profileService.ts`; nova Edge Function (ex.: `admin-create-user`).
**Problema:** inserção manual em `auth.users`/`auth.identities` é frágil; há dois mecanismos divergentes.
**Alvo:** criar contas via `admin.auth.admin.createUser` (como `accept-invite` já faz).
**Passos:**
- Criar Edge Function `admin-create-user` (service_role) que: valida JWT do chamador, exige `is_admin()`, valida campos, chama `auth.admin.createUser({ email, password, email_confirm, user_metadata })` e completa o `profiles` (whatsapp/role/status/specialty/crm/notes). Aproveita o trigger `set_professional_tag`/`handle_new_user`.
- `userService.createUser` / `profileService.createDoctorProfile` passam a invocar a função (em vez das RPCs hand-rolled).
- **Não** apague as RPCs antigas até confirmar que o novo caminho funciona; depois marque-as como descontinuadas (documentado) ou remova numa fase de limpeza.
**Critérios de aceite:** criar usuário pelo painel → **loga** com a senha; troca de e-mail/senha funcionam; convite continua funcionando; tag gerada.
**Teste:** criar Admin/Cirurgião/Associado/Suporte e logar com cada um.

---

## FASE 6 — Permissões e RLS (M-02, M-03, M-08, M-09)

- **M-02 — UI×backend (Suporte reenviar WhatsApp):** alinhar `supportPermissionService.canResendWhatsapp` à RPC `alert_resend_notification` (que só aceita Admin/cirurgião). Decisão: **ou** dar permissão real à RPC ao Suporte, **ou** esconder o botão para Suporte. Documente. *Aceite:* nenhuma ação habilitada na UI é recusada pelo backend.
- **M-03 — “home”/acessos do Suporte:** definir a home do Suporte (ex.: `/monitoring`); impedir/ocultar `/dashboard` para Suporte; tornar cards de paciente **não clicáveis** para Suporte (já que `/patients/:id` é barrado). *Aceite:* Suporte não cai em telas vazias nem em loop de redirecionamento.
- **M-08 — escrita direta em `clinical_alerts`/`attendance_confirmations`:** migration que restringe as policies de escrita (idealmente: SELECT por RLS; INSERT/UPDATE só via RPC `SECURITY DEFINER`). *Aceite:* tentativa de UPDATE direto (sem RPC) para marcar atendido sem observação → negada.
- **M-09 — `profiles_select using(true)`:** restringir a leitura ampla a `id, name, professional_tag` (via view/RPC), mantendo e-mail/whatsapp/crm visíveis só ao próprio usuário e ao Admin. **Cuidado:** vários serviços resolvem nomes via `profiles` — ajuste-os para usar a view/colunas permitidas e teste todas as listas (alertas, atendimentos, equipes, usuários). *Aceite:* usuário não-admin não lê e-mail/whatsapp de terceiros; listas continuam mostrando nomes/tags.

---

## FASE 7 — Consistência e constraints (M-04, M-11, M-12, M-13)

- **M-04 — `attended` × `attendance_status`:** padronizar. No `soft_delete_patient`, ao marcar alertas `IGNORED`, também `attended = true` (e `attended_by`/`attended_at` se fizer sentido), **ou** migrar todas as queries para `attendance_status` e deprecar `attended`. *Aceite:* nenhuma query depende de estado misto.
- **M-11 — cirurgião em ≤ 1 equipe (se for a regra):** **confirme a regra com o dono antes.** Se confirmada: filtrar `getAvailableMainSurgeons` para excluir quem já lidera equipe e/ou criar índice único parcial. *Aceite:* não é possível selecionar um cirurgião que já lidera outra equipe.
- **M-12 — 2º cirurgião via `team_members`:** impedir `role_in_team = 'MAIN_SURGEON'` em `team_members` (check/trigger) ou validar no servidor. *Aceite:* não é possível inserir um segundo MAIN_SURGEON na equipe.
- **M-13 — convite duplicado:** opcionalmente bloquear convite para e-mail já cadastrado e/ou expirar convites anteriores do mesmo e-mail ao gerar novo. *Aceite:* não há múltiplos convites válidos ativos para o mesmo e-mail (se a regra for adotada).

---

## FASE 8 — Limpeza, dedup e datas (M-05, M-10, M-14, M-15, M-16, D-04 + código morto)

- **M-05 — faixas de entrada duplicadas:** `patient-measurement/validation.ts` deve importar as faixas de `@vitalsync/shared` (remover o `INPUT_RANGES` local). Remover o campo morto `inputRanges` de `lib/dto.ts` se não houver consumidor.
- **M-10 — `process-vital-record` (edge) morto:** remover **ou** marcar claramente como descontinuado para não religar por engano (evita nova divergência da C-02).
- **M-14 — `is_test` em telas:** fora do modo homologação, filtrar `is_test = false` em dashboard/alertas/equipes (ou garantir limpeza via `admin_clear_test_data`).
- **M-15 / M-16 — datas:** padronizar fuso; reusar `daysSinceDischarge`/`monitoringDay`/datas civis do `@vitalsync/shared` nas telas (remover recálculos por `Date.now()` local). Definir e documentar o fuso de referência (ex.: o do paciente/clínica).
- **D-04 — de-para de papéis:** centralizar o mapeamento `ADMIN↔ADM` etc. num único módulo (ex.: `shared` ou `lib/roles.ts`) e referenciar em `AuthContext`, `MyProfilePage.roleKey`, `exportService.ROLE_LABEL`, `profile.ROLE_LABEL_PT`.
- **Código morto (seção 9 da auditoria):** **antes de remover, confirme com o dono** se o backend Fastify (`backend/`, `render.yaml`), `lib/api.ts`, `lib/admin-api.ts`, `lib/teams-api.ts`, `lib/teams-types.ts` e as edge functions órfãs (`generate-patient-link`, `process-vital-record`, `export-data`, `whatsapp-webhook` se não usadas) podem sair. Se a arquitetura única (Supabase) for assumida, remova-os; senão, documente o porquê de manter. `AuthUser.teamId` (sempre `null`) e `fetchProtectedImage`/`useProtectedImage` (caminho para backend inexistente) entram nessa avaliação.
*Aceite:* build passa; nenhuma referência quebrada; sem duplicatas de limiares/faixas/papéis.

---

## 2.bis — Apêndice: SQL de referência (revisar antes de aplicar)

> **Referência** para a Fase 2. **Valide cada linha contra `thresholds.ts` e contra o schema real** antes de usar. Não copie cegamente.

```sql
-- Avaliação clínica espelhando @vitalsync/shared (PA excluída — pendente validação médica).
create or replace function public.eval_clinical_status(
  p_temperature       numeric,
  p_oxygen_saturation int,
  p_heart_rate        int,
  p_pain              int,
  p_dyspnea           int,
  p_urinated_normally boolean,
  p_urination_count   int,
  p_had_vomit         boolean,
  p_has_bleeding      boolean,
  p_steps             int,
  p_prev_steps        int
) returns table(status public.clinical_status, vtype text)
language plpgsql immutable set search_path = public as $$
declare
  v_status public.clinical_status := 'GREEN';
  v_type   text := 'Sinais vitais';
  -- severidade auxiliar: 0 GREEN, 1 YELLOW, 2 RED
  v_sev int := 0;
  procedure_unused boolean;
  -- helper inline via CASE expressions
  s_temp int := case when p_temperature is null then -1
                     when p_temperature >= 38.5 then 2
                     when p_temperature >= 37.8 then 1 else 0 end;
  s_spo2 int := case when p_oxygen_saturation is null then -1
                     when p_oxygen_saturation <= 92 then 2
                     when p_oxygen_saturation <= 94 then 1 else 0 end;
  s_hr   int := case when p_heart_rate is null then -1
                     when p_heart_rate >= 120 then 2
                     when p_heart_rate >= 111 then 1 else 0 end;
  s_dysp int := case when p_dyspnea is null then -1
                     when p_dyspnea >= 6 then 2
                     when p_dyspnea >= 1 then 1 else 0 end;
  s_vom  int := case when p_had_vomit is true then 2 else 0 end;
  s_bleed int := case when p_has_bleeding is true then 2 else 0 end;
  s_pain int := case when p_pain is null then -1
                     when p_pain >= 9 then 2
                     when p_pain >= 7 then 1 else 0 end;
  s_diur int := case
                  when p_urination_count is not null then
                       case when p_urination_count <= 1 then 2
                            when p_urination_count <= 3 then 1 else 0 end
                  when p_urinated_normally is not null then
                       case when p_urinated_normally then 0 else 1 end
                  else -1 end;
  s_step int := case when p_steps is null or p_prev_steps is null or p_prev_steps <= 0 then -1
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.5 then 2
                     when (p_prev_steps - p_steps)::numeric / p_prev_steps >= 0.25 then 1
                     else 0 end;
begin
  -- pior severidade
  v_sev := greatest(0, s_temp, s_spo2, s_hr, s_dysp, s_vom, s_bleed, s_pain, s_diur, s_step);
  v_status := case v_sev when 2 then 'RED' when 1 then 'YELLOW' else 'GREEN' end;

  -- tipo = primeira dimensão (por prioridade) que atinge v_sev, quando v_sev>0
  if v_sev > 0 then
    v_type := case
      when s_bleed = v_sev then 'Sangramento'
      when s_temp  = v_sev then 'Temperatura'
      when s_spo2  = v_sev then 'Saturação'
      when s_hr    = v_sev then 'Frequência cardíaca'
      when s_dysp  = v_sev then 'Dispneia'
      when s_vom   = v_sev then 'Vômito'
      when s_pain  = v_sev then 'Dor'
      when s_diur  = v_sev then 'Diurese'
      when s_step  = v_sev then 'Passos'
      else 'Sinais vitais' end;
  end if;

  status := v_status; vtype := v_type; return next;
end;
$$;
```

> Observações sobre o SQL de referência: (1) `greatest` ignora valores `-1` apenas porque o piso é `0` — confira que dimensões ausentes (`-1`) nunca elevam o status; (2) o `procedure_unused`/comentários são ilustrativos — remova ruído; (3) ao integrar no `submit_vital_record`, busque `p_prev_steps` como o `steps` do dia anterior (período NOITE) do mesmo paciente; (4) **PA continua fora** — não adicione sem validação médica.

---

## 3. Validação final (após todas as fases autorizadas)

**Banco:**
- [ ] `select proname, count(*) from pg_proc where proname='submit_vital_record' group by 1;` → 1.
- [ ] Nenhuma policy de escrita ampla restou no bucket `patient-photos` nem em `clinical_alerts`/`attendance_confirmations` (conforme decisões).
- [ ] `profiles` não expõe e-mail/whatsapp a não-admin.

**App (smoke por perfil):** Admin, Cirurgião, Associado, Suporte — login, navegação, ações principais sem erro nem tela vazia.

**Fluxo do paciente:** gate de CPF; dreno sim/não; vômito sim → alerta; diurese sem contagem → GREEN; foto cicatriz/dreno; alerta com tipo correto + log de notificação.

**Mobile (320/360/375/390/412/430px):** sem scroll lateral nas telas principais; bottom-nav não cobre conteúdo; gráficos/modais/tabelas não estouram.

**Build:** `npm run build` (shared + frontend) sem erros de tipo.

---

## 4. O que NÃO fazer
- Não editar migrations já aplicadas; não rodar `db push`/deploy sem autorização.
- Não incluir pressão arterial no disparo de alerta sem confirmação médica (M-06).
- Não remover backend/edge functions/mocks sem confirmar com o dono.
- Não expor `service_role`/segredos no frontend; não logar CPF.
- Não “consertar” itens marcados como **corretos** no apêndice da auditoria (dreno condicional, avatar com preview, telefone apagável, tag única, 1 atendimento por alerta, soft delete).
- Não fazer commit/push/PR/branch nova sem pedido explícito.

## 5. Entregáveis por fase
Para cada fase: (a) os arquivos novos/alterados, (b) descrição curta do que mudou, (c) checklist de aceite preenchido, (d) comandos exatos de migration/deploy a serem executados pelo dono (sem executá-los), (e) testes realizados e resultado. **Pare e relate** se qualquer critério de aceite falhar.

---

### Checklist de sign-off clínico (obrigatório antes de produção)
- [ ] Limiares de **pressão arterial** confirmados pela equipe médica (hoje suspeitos — M-06) e decisão sobre incluí-los no disparo.
- [ ] Limiares de dor/dispneia/FC/saturação/temperatura/diurese revisados contra a especificação clínica.
- [ ] Política do gate de CPF (barreira real vs. camada de UX) aprovada.
- [ ] Regra de “cirurgião em N equipes” (M-11) confirmada.
