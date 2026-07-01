# Auditoria Técnica Completa — VitalSync
**Data:** 28/06/2026 · **Escopo:** projeto inteiro (frontend, shared, Supabase migrations/RPCs/RLS/Storage, Edge Functions, backend legado)
**Natureza:** somente diagnóstico — nenhum arquivo foi alterado, nenhuma migration foi criada/rodada.

> Como ler este relatório: as seções 3 e 4 trazem os achados com severidade, arquivo, impacto e correção. As demais seções organizam o mesmo conteúdo por tema (UI/UX, mobile, regras de negócio, dados, duplicação) e fecham com plano de correção e checklist de testes. Cada achado tem um ID (ex.: **C-01**) para referência cruzada.

---

## 1. Resumo geral da arquitetura

VitalSync é um **monorepo npm workspaces** com quatro partes:

- **`frontend/`** — SPA React + Vite + Tailwind + React Router. É o app real em produção (deploy Vercel — ver `vercel.json`).
- **`packages/shared/`** (`@vitalsync/shared`) — tipos, enums e **motor clínico puro** (faixas de entrada e limiares de semáforo verde/amarelo/vermelho). É a "fonte única" pretendida das regras clínicas.
- **`supabase/`** — **a verdadeira camada de backend em uso**: 19 migrations (tabelas, RLS, RPCs `SECURITY DEFINER`, Storage) + 9 Edge Functions (Deno).
- **`backend/`** — uma API **Fastify + Prisma** com `render.yaml`. **Está praticamente morta** do ponto de vista do app (só `lib/api.ts` é referenciado, e apenas por um caminho de fallback que nunca dispara). É dívida arquitetural relevante (ver D-01/C-06).

**Modelo de acesso:** o frontend fala **direto com o Supabase** (`lib/supabase.ts`, chave `anon`) na imensa maioria dos serviços. Operações sensíveis (CPF, criação de conta por convite) vão por **Edge Functions** com `service_role`. O paciente **não faz login**: acessa por um **link com `secure_token`** e um **gate de CPF**.

**Perfis (papéis):** há **dois vocabulários de papel** que precisam ser mapeados o tempo todo:
- No banco (`profiles.role` / enum `user_role`): `ADMIN`, `MAIN_SURGEON`, `ASSOCIATED_DOCTOR`, `SUPPORT`.
- No frontend (`@vitalsync/shared` `Role`): `ADM`, `SURGEON`, `ASSOCIATE`, `SUPPORT`.
O adaptador é `AuthContext.ROLE_MAP`. Esse mapeamento duplicado aparece reescrito em vários lugares (ver D-04).

**Camadas de regra:** RLS por equipe (`is_admin()`, `is_team_member()`, `is_main_surgeon_of()`, `is_support()`), RPCs `SECURITY DEFINER` para ações privilegiadas, e guardas de UI (`PermissionGuard`, `lib/permissions.ts`, `permissionService`, `supportPermissionService`).

---

## 2. Mapa dos fluxos principais

- **Login** → `LoginPage` → `authService.signIn` (Supabase Auth) → `AuthContext` carrega `profiles` e mapeia o papel → `PermissionGuard` libera as rotas internas dentro de `Layout`.
- **Dashboard** → `DashboardPage` → `dashboardService.getDashboard()` agrega KPIs, gráfico semanal, lista crítica e alertas recentes (escopo por RLS).
- **Pacientes** → `MonitoringPage` lista (`patientService.list`, filtra `deleted_at IS NULL`); cadastro/edição por **Edge Functions** `create-patient`/`update-patient` (CPF protegido); exclusão lógica por RPC `soft_delete_patient`.
- **Monitoramento (paciente via link)** → `/r/:token` ou `/registro-sinais/:token` → **gate de CPF** (`validate-patient-access`) → wizard de 4 etapas → `submit_vital_record` (RPC anônima) grava medição, calcula status e cria alerta.
- **Alertas** → `AlertsPage` → `alertService` (lista por RLS, ações por RPC `alert_set_in_analysis` / `alert_mark_attended` / `alert_ignore` / `alert_resend_notification`).
- **Acompanhamento individual** → `PatientDashboardPage` → `patientDashboardService.getDashboard` (gráficos via `@vitalsync/shared`, foto via URL assinada, "alerta atual" = alerta mais recente).
- **Equipes** → Admin: `TeamsPage`/`teamService`; Cirurgião: `MyTeamPage`; Associado: `MyTeamsPage` (`teamViewService`, leitura).
- **Convites** → `InvitesPage` gera token (`create_professional_invite`); `/convite/:token` → `InviteRegisterPage` → Edge Function `accept-invite` cria a conta.
- **Perfil** → `MyProfilePage` (dados pessoais, avatar com preview, e-mail/senha via Auth, notificações, equipes, desativação).

---

## 3. Erros críticos encontrados

### C-01 — Duas versões conflitantes de `submit_vital_record`; o app chama a versão "antiga" e perde tipo de alerta, notificação e modo homologação
**Arquivos:** `supabase/migrations/0009_drain_photo.sql`, `0018_homologation.sql`, `0008_alerts.sql`; `frontend/src/services/vitalSignsService.ts` (`submitByToken`).
**Problema:** a migration **0009** recriou `submit_vital_record` com **16 parâmetros** (acrescentou `p_has_drain`, `p_drain_photo_path`) e fez `drop` da versão de 14 parâmetros. Depois, a **0018** fez `create or replace` da versão de **14 parâmetros** (que tem `type` do alerta, `is_test` e a chamada `notify_team_of_alert` com o gate de homologação). Como as assinaturas têm **número diferente de argumentos**, o Postgres mantém **as duas funções sobrecarregadas ao mesmo tempo**. O frontend (`submitByToken`) envia **16 argumentos** → resolve para a **versão da 0009**, que:
- **não preenche `clinical_alerts.type`** (fica NULL);
- **não chama `notify_team_of_alert`** → **nenhum `notification_logs` é criado**;
- **não propaga `is_test`** para `vital_sign_records`/`clinical_alerts` (ficam `false` mesmo em paciente de teste);
- **não passa pelo gate de homologação**.
A versão "boa" da 0018 (com tipo/notificação/homologação) só seria atingida por uma chamada de **14 argumentos**, que **nunca acontece**.
**Por que é um problema / impacto:** o WhatsApp de alerta **nunca dispara** pelo fluxo real; o tipo do alerta (Temperatura, Dor…) chega vazio na aba Alertas e em "Meus Atendimentos"; o **modo homologação não bloqueia nada** no caminho real (porque o caminho real nem cria logs); as estatísticas de homologação (`test_alerts`, `whatsapp_*`) ficam zeradas. É a falha mais grave do sistema porque quebra a notificação clínica.
**Risco:** alto (segurança clínica + funcionalidade central de alerta).
**Correção sugerida:** consolidar **uma única** assinatura de `submit_vital_record` (a de 16 argumentos, com dreno) contendo **tipo + `is_test` + `notify_team_of_alert`**, e **`drop`** explícito da outra sobrecarga para não restar duplicidade. Validar que `pg_proc` tem só uma função após o deploy.
**Prioridade:** Crítica.

### C-02 — Cálculo de status clínico divergente e incompleto entre 3 implementações; sinais graves não geram alerta
**Arquivos:** `packages/shared/src/clinical/thresholds.ts` + `status.ts` (motor completo); `supabase/migrations/0009/0018` `submit_vital_record` (SQL simplificado); `supabase/functions/process-vital-record/index.ts` (cópia simplificada).
**Problema:** o status que **de fato é gravado** (RPC `submit_vital_record`) só considera **temperatura, saturação, dor e sangramento**. Ele **ignora pressão arterial, frequência cardíaca, dispneia, vômito, diurese e passos**. Já o motor `@vitalsync/shared` (usado apenas para a **pré-visualização/gráficos**) avalia **todas** as dimensões e com **limiares diferentes**:
- Dor: shared → RED ≥ 9, YELLOW 7–8; RPC → RED ≥ 8, YELLOW ≥ 5. (dor 5–6: shared=GREEN, banco=YELLOW; dor 8: shared=YELLOW, banco=RED).
- Vômito "Sim" deveria ser RED (shared `BINARY_RULES`), mas a RPC **não avalia vômito** → nunca gera alerta.
- Dispneia alta, taquicardia (FC), diurese baixa → **nunca geram alerta** no banco.
**Impacto:** um paciente com vômito, dispneia ou taquicardia importante pode ser classificado **GREEN** e **não gerar alerta nenhum**. O médico vê na tela individual um `statusByVital` (que usa o shared) **diferente** do `overall` gravado. É inconsistência clínica e de dados.
**Risco:** alto (segurança do paciente).
**Correção sugerida:** ter **uma única fonte** de regra. Idealmente o backend (RPC ou Edge Function) calcula o status reusando os mesmos limiares do `@vitalsync/shared` (ou uma tabela/So function espelhando-os exatamente). Enquanto isso, no mínimo, alinhar a RPC para incluir vômito/dispneia/FC/PA/diurese e os limiares corretos de dor.
**Prioridade:** Crítica.

### C-03 — `generate-patient-link` é um stub **sem autenticação/autorização** e expõe o `secure_token` do paciente
**Arquivo:** `supabase/functions/generate-patient-link/index.ts`.
**Problema:** a função recebe `{ patient_id }`, roda com `service_role` e devolve `link` (`/r/<secure_token>`) e `whatsappUrl` **sem validar quem está chamando** (o próprio comentário diz "validar no futuro"). Como a chave `anon` é **pública** (vai no bundle do frontend) e não há checagem de papel/equipe, qualquer pessoa que tenha um `patient_id` (UUID) consegue obter o **token secreto** que dá acesso ao registro do paciente — exatamente o segredo que protege o fluxo anônimo.
**Impacto:** vazamento do `secure_token` → acesso indevido ao formulário/dados do paciente, contornando o gate de CPF.
**Observação:** a função **não é chamada pelo frontend hoje** (o link é montado de outras formas), mas, estando **deployada**, é uma superfície de ataque ativa.
**Correção sugerida:** ou remover a função, ou exigir JWT e validar `is_admin()`/cirurgião responsável/suporte antes de devolver o token. Confirmar `verify_jwt` no `config.toml`.
**Prioridade:** Crítica (segurança).

### C-04 — Gate de CPF do paciente é apenas de UI; as RPCs anônimas são chamáveis direto
**Arquivos:** `supabase/migrations/0002_patient_rpc.sql` (`get_patient_by_token`, `submit_vital_record` com `grant ... to anon`); `frontend/src/pages/VitalsRegisterPage.tsx` (`CpfGate`); `supabase/functions/validate-patient-access/index.ts`.
**Problema:** o "confirme seu CPF" só existe no **frontend**. As RPCs `get_patient_by_token` e `submit_vital_record` têm `grant execute ... to anon` e **só exigem o `secure_token`** — não exigem CPF. Qualquer um com o link pode chamar a RPC direto (sem passar pelo gate nem pelo rate-limit de `public_access_attempts`) e **ler dados do paciente** e **enviar medições**.
**Impacto:** a proteção de CPF (e o rate-limit anti-brute-force) viram "teatro de segurança" na camada de dados. O token é o verdadeiro segredo; o CPF não protege nada de fato.
**Risco:** médio-alto (depende de quão exposto fica o token; ver C-03).
**Correção sugerida:** decidir o modelo. Se o CPF deve ser barreira real, **roteie a leitura e o envio por Edge Function** que valida CPF + rate-limit e **remova o `grant to anon`** das RPCs diretas. Se o token já é suficiente, então assuma isso e simplifique (não prometa segurança de CPF que não existe).
**Prioridade:** Crítica (segurança) / decisão de arquitetura.

### C-05 — Storage `patient-photos`: escrita anônima/autenticada **sem restrição de caminho**
**Arquivos:** `supabase/migrations/0001_init.sql` (`patient_photos_write` p/ authenticated), `0002_patient_rpc.sql` (`patient_photos_anon_write` p/ anon).
**Problema:** as policies de **INSERT** no bucket só checam `bucket_id = 'patient-photos'`, **sem amarrar o prefixo do path ao paciente/equipe**. Qualquer `anon` (com o link) ou qualquer autenticado pode **subir arquivos em qualquer pasta** do bucket (inclusive sobrescrever/poluir a pasta de outro paciente). A leitura foi endurecida por equipe na 0014, mas a **escrita não**.
**Impacto:** upload arbitrário de arquivos, possibilidade de "plantar" foto na pasta de outro paciente, abuso de armazenamento.
**Correção sugerida:** rotear o upload do paciente por Edge Function (service_role) validando o token, ou restringir a policy ao prefixo `{patientId}/` derivado de um token validado. Para autenticados, restringir por equipe.
**Prioridade:** Crítica (segurança/integridade de dados sensíveis de saúde).

### C-06 — Criação de usuário hand-rolled em `auth.users` (frágil) e dois mecanismos divergentes de criação de conta
**Arquivos:** `supabase/migrations/0004_admin_create_doctor.sql`, `0007_admin_users.sql`/`0016` (`admin_create_user`) vs `supabase/functions/accept-invite/index.ts`.
**Problema:** `admin_create_doctor` e `admin_create_user` **inserem manualmente linhas em `auth.users` e `auth.identities`** (montando `encrypted_password`, `identity_data`, tokens vazios etc.). Isso é frágil e acoplado à estrutura interna do GoTrue — mudanças de versão do Supabase Auth (novas colunas obrigatórias, formato de `provider_id`) podem **quebrar logins** ou criar contas inconsistentes. Em paralelo, `accept-invite` faz o **certo** (`admin.auth.admin.createUser`). Ou seja, há **dois caminhos divergentes** para criar conta, um deles arriscado.
**Impacto:** risco de contas que não logam, manutenção perigosa, comportamento inconsistente entre "Gerenciar Usuários" e "Convites".
**Correção sugerida:** migrar `admin_create_user`/`admin_create_doctor` para uma Edge Function usando `auth.admin.createUser` (como o accept-invite), e aposentar a inserção manual.
**Prioridade:** Crítica (manutenção/auth).

### C-07 — `current_status` do paciente reflete só a última medição, não os alertas ativos
**Arquivos:** `submit_vital_record` (`update public.patients set current_status = v_status`); `MonitoringPage.tsx`, `dashboardService.ts`, `teamViewService.ts` (filtram/ordenam por `current_status`).
**Problema:** o status do paciente é sobrescrito a cada envio. Se de manhã foi RED (gera alerta) e à noite GREEN, o paciente vira **GREEN**, **mesmo havendo um alerta RED pendente não atendido**. As telas que filtram "status clínico" usam `current_status` e podem **esconder** um paciente que ainda tem alerta ativo; o dashboard de "críticos" também.
**Impacto:** paciente com alerta em aberto "some" do filtro de status / lista crítica; divergência entre o semáforo do paciente e a existência de alerta pendente.
**Risco:** médio-alto (pode mascarar caso clínico em aberto).
**Correção sugerida:** definir a regra: ou `current_status` considera o pior entre "última medição" e "alertas pendentes", ou as telas combinam `current_status` **com** `hasUnattendedAlert` (como `teamViewService.getPriorityPatients` já faz parcialmente) de forma consistente em todas as telas.
**Prioridade:** Alta.

---

## 4. Erros médios / altos encontrados

### M-01 — Vômito e diurese: o "Sim/Não" é descartado; só a contagem é persistida
**Arquivos:** `frontend/src/components/patient-measurement/SymptomsStep.tsx`, `PatientMeasurementWizard.tsx` (submit), `services/patientDashboardService.ts` (`hadVomit = count>0`, `urinatedNormally = count != null`), schema `vital_sign_records`.
**Problema:** o banco só tem `urination_count` e `vomiting_count` (não há boolean `urinated_normally`/`had_vomit`). No wizard, a contagem é **opcional** quando o paciente responde "Sim". Resultado: paciente que **urinou normalmente mas não digitou a contagem** é gravado com `urination_count = null` e **reconstruído como "não urinou normalmente"** → `evaluateDiuresis` marca **YELLOW** indevidamente. Da mesma forma, "teve vômito = Sim" sem contagem vira `vomiting_count = null` → reconstruído como **sem vômito**.
**Impacto:** classificação de diurese errada (atenção falsa) e perda do dado de vômito.
**Sugestão:** persistir os booleans de fato (colunas próprias) **ou** tornar a contagem obrigatória quando a resposta for "Sim" e tratar `0` corretamente.

### M-02 — Inconsistência UI×backend: Suporte vê ações que o backend recusa
**Arquivos:** `services/supportPermissionService.ts` (`canResendWhatsapp` p/ SUPPORT), `migrations/0008` `alert_resend_notification` (exige `is_admin()` OU `is_main_surgeon_of()`).
**Problema:** a UI habilita "reenviar WhatsApp" ao Suporte, mas a RPC `alert_resend_notification` **rejeita** Suporte. O usuário tenta e recebe erro.
**Impacto:** frustração, "controle e liberdade do usuário" quebrado (heurística de Nielsen: prevenção de erro). **Sugestão:** alinhar UI e RPC (decidir se Suporte pode reenviar; se não, esconder o botão).

### M-03 — Suporte cai em telas vazias por falta de gate de papel em `/dashboard` e `/monitoring`
**Arquivos:** `App.tsx` (rotas `/dashboard` e `/monitoring` sem `roles`), `RoleBasedSidebar.tsx` (menu do Suporte não tem Dashboard), `dashboardService.ts`.
**Problema:** o catch-all `*` redireciona para `/dashboard`, que **não tem restrição de papel**. Um usuário Suporte (cujo menu não inclui Dashboard) acaba numa tela de dashboard que, por RLS, retorna tudo vazio (zeros). Além disso, em `/monitoring` o card do paciente leva a `/patients/:id`, que é barrado ao Suporte → **redireciona de volta para `/dashboard`** (loop confuso).
**Impacto:** experiência inconsistente para o Suporte (telas vazias, cliques que "voltam"). **Sugestão:** definir a "home" do Suporte (ex.: `/monitoring`) e impedir/ocultar Dashboard; tornar os cards de paciente não-clicáveis para Suporte.

### M-04 — `attended` (boolean) e `attendance_status` saem de sincronia no soft delete
**Arquivos:** `migrations/0011` `soft_delete_patient` (seta `attendance_status='IGNORED'` mas **não** `attended=true`), `migrations/0008` `alert_ignore` (seta ambos).
**Problema:** existem **duas noções de "atendido"** usadas em consultas diferentes: `dashboardService` usa `.eq('attended', false)`; `alertService`/`teamViewService` usam `attendance_status`. No soft delete, o alerta fica `IGNORED` **com `attended=false`**, criando um estado misto. Hoje o filtro adicional por `patient.status='ACTIVE'` salva o resultado, mas a inconsistência é uma armadilha para futuras queries.
**Impacto:** risco de contadores divergentes conforme a coluna usada. **Sugestão:** padronizar em `attendance_status` (deprecando `attended`) ou manter os dois sempre em sincronia em **todas** as RPCs.

### M-05 — Faixas de validação de entrada duplicadas e divergentes (wizard × shared)
**Arquivos:** `frontend/src/components/patient-measurement/validation.ts` (`INPUT_RANGES` hardcoded) vs `packages/shared/src/clinical/thresholds.ts` (`INPUT_RANGES`).
**Problema:** o wizard tem suas próprias faixas (ex.: SpO2 70–100, temp 34–42) diferentes das do shared (SpO2 93–100, temp 34–43). O campo `inputRanges` previsto em `lib/dto.ts` (`PatientLinkInfo`) **nem é usado** (a RPC não retorna isso). Há, portanto, **três** referências de faixa (dto, shared, wizard) e só uma vale.
**Impacto:** manutenção: ajustar faixa num lugar não reflete nos outros; validações inconsistentes. **Sugestão:** o wizard deve importar as faixas do `@vitalsync/shared`; remover o `INPUT_RANGES` local e o `inputRanges` morto do dto.

### M-06 — Pressão arterial: limiares clínicos provavelmente invertidos/errados (RED a partir de 120 mmHg sistólica)
**Arquivo:** `packages/shared/src/clinical/thresholds.ts` (`ALERT_THRESHOLDS.bloodPressure`).
**Problema:** as regras marcam **GREEN < 110,9**, **YELLOW 110,9–119,9**, **RED > 119,9**. Uma sistólica **normal de 120 mmHg geraria RED**. Está marcado `PENDING_MEDICAL_VALIDATION = true` (aguardando "Letícia"), mas, como a RPC real **não usa PA** (C-02), hoje isso só afeta o `statusByVital` exibido. Se a PA for ligada ao status sem revisar, vira fonte de alertas falsos em massa.
**Impacto:** potencial de alertas clínicos incorretos. **Sugestão:** confirmar limiares com a equipe médica **antes** de incluir PA no cálculo.

### M-07 — `monitoring_day` sem teto de 10 nas RPCs (diverge do shared)
**Arquivos:** `migrations/0002/0008/0009/0018` (`greatest(1, current_date - discharge + 1)` sem cap), `packages/shared/src/utils.ts` (`monitoringDay` retorna `null` fora de 1..10), `patientDashboardService` (usa `days<=10`).
**Problema:** as RPCs gravam/retornam `monitoring_day` podendo passar de 10 (ex.: "dia 15"), enquanto o util do shared limita a 1..10. `get_patient_by_token` retorna `monitoring_day` sempre ≥ 1 mesmo fora da janela (a janela é controlada à parte por `within_window`).
**Impacto:** rótulos como "Dia 15 de 10" possíveis; pequena incoerência de exibição. **Sugestão:** padronizar o cálculo (idealmente reusar `@vitalsync/shared`).

### M-08 — RLS permite UPDATE direto em `clinical_alerts` e `attendance_confirmations`, contornando as RPCs com guardas
**Arquivos:** `migrations/0001` (`alerts_update`), `0008`/`attendance_rw`.
**Problema:** as policies liberam UPDATE/INSERT direto para membros da equipe. As RPCs (`alert_mark_attended` etc.) impõem regras (observação obrigatória, "1 atendimento por alerta"), mas um cliente poderia **escrever direto** na tabela e burlar essas regras (ex.: marcar `attended=true` sem observação). O app usa as RPCs, mas a porta fica aberta.
**Impacto:** integridade das regras de atendimento depende do cliente se comportar. **Sugestão:** restringir as policies de escrita (ex.: só SELECT por RLS; escrita só via RPC `SECURITY DEFINER`).

### M-09 — `profiles` legível por qualquer autenticado (e-mail/WhatsApp/CRM expostos)
**Arquivo:** `migrations/0001` `profiles_select ... using (true)`.
**Problema:** qualquer usuário logado (inclusive Suporte e qualquer associado) pode **ler todos os perfis**, incluindo `email`, `whatsapp`, `crm`, `specialty`. Os serviços usam isso para resolver nomes em listas, mas a policy expõe muito mais do que nome.
**Impacto:** vazamento de contatos pessoais dos profissionais entre todos os usuários. **Sugestão:** criar uma view/RPC que exponha só `id, name, professional_tag` para leitura ampla e restringir as colunas sensíveis a admin/própria linha.

### M-10 — `process-vital-record` (Edge) é código morto que duplica (e diverge) do cálculo de status
**Arquivo:** `supabase/functions/process-vital-record/index.ts`.
**Problema:** função completa que grava medição + cria alerta, **não chamada pelo frontend** (o app usa a RPC). Mantém uma **quarta** cópia do cálculo de status e não trata dreno/tipo/notificação. Se algum dia for religada por engano, multiplica a divergência da C-02.
**Impacto:** confusão de manutenção, risco latente. **Sugestão:** remover ou marcar claramente como descontinuada.

### M-11 — Surgeon pode ser cirurgião principal de várias equipes (sem regra/constraint)
**Arquivos:** `services/teamService.ts` (`getAvailableMainSurgeons` retorna todos), schema `medical_teams.main_surgeon_id` (sem unicidade).
**Problema:** a regra "1 cirurgião por equipe" **está** garantida (coluna única por equipe). Mas **não há nada impedindo o mesmo cirurgião de liderar N equipes** — o dropdown de cirurgião não filtra quem já lidera equipe. Se a regra de negócio for "um cirurgião lidera no máximo uma equipe", isso está aberto.
**Impacto:** depende da regra pretendida; pode gerar equipes com o mesmo responsável. **Sugestão:** confirmar a regra; se exclusiva, filtrar o dropdown e/ou adicionar constraint/índice único parcial.

### M-12 — `team_members` aceita `role_in_team = 'MAIN_SURGEON'` (dois "cirurgiões" possíveis no nível de dados)
**Arquivos:** schema `team_members.role_in_team` (enum permite MAIN_SURGEON), RLS `members_admin` (cirurgião insere membros).
**Problema:** o cirurgião principal vive em `medical_teams.main_surgeon_id`, mas o enum de `team_members` também permite `MAIN_SURGEON`. O frontend força `ASSOCIATED_DOCTOR` ao adicionar, porém a policy permitiria inserir um segundo "MAIN_SURGEON" como membro. **Impacto:** brecha conceitual para "dois cirurgiões". **Sugestão:** restringir `role_in_team` a associado (check/trigger) ou validar no servidor.

### M-13 — Convites sem unicidade: duplicidade possível
**Arquivos:** `migrations/0017` (`professional_invites` sem unique em email/phone), `professionalInviteService.generate`.
**Problema:** nada impede gerar vários convites para o mesmo e-mail/telefone. O accept valida e-mail/CPF únicos só no momento do aceite. **Impacto:** múltiplos links válidos, confusão. **Sugestão:** opcionalmente impedir convite para e-mail já cadastrado e/ou marcar convites antigos como expirados ao gerar novo.

### M-14 — `dashboardService`/`alertService`/`teamViewService` não filtram `is_test`
**Arquivos:** `services/dashboardService.ts`, `alertService.ts`, `teamViewService.ts`.
**Problema:** pacientes/alertas de teste (homologação) aparecem misturados aos reais em dashboard, alertas e equipes para todos os perfis. Em homologação é o desejado, mas em produção com dados de teste remanescentes polui as métricas reais. **Impacto:** contadores inflados/poluídos. **Sugestão:** filtrar `is_test=false` fora do modo homologação (ou garantir limpeza). Observação: ligado ao C-01, `is_test` nem chega aos registros/alertas hoje.

### M-15 — "Hoje" calculado em fusos diferentes (UTC × local) em vários contadores
**Arquivos:** `dashboardService.ts` (`todayIso = toISOString().slice(0,10)`, UTC) vs `isToday()` (local) em `alertService`/`attendanceService`; `vital_sign_records.record_date default current_date` (fuso do banco).
**Problema:** mistura de "hoje" em UTC, local e do servidor pode causar **off-by-one** perto da meia-noite (medições "de hoje" não contabilizadas, "atendidos hoje" divergente). **Impacto:** contadores levemente errados em horários de virada de dia. **Sugestão:** padronizar o fuso (preferir o do paciente/clínica) em todos os cálculos de data.

### M-16 — `daysSinceDischarge`/`postOpDay` calculam por milissegundos locais (risco de off-by-one por horário)
**Arquivos:** `patientDashboardService.daysSince`, `dashboardService.daysSince`, `teamViewService.postOpDay` vs `@vitalsync/shared` (datas civis em UTC).
**Problema:** há utilitários de data "civil" corretos no shared, mas várias telas recalculam por `Date.now() - new Date(date)` em fuso local, podendo divergir do shared em 1 dia. **Sugestão:** reusar `daysSinceDischarge`/`monitoringDay` do shared.

### M-17 — Foto órfã no Storage quando o envio da medição falha
**Arquivo:** `PatientMeasurementWizard.submit` (faz upload antes da RPC).
**Problema:** as fotos sobem ao Storage **antes** de `submitByToken`. Se a RPC falhar, os arquivos ficam **órfãos** no bucket (sem registro em `vital_sign_records`/`measurement_photos`). **Impacto:** acúmulo de lixo no Storage; sem rotina de limpeza. **Sugestão:** subir após sucesso, ou limpar em caso de falha, ou rotina de GC.

---

## 5. Problemas de UI/UX (heurísticas de Nielsen)

- **U-01 (Visibilidade do status / Feedback):** como o WhatsApp nunca dispara (C-01) e o provedor é "log" simulado (`settingsService.testWhatsApp`), as telas que sugerem "notificação enviada" passam uma confiança falsa. *Heurística: visibilidade real do estado do sistema.*
- **U-02 (Consistência):** dois rótulos "Minhas Equipes" para coisas diferentes — cirurgião (`/my-team`, singular, gestão) e associado (`/my-teams`, leitura) — ambos chamados "Minhas Equipes"/"Equipes" no menu. *Heurística: consistência e padrões.*
- **U-03 (Prevenção de erro):** botões habilitados que o backend recusa (M-02, Suporte reenviar WhatsApp). *Heurística: prevenção de erros.*
- **U-04 (Reconhecer > lembrar):** os dropdowns de cirurgião/associado em equipes podem ficar longos com muitos profissionais; mitigado por mostrar **tag + e-mail**, mas sem busca interna pode cansar. *Heurística: reconhecimento.*
- **U-05 (Mensagens de erro):** boa parte usa mensagens humanas (ótimo), mas erros crus do Postgres/PostgREST ainda vazam quando `translateError` não cobre o caso (`teamService`, `userService`). *Heurística: mensagens claras.*
- **U-06 (Controle/Liberdade):** Suporte navega para telas vazias e cliques que "voltam" (M-03). *Heurística: controle do usuário.*
- **U-07 (Status do sistema):** o tipo do alerta vem vazio (C-01) → a aba Alertas e "Meus Atendimentos" exibem "—"/genérico onde deveria aparecer "Temperatura/Dor", reduzindo a clareza.
- **U-08 (Minimalismo):** o filtro "kind" (real/teste/ambos) aparece para todos os perfis no monitoramento, mesmo fora de homologação — ruído para o usuário comum.

---

## 6. Problemas mobile / responsividade

Observação geral: o app demonstra **cuidado real com mobile** — `Layout` tem drawer `lg:hidden`, bottom-nav fixa com `pb-16` no conteúdo, `useBreakpoint`/`Responsive` para render condicional, e os componentes de foto/preview usam `max-w-full`, `truncate`, `object-contain` para não estourar. Os pontos a verificar:

| Tela | Largura de risco | Elemento causador | Sugestão |
|---|---|---|---|
| Bottom-nav (Suporte) | 320–360px | `grid-cols-4` com poucos itens (Suporte tem só Monitoramento + Perfil) deixa colunas vazias | ajustar colunas ao nº de itens por perfil |
| Tabelas/listas densas (UsersPage, TeamsPage, AlertsPage) | 320–375px | linhas com muitas colunas/ações | confirmar que viram cards no mobile (parte já usa cards) e que `ProfessionalTag`+nome não forçam scroll lateral |
| Gráficos do acompanhamento (`charts.tsx`, `PatientDashboardPage`) | 320–390px | largura mínima de eixos/labels | garantir container `w-full` com `overflow-x` controlado, não estourar o card |
| Modais grandes (cadastro em wizard de 3 etapas / edição de paciente / equipe) | 320–375px | conteúdo alto + teclado virtual | confirmar `max-h`/scroll interno do modal e que botões fixos não cobrem campos |
| Settings/Homologação (`SettingsPage`, 748 linhas) | 360–430px | seções com grids `sm:grid-cols-*` | validar que em `base` tudo empilha (a maioria usa `sm:` corretamente) |
| Dropdowns de seleção (cirurgião/associado, status) | 375–430px | listas longas | usar combobox com busca; itens com `truncate` |

> Não foi possível medir pixel a pixel sem rodar o app; os itens acima são os **pontos de inspeção prioritários**. O código sugere baixo risco de scroll lateral, mas tabelas administrativas e gráficos são os candidatos mais prováveis a quebrar em ≤ 360px.

---

## 7. Problemas de regras de negócio

- **Equipe:** "1 cirurgião por equipe" OK; "cirurgião em ≤ 1 equipe" **não** garantido (M-11); brecha de 2º cirurgião via `team_members` (M-12).
- **Cirurgião/Associado:** cadastro de paciente exige ser **cirurgião responsável da equipe** (validado na Edge Function — correto); associado não cadastra (OK).
- **Paciente:** exclusão é **soft delete** com silenciamento de alertas (OK); dados clínicos preservados (OK). `current_status` não reflete alerta ativo (C-07).
- **Alerta:** geração só YELLOW/RED (OK), mas com critérios incompletos (C-02); tipo do alerta perdido (C-01); cada medição não-verde cria **novo** alerta sem fechar o anterior → podem se acumular múltiplos pendentes para o mesmo paciente (o "alerta atual" da tela individual é o **mais recente**; alertas antigos pendentes podem ficar "esquecidos" fora da aba Alertas).
- **Atendimento:** regra "1 atendimento/médico por alerta" bem feita na RPC `alert_mark_attended` (lock + checagem); **novo alerta libera novo atendimento** porque a tela individual usa o alerta mais recente (✔). Mas a RLS deixa burlar por escrita direta (M-08).
- **Convite:** papel correto (só MAIN_SURGEON/ASSOCIATED_DOCTOR); equipe **opcional** (✔, não exige equipe — bom); duplicidade possível (M-13); telefone/e-mail validados no aceite (✔).
- **Perfil:** usuário não altera própria role/status (trigger `protect_profile_privileged_fields` + `protect_last_admin` — ✔); avatar com preview e upload só ao salvar (✔); telefone pode ser apagado (✔, vira `null`); tag única garantida por índice + trigger (✔).

---

## 8. Problemas de dados / Supabase

- **D-01 (duplicação de funções):** sobrecargas conflitantes de `submit_vital_record` (C-01) — o achado mais grave do banco.
- **D-02 (regra no banco ≠ regra no app):** cálculo de status simplificado nas RPCs vs motor completo no shared (C-02).
- **D-03 (RLS aberta):** `profiles_select using(true)` (M-09); escrita direta em alertas/atendimentos (M-08); escrita irrestrita no bucket (C-05).
- **D-04 (mapeamento de papéis espalhado):** `ROLE_MAP` (AuthContext), `roleKey()` (MyProfilePage), `ROLE_LABEL` (exportService/profile), `ROLE_LABEL_PT` (profile) — **quatro** versões do mesmo de-para `ADMIN↔ADM`. Risco de divergência.
- **D-05 (numeração de migration):** o próprio 0018 documenta a colisão histórica de prefixo `0010` (havia dois). A renomeação resolveu o `db push`, **mas** introduziu a sobrecarga não intencional (C-01). Sinal de processo de migrations frágil.
- **D-06 (constraints faltando):** sem unicidade de cirurgião por equipe (M-11); sem unicidade de convite (M-13); `role_in_team` permite MAIN_SURGEON (M-12).
- **D-07 (Edge Functions órfãs):** `process-vital-record`, `generate-patient-link`, `export-data`, `send-whatsapp-alert`, `whatsapp-webhook` **não são chamadas pelo frontend**. `send-whatsapp-alert` depende de um Database Webhook + de `notification_logs` PENDING que **nunca** são criados no caminho real (C-01) → WhatsApp inativo de ponta a ponta.
- **D-08 (off-by-one de datas):** mistura UTC/local (M-15, M-16).

---

## 9. Código duplicado ou fora de padrão

- **Backend Fastify/Prisma inteiro (`backend/`)** + `lib/api.ts` + `lib/admin-api.ts` (mock em memória) + `lib/teams-api.ts` (mock em memória) + `lib/teams-types.ts` → **código morto/legado** não usado pelo app real (só `fetchProtectedImage` é referenciado, num caminho que nunca dispara porque as fotos já vêm como URL assinada).
- **Cálculo de status duplicado em 4 lugares** (shared, RPC 0009, RPC 0018, edge `process-vital-record`) com divergências (C-02/M-10).
- **Faixas de entrada duplicadas** (wizard vs shared vs dto morto) (M-05).
- **De-para de papéis em 4 lugares** (D-04).
- **`pickVital`/seleção do "sinal que disparou" reimplementada** em `dashboardService` e na RPC (`v_type`) com critérios próprios.
- **`AuthUser.teamId` sempre `null`** (campo do dto nunca preenchido) — morto.
- **`fetchProtectedImage`/`useProtectedImage`** mantêm caminho para o backend Fastify que não existe em produção.

---

## 10. Sugestões de melhoria por prioridade

**Urgente (corrigir antes de uso clínico real):**
1. Resolver a sobrecarga de `submit_vital_record` (C-01).
2. Unificar e completar o cálculo de status clínico (C-02).
3. Fechar `generate-patient-link` e o gate de CPF (C-03, C-04).
4. Restringir escrita no Storage de fotos (C-05).
5. Decidir e consertar `current_status` vs alertas ativos (C-07).

**Importante:**
6. Migrar criação de usuário para `auth.admin.createUser` (C-06).
7. Persistir corretamente vômito/diurese (M-01).
8. Alinhar permissões UI×backend (M-02) e a "home"/acessos do Suporte (M-03).
9. Endurecer RLS de `profiles` e de escrita em alertas/atendimentos (M-08, M-09).
10. Padronizar fuso/datas (M-15, M-16) e `monitoring_day` (M-07).

**Melhoria visual:**
11. Rótulos de menu consistentes (U-02), esconder filtro de teste fora de homologação (U-08), exibir tipo de alerta (depende de C-01).
12. Inspeção mobile das tabelas administrativas e gráficos (seção 6).

**Melhoria futura:**
13. Remover backend Fastify/mocks/edge functions órfãs (seção 9) **ou** assumir e documentar a arquitetura única (Supabase).
14. Centralizar o de-para de papéis (D-04) e as faixas/limiares no `@vitalsync/shared`.
15. Constraints de unicidade (cirurgião/equipe, convite) (D-06).

---

## 11. Plano seguro de correção (ordem recomendada, etapas pequenas)

> Premissa: cada etapa em branch própria, com teste antes de seguir. Nada aqui foi aplicado.

**Etapa 1 — Notificação/medição (C-01).**
Corrigir: consolidar uma única `submit_vital_record` (16 args, com dreno + tipo + `is_test` + `notify_team_of_alert`) e dropar a sobrecarga.
Arquivos: nova migration `00xx_fix_submit_vital_record.sql`; conferir `vitalSignsService.ts`.
Risco: médio (mexe em fluxo central). Testar: enviar medição YELLOW/RED de paciente real e de teste; verificar `clinical_alerts.type`, `is_test`, e linhas em `notification_logs`.

**Etapa 2 — Cálculo de status (C-02).**
Corrigir: alinhar a RPC ao motor do shared (incluir vômito/dispneia/FC/PA/diurese e limiares de dor). Decidir PA com a equipe médica (M-06).
Arquivos: migration da RPC; opcionalmente `thresholds.ts`.
Risco: médio-alto (clínico). Testar: matriz de casos por dimensão comparando `overall` gravado × `statusByVital` do shared.

**Etapa 3 — Segurança do link do paciente (C-03, C-04, C-05).**
Corrigir: remover/proteger `generate-patient-link`; decidir o modelo do gate de CPF; restringir policies de escrita do bucket.
Arquivos: edge functions + migration de Storage policies.
Risco: médio. Testar: tentar acessar token/enviar medição sem CPF; tentar upload em pasta de outro paciente (deve falhar).

**Etapa 4 — Status do paciente × alertas (C-07).**
Corrigir: definir regra (pior status, ou combinar com `hasUnattendedAlert` em todas as telas).
Arquivos: RPC e/ou `MonitoringPage`, `dashboardService`, `teamViewService`.
Risco: médio. Testar: manhã RED + noite GREEN → paciente continua sinalizado enquanto alerta pendente.

**Etapa 5 — Criação de usuário (C-06).**
Corrigir: Edge Function com `auth.admin.createUser`; aposentar inserção manual.
Risco: médio (auth). Testar: criar usuário e logar; trocar e-mail/senha; convite continua funcionando.

**Etapa 6 — Dados de sintomas (M-01) e datas (M-07/M-15/M-16).**
Corrigir: colunas booleanas (ou contagem obrigatória) para vômito/diurese; centralizar datas no shared.
Risco: baixo-médio. Testar: "urinou normalmente sem contagem" não vira YELLOW; "hoje" estável na virada do dia.

**Etapa 7 — RLS e permissões (M-02, M-03, M-08, M-09).**
Risco: médio. Testar por perfil (Admin/Cirurgião/Associado/Suporte): leitura de `profiles`, escrita direta bloqueada, telas coerentes.

**Etapa 8 — Limpeza (seção 9) e constraints (D-06).**
Risco: baixo (remoção de morto) a médio (constraints com dados legados). Testar build + smoke test completo.

---

## 12. Checklist de testes recomendado

**Autenticação/perfis**
- [ ] Login Admin/Cirurgião/Associado/Suporte → redireciona para tela coerente com o menu.
- [ ] Acesso indevido: Suporte tentando `/patients/:id`, `/alerts`, `/admin/*` → bloqueado.
- [ ] Trocar e-mail/senha; "sair de todos os dispositivos".
- [ ] Usuário não consegue alterar a própria role/status; último admin não pode se rebaixar.

**Paciente**
- [ ] Cadastro com CPF (Edge Function), unicidade de CPF, paciente de teste marcado.
- [ ] Edição (cirurgião só da própria equipe; troca de equipe só Admin).
- [ ] Soft delete: paciente some das listas/dashboard/alertas; dados preservados; restore (Admin).

**Monitoramento (link)**
- [ ] Gate de CPF: bloqueio após 5 tentativas; paciente legado sem hash; fora da janela de 10 dias.
- [ ] Envio com **dreno = não** → não pede foto do dreno; **dreno = sim** → pede as duas fotos.
- [ ] "Urinou normalmente = sim sem contagem" → **não** deve marcar diurese YELLOW (após M-01).
- [ ] Vômito = sim → deve refletir no status (após C-02).
- [ ] Medição RED/YELLOW → cria alerta com **tipo** correto e gera `notification_logs` (após C-01).

**Alertas/atendimento**
- [ ] Alerta atendido some do dashboard e dos "alertas recentes"; badge da sidebar diminui.
- [ ] Dois médicos não atendem o mesmo alerta; novo alerta do mesmo paciente libera novo atendimento.
- [ ] Alerta de paciente excluído não aparece; alerta sem paciente não quebra a lista.
- [ ] Contadores (pendentes, atendidos hoje, falhas) batem entre dashboard e aba Alertas.

**Equipes/convites**
- [ ] Não permitir 2º cirurgião na equipe; adicionar/remover associado; busca por nome/tag.
- [ ] Tag única aparece para todos os profissionais (inclusive antigos via backfill).
- [ ] Convite com e sem equipe; aceite cria conta com papel certo; convite expirado/usado recusado.

**Perfil**
- [ ] Avatar: preview antes de salvar; troca reflete na sidebar (refreshUser) e em "Gerenciar Usuários".
- [ ] Máscara de telefone: digitar e **apagar tudo** deixa o campo vazio (sem "(" preso).

**Mobile (320/360/375/390/412/430px)**
- [ ] Sem scroll lateral em Dashboard, Monitoramento, Alertas, Acompanhamento, Equipes, Perfil, Configurações.
- [ ] Bottom-nav não cobre conteúdo; gráficos e modais não estouram o card; tabelas viram cards.

**Banco/segurança (técnico)**
- [ ] `select proname, pronargs from pg_proc where proname='submit_vital_record'` → **uma** função (após C-01).
- [ ] Tentar `submit_vital_record`/`get_patient_by_token` direto como anon sem CPF → política definida (após C-04).
- [ ] Tentar upload no bucket em pasta alheia → negado (após C-05).
- [ ] `generate-patient-link` sem auth → negado/removido (após C-03).

---

### Apêndice — Pontos verificados que estão CORRETOS (para não "consertar o que não está quebrado")
- Foto do dreno **só** é exigida quando o paciente marca que possui dreno (`validatePhotos`/`PhotosStep`) — **sem** o bug relatado de obrigatoriedade indevida.
- Avatar usa **preview** local e só faz upload **ao salvar** (sem "upload antes de salvar"); remoção e troca limpam o arquivo anterior.
- Telefone pode ser apagado (vira `null`); regra de 10–11 dígitos só quando preenchido.
- Tag do profissional: unicidade garantida por **índice único** + trigger no banco (não depende do frontend); backfill cobre usuários antigos.
- "1 atendimento por alerta" e "novo alerta libera novo atendimento" implementados corretamente (lock + alerta mais recente).
- Soft delete silencia alertas pendentes (IGNORED) e as listas filtram paciente inativo.
