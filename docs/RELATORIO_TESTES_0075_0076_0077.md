# Relatório de testes — 0075 / 0076 / 0077

**Escopo:** validação E2E das migrations **0075** (regras clínicas editáveis), **0076** (enfermagem como papel de equipe) e **0077** (roteamento do alerta amarelo + escalada pela enfermagem).
**Ambiente:** Supabase LOCAL (Docker, `supabase_db_VitalSync`), frontend Vite em `localhost:5173` apontando para `127.0.0.1:54321` via `frontend/.env.development.local`.
**Data:** 25/08/2026 · **Migrations aplicadas:** 0001 → 0077.

## Veredito

| Bloco | Resultado |
|---|---|
| **A — Enfermagem como papel de equipe (0076)** | ✅ **GO** — A1–A8 PASS |
| **B — Roteamento do alerta amarelo (0077)** | ✅ **GO** — B1–B6 PASS |
| **C — Escalada amarelo → vermelho (0077)** | ✅ **GO** — C1–C7 PASS |
| **D — Regras clínicas editáveis (0075)** | ✅ **GO** — D1–D6 PASS |
| **E — Regressão + integração de front** | ✅ **GO** — E1–E4 PASS (E3 corrigido, ver [correção](#correção-do-e3-severidade-efetiva-no-front)) |

**Conclusão:** **28 de 28 itens PASS — aprovado para deploy.** O banco roteia, autoriza e classifica exatamente como especificado.

A primeira passada reprovou um item de E3 (a tela **Alertas** do médico listava os amarelos da enfermagem como pendência acionável, e o alerta escalado era visualmente idêntico a um amarelo comum). **Isso foi corrigido no front** e revalidado — o detalhe da correção e as evidências estão em [Correção do E3](#correção-do-e3-severidade-efetiva-no-front).

---

## Premissas assumidas

1. **`docs/RELATORIO_TESTES_PILOTO.md` não existe no repositório.** Usei o formato descrito no prompt (go/no-go por item, com evidência) em vez de espelhar um arquivo inexistente.
2. **`supabase db reset` não foi executado** (regra permanente: nunca destruir auth nem pacientes). O teste de "migrations aplicam limpas do zero" (E2) rodou em um **container descartável** `supabase/postgres:17.6.1.127`, com os schemas de plataforma (`auth`, `storage`) copiados do banco vivo — mais forte que um reset, e com risco zero para os dados locais.
3. **Caminho real de lançamento = `submit_vital_record`** (caminho do paciente, via `secure_token`). `staff_insert_vital_record` exige janela de horário (`MORNING` ≥ 10:00 / `NIGHT` ≥ 20:00 em America/São_Paulo) e a rodada correu entre 04:15 e 04:45 SP. **As duas funções chamam a mesma `notify_team_of_alert`**, então o roteamento testado é idêntico; o que não foi exercido é só o gate de horário da função da equipe.
4. **Senhas locais restauradas para `senha123`** via o script do próprio projeto (`supabase/_scripts/fix_login.ps1`) para os usuários-semente, e por SQL equivalente para `gerente@` e `enf@`. É o estado documentado no `seed.sql`, não uma alteração de comportamento.

## Fora do escopo local (só testável em staging)

| Item | Por quê |
|---|---|
| Envio real de WhatsApp | O banco local **não tem os secrets no Vault**: toda tentativa de disparo devolve `WARNING: send-whatsapp-alert não disparado: configure os secrets project_url/service_role_key no Vault`, e o `supabase_edge_runtime` está parado. Isso é a garantia física de **0 envios reais** nesta rodada. |
| `pg_cron` em horário real | Os 10 jobs estão `active`, mas as janelas são diárias. O sweep de 8h foi exercido chamando `reoffer_expired_alerts()` manualmente sobre um alerta envelhecido (C7). |
| Gate de horário de `staff_insert_vital_record` | Ver premissa 3. |

---

## Bloco A — Enfermagem como papel de equipe (0076)

| Item | Resultado | Evidência |
|---|---|---|
| **A1** Admin adiciona enfermeiro | ✅ PASS | Sessão `authenticated` com `sub` do admin; `insert into team_members (equipe 2, Enf. Xavier, NURSING_PROFESSIONAL)` → `INSERT 0 1`. Consulta confirma `role_in_team='NURSING_PROFESSIONAL'`, `status='ACTIVE'`. |
| **A2** Gerente adiciona **dois** enfermeiros | ✅ PASS | Sessão do gerente: `is_team_manager()=t`, `is_team_manager_of(equipe1)=t`; insert de Yara + Zeca → `INSERT 0 2`, ambos ativos. |
| **A3** Papel sem permissão não adiciona | ✅ PASS | Sessão do médico associado (Bruno) → `ERROR: new row violates row-level security policy for table "team_members"`. |
| **A4** Constraint aceita os dois papéis, barra `MAIN_SURGEON` | ✅ PASS | Sobrou **uma** check constraint: `team_members_role_allowed_chk CHECK (role_in_team::text = ANY (ARRAY['ASSOCIATED_DOCTOR','NURSING_PROFESSIONAL']))` — as duas antigas sumiram. Insert com `MAIN_SURGEON` → `ERROR: violates check constraint "team_members_role_allowed_chk"`. |
| **A5** Gambiarra desfeita | ✅ PASS | `select count(*) ... where p.role='NURSING_PROFESSIONAL' and m.role_in_team='ASSOCIATED_DOCTOR'` → **0**. Todos os 4 vínculos de enfermagem estão com o papel correto. |
| **A6** Teto de 10 ignora enfermagem | ✅ PASS | Equipe 1 com 4 membros ativos (1 associado + 3 enfermeiros): `count_associated_doctors()` → **1**. Confirmado também na UI do gerente: "Médicos associados **1/10**". |
| **A7** `team_active_nurses` + conta desativada | ✅ PASS | Retorna os 3 enfermeiros. Ao pôr `profiles.status='INACTIVE'` na Enf. Zeca → **2**; ao reativar → **3**. |
| **A8** Aviso de inclusão na equipe | ✅ PASS | `after_team_member_added` gerou, para cada enfermeiro, "Você foi adicionado à Equipe nº 1" + avisos ao cirurgião responsável e ao gerente (`template_name='membro_adicionado_equipe'`, `channel='internal'` — não passa por WhatsApp). |

## Bloco B — Roteamento do alerta amarelo (0077)

Cenário montado: **Equipe 1** (cirurgiã Ana + associado Bruno + 3 enfermeiros), **Equipe 2** (cirurgião Carlos + Enf. Xavier), **Equipe 3** (cirurgião Diego, **sem** enfermeiro), **Equipe 4** (cirurgião **inativo**, sem membros), **pool** cobrindo o Hospital São Lucas com Enf. Pool, e um **hospital sem pool**. Todos os pacientes `is_test = true`.

Resultado consolidado (uma linha por destinatário; `submit_vital_record` a 37,8 °C → YELLOW e 38,9 °C → RED):

```
        paciente             | severidade |     destinatário      | via_enfermagem |       envio
-----------------------------+------------+-----------------------+----------------+-------------------
 P01 Equipe1 H1              | YELLOW     | Enf. Yara             | t              | SKIPPED_TEST_MODE
 P01 Equipe1 H1              | YELLOW     | Enf. Zeca             | t              | SKIPPED_TEST_MODE
 P01 Equipe1 H1              | YELLOW     | enf                   | t              | SKIPPED_TEST_MODE
 P01 Equipe1 H1              | RED        | Dr. Bruno Tavares     | f              | SKIPPED_TEST_MODE
 P01 Equipe1 H1              | RED        | Dra. Ana Souza        | f              | SKIPPED_TEST_MODE
 P02 Equipe2 H1              | YELLOW     | Enf. Xavier           | t              | PENDING
 P03 Equipe1 H2pool          | YELLOW     | Enf. Pool             | t              | PENDING
 P03 Equipe1 H2pool          | YELLOW     | Enf. Yara/Zeca/enf    | t              | SKIPPED_TEST_MODE
 P04 Equipe3 H2pool          | YELLOW     | Enf. Pool             | t              | PENDING
 P05 Equipe3 SemPool         | YELLOW     | Dr. Diego Moura       | f              | PENDING
 P06 Equipe4 SemNinguem      | YELLOW     | (nenhum)              |                |
```

| Item | Resultado | Evidência |
|---|---|---|
| **B1** Amarelo só para enfermagem | ✅ PASS | P01/YELLOW → exatamente os 3 enfermeiros da equipe, `recipient_is_nurse=true`. **Nenhum médico** na leva. |
| **B2** Isolamento por equipe | ✅ PASS | P02 (equipe 2) → **só** Enf. Xavier. Os 3 enfermeiros da equipe 1 **não** receberam. |
| **B3** Equipe **∪** pool | ✅ PASS | P03 (equipe 1 @ hospital coberto por pool) → 3 enfermeiros da equipe **+** Enf. Pool = 4 destinatários (a união soma). P04 (equipe **sem** enfermeiro @ mesmo hospital) → **só** Enf. Pool, provando que a via de pool funciona sozinha. |
| **B4** Fallback sem enfermeiro | ✅ PASS | P05 → `Dr. Diego Moura`, `recipient_is_nurse=false`, + `audit_logs`: `YELLOW_NO_NURSE_FALLBACK — Alerta amarelo … sem enfermeiro na equipe nem no pool do hospital: roteado para 1 médico(s) da equipe.` |
| **B5** Nenhum destinatário → auditado | ✅ PASS | P06 → **0 linhas** em `notification_logs`; dois registros em `audit_logs`: `YELLOW_NO_NURSE_FALLBACK` (0 médicos) seguido de `ALERT_NO_RECIPIENT (severidade efetiva YELLOW)`. A cascata é visível, nunca silenciosa. |
| **B6** Vermelho só para médicos | ✅ PASS | P01/RED (38,9 °C) → Ana + Bruno, `recipient_is_nurse=false`. **Nenhum enfermeiro** recebeu o vermelho automático. |

> **Gate de homologação verificado nos dois sentidos:** Enf. Xavier e Enf. Pool tinham números na whitelist → `PENDING`; os demais → `SKIPPED_TEST_MODE` com a mensagem de bloqueio. Todas as linhas com `is_test = true`.

## Bloco C — Escalada amarelo → vermelho (0077)

| Item | Resultado | Evidência |
|---|---|---|
| **C1** Enfermeira escala | ✅ PASS | `alert_escalate_to_red(P07, 'Paciente relatou piora da dor e febre persistente.')` pela enfermeira `enf`. Depois: `status` **continua `YELLOW`**; `escalated_at/by/reason` preenchidos; `attendance_status` volta a `PENDING`; **nova leva** em `notification_logs` às 07:19:01 para Ana + Bruno (`recipient_is_nurse=false`); `attendance_confirmations` com `status='ESCALATED'`. |
| **C2** Motivo obrigatório | ✅ PASS | Motivo `'   '` → `ERROR: Descreva por que este caso precisa do médico.` |
| **C3** Autorização | ✅ PASS | Médico associado → `Apenas o profissional de enfermagem escala um caso para o médico.`; **cirurgião responsável** → mesma mensagem; **admin** → mesma mensagem; **gerente** → `MANAGER_READ_ONLY` (código que o front já trata). |
| **C4** Idempotência | ✅ PASS | Segunda escalada do mesmo alerta, por **outra** enfermeira → `Este alerta já foi escalado para o médico.` `notification_logs` permanece em **5** linhas (antes e depois) e há **1** único evento `ESCALATED`. |
| **C5** Só amarelo, não finalizado | ✅ PASS | Alerta `RED` → `Só alertas amarelos são escalados pela enfermagem. Vermelhos já são do médico da equipe.` Alerta finalizado via `alert_mark_attended` → `Este alerta já foi finalizado.` |
| **C6** Lock | ✅ PASS | Yara trava (`alert_set_in_analysis`); `enf` tenta escalar → `Este alerta está em análise por outro profissional.` A **dona do lock** escala normalmente, e o alerta sai com `in_analysis_by` nulo e `attendance_status='PENDING'`. |
| **C7** Rede de segurança de 8h intacta | ✅ PASS | Job `nurse-queue-sweep` (`*/2 * * * *`, `active=t`) executa `reoffer_expired_alerts()`, que **grava `escalated_at` diretamente** — não passa por `alert_escalate_to_red`, logo a guarda `is_nurse()` não a quebra. Prova funcional: alerta envelhecido para 9h → sweep retornou 1, resultando em `escalated_by = NULL`, `auto_escalated = true`, motivo "Escalonamento automático por tempo… limite de 8h", e nova leva de notificação para os **médicos** (severidade efetiva RED). |

## Bloco D — Regras clínicas editáveis (0075)

| Item | Resultado | Evidência |
|---|---|---|
| **D1** Leitura ampla, escrita só admin | ✅ PASS | Enfermeira e médico leem as 8 métricas. `update` direto na tabela como `authenticated` → `ERROR: permission denied for table clinical_threshold_settings` (sem policy de escrita). RPC por não-admin → `Apenas o Administrador pode alterar as regras clínicas.` |
| **D2** Nenhum valor mudou por padrão | ✅ PASS | Bateria de **44 bordas** via `classify_by_bands` → **44 ok / 0 divergentes**, cobrindo as 8 métricas (temperatura 37,79→GREEN, 37,8→YELLOW, 38,4→YELLOW, 38,5→RED; SpO2 94,01→GREEN, 94→YELLOW, 92→RED; PA sistólica/diastólica nas 5 faixas; FC 110/111/119/120; diurese; dor; dispneia). As faixas semeadas batem **texto a texto** com `ALERT_THRESHOLDS`. Confirmado também pelo caminho real (37,8 → YELLOW, 38,9 → RED). |
| **D3** Validação recusa faixa ruim | ✅ PASS | (a) status inválido → `A faixa 1 tem um status inválido (use Verde, Amarelo ou Vermelho).` (b) buraco → `As faixas deixam valores sem classificação (por exemplo, 7). Cubra todo o intervalo de 0 a 10 sem buracos.` (c) inalcançável → `A faixa 2 nunca será aplicada: uma faixa anterior já cobre todos os valores dela.` (d) falta status → `Faltam faixas para: Vermelho. Toda métrica precisa ter as três faixas…` (bônus) min>max → `Na faixa 1 o mínimo é maior que o máximo.` |
| **D4** Edição muda a classificação ao vivo | ✅ PASS | Admin muda temperatura para `GREEN ≤36,9 / YELLOW 37,0–37,4 / RED ≥37,5`. Novo lançamento real com **os mesmos 37,8 °C** que antes davam YELLOW→enfermagem passa a dar **RED → Ana + Bruno** (`recipient_is_nurse=false`). Auditado: `SETTINGS_CHANGE — Regra clínica "Temperatura": Verde ≤ 37.79 · … → Verde ≤ 36.9 · …`. **Default restaurado** e reconfirmado por novo lançamento (37,8 → YELLOW → 3 enfermeiros). |
| **D5** Métrica não editável | ✅ PASS | `steps` e `waterIntake` → `A métrica "…" não é editável por esta tela (regra definida em código).` A tela reforça o mesmo: passos, vômito e sangramento aparecem com o selo **DEFINIDO EM CÓDIGO**. |
| **D6** `pending_validation` | ✅ PASS | As 8 métricas espelham fielmente o TS (todas com `PENDING_MEDICAL_VALIDATION: false` hoje). Marcando `dyspnea` como pendente: `get_clinical_thresholds()` devolve a flag + nota, `classify_by_bands` segue 0→GREEN/1→YELLOW/2→RED e um lançamento real com dispneia=1 gerou YELLOW normalmente. Revertido. |

## Bloco E — Regressão automatizada + integração de front

### E1 — Automatizados ✅ PASS

Após a correção do E3: `@vitalsync/shared`: **104 testes / 3 arquivos** ✔ · `@vitalsync/frontend`: **195 testes / 13 arquivos** ✔ (eram 175/12 — a correção trouxe `alertSeverity.test.ts` com 20 casos) · `typecheck` limpo ✔ · `npm run build` (shared + backend legado + frontend) ✔.

### E2 — Migrations do zero ✅ PASS

As **77 migrations (0001 → 0077)** aplicaram em sequência, sem erro, em container limpo.
O **bloco de guarda da 0075 foi provado vivo**: rodado sobre as faixas intactas, passa em silêncio; após corromper a faixa de temperatura, aborta com
`ERROR: 0075 REGRESSÃO CLÍNICA: eval_clinical_status mudou de comportamento → temperature=37.8 deu GREEN (esperado YELLOW); …`

### E3 — Checklist manual de UI

| Verificação | Resultado | Evidência |
|---|---|---|
| **Gerenciar Equipes** — seção de enfermagem para **admin** | ✅ PASS | Seção **"Enfermagem da Equipe (3)"**, separada de "Médicos Associados (1)", com listagem, botão de remover por linha e combobox "Adicionar profissional de enfermagem". |
| …busca traz só `NURSING_PROFESSIONAL` | ✅ PASS | O combobox listou apenas Enf. Pool e Enf. Xavier, ambos rotulados "Profissional de Enfermagem" — nenhum médico, e sem repetir os já vinculados. |
| **Equipes Vinculadas** — mesma seção para o **gerente** | ✅ PASS | Drawer "Equipe nº 01" com "Enfermagem da equipe (3)", remover e adicionar. Em "Integrantes da Equipe" o enfermeiro aparece com selo **ENFERMAGEM**. Contador "Médicos associados **1/10**" confirma que enfermagem não consome vaga. |
| **NurseTriage** — botão "Escalar" só para enfermeiro, com confirmação + motivo | ✅ PASS | A fila da enfermagem mostrou exatamente os **5 amarelos não escalados** da equipe (nenhum vermelho, e os já escalados ausentes). Após "Assumir", surge **Escalar**; o modal avisa que "a classificação clínica do alerta **não muda**"; submeter vazio → `Descreva por que este caso precisa do médico.` |
| …após escalar, some da fila da enfermagem e vai para os médicos | ✅ PASS | Escalada feita **pela UI**: o alerta saiu de "EM ANÁLISE POR MIM" (→0) e **não** voltou para "FILA ABERTA" (segue em 4). No banco: `status` = `YELLOW`, `escalado_por` = `enf`, `auto_escalated` = `f`, e nova leva de `notification_logs` para Ana + Bruno com `recipient_is_nurse=false`. |
| **Configurações → Regras Clínicas** (admin) | ✅ PASS | Editor de faixas completo (status, mínimo, máximo, reordenar, remover, adicionar) + diálogo de confirmação que pré-visualiza a nova faixa. Faixa ruim → toast com a **mensagem crua do banco**: *"Na faixa 2 o mínimo é maior que o máximo."*, e o banco **não muda** (verificado). Faixa boa → *"Regra de «Temperatura» atualizada. Vale para as próximas medições."* |
| **Médico não vê o amarelo como pendência acionável; passa a vê-lo (como vermelho) só após a escalada** | ❌ FAIL na 1ª passada → ✅ **PASS após correção** | Diagnóstico abaixo; correção e revalidação em [Correção do E3](#correção-do-e3-severidade-efetiva-no-front). |

#### ❌ E3 (1ª passada) — o médico continuava vendo (e podendo agir sobre) todos os amarelos

Logada como **Dra. Ana Souza** (cirurgiã responsável), a tela **Alertas** mostrou os cards de resumo `14 Todos · 4 Vermelhos · 10 Amarelos` e listou **todos** os amarelos da equipe com selo `ATENÇÃO / PENDENTE` e os botões **"Em análise"** e **"Atender"** ativos — inclusive os que a 0077 roteou exclusivamente para a enfermagem.

Pior: **o alerta já escalado é visualmente idêntico a um amarelo comum na lista**. O card do P07 (escalado pela enfermeira `enf`) apareceu com exatamente os mesmos selos e botões dos cards não escalados logo acima e abaixo dele.

**Causa:** `alertService.getAlerts()` (`frontend/src/services/alertService.ts:111`) não filtra por papel nem por severidade efetiva — devolve tudo que a RLS deixa ver, e a lista renderiza `StatusBadge status={alert.status}` sem considerar `escalated_at`.

**Atenuante:** a escalada **não** é invisível — ela aparece no **drawer** de detalhes (`frontend/src/components/alerts.tsx:572-595`): selo "Escalado pela enfermagem", quem escalou, quando, e a justificativa, com a nota de que a cor não muda porque a severidade clínica é imutável. O que falta é isso subir para a lista e o amarelo não triado sair da fila acionável do médico.

**Impacto:** o requisito de negócio "o amarelo é evento da enfermagem" está cumprido na **notificação** (o médico não é avisado) mas não na **tela** (o médico continua vendo o amarelo como tarefa dele). Não é regressão — é o estado anterior que a 0077 não alcançou, porque a migration mexe em roteamento e a lista de alertas é outra camada.

---

## Correção do E3: severidade efetiva no front

O conceito de **severidade efetiva** existia só no SQL (`notify_team_of_alert`, 0077). A correção o trouxe para o front como fonte única, em `frontend/src/lib/alertSeverity.ts` (módulo puro, no mesmo padrão de `nurseTriage.ts`):

| Função | Papel |
|---|---|
| `effectiveSeverity(a)` | `RED` quando `status === 'RED'` **ou** `escalated_at != null`; senão o próprio status. Mesma regra do SQL. |
| `isEscalated(a)` | Distingue o alerta escalado do amarelo comum. |
| `isResolvedAlert(a)` | Atendido/ignorado é histórico, não fila de ninguém. |
| `ownsDoctorQueue(role)` | Só `SURGEON` e `ASSOCIATE`. **Admin e Gerente ficam de fora de propósito** — o Admin é supervisão e precisa da fila inteira; o Gerente já é somente-leitura. O enfermeiro tem a fila dele no Painel de Enfermagem. |
| `isWithNursing(a, role, viewerId)` | O alerta está com a enfermagem para *este* usuário. Um amarelo que **o próprio médico já travou** (`in_analysis_by === viewerId`) continua sendo dele — senão ficaria preso sem ninguém para concluí-lo. |

### O que mudou

| Arquivo | Mudança |
|---|---|
| `lib/alertSeverity.ts` | **Novo.** Regra pura + 20 testes em `alertSeverity.test.ts`. |
| `services/alertService.ts` | `summarize()` conta severidade **efetiva** (escalado entra em "Vermelhos"). `getUnattendedCount(viewer)` passa a receber o papel e não conta, para o médico, o amarelo que está com a enfermagem. |
| `components/AlertCount.tsx` | Passa `{ role, id }` para o contador — o badge da sidebar vira a fila **dele**. |
| `components/alerts.tsx` | `applyAlertFilters` e `sortAlerts` usam severidade efetiva (filtrar "Vermelhos" traz os escalados; eles sobem no topo). `AlertCard` ganha `withNursing`: cor/badge por severidade efetiva, selo **"Escalado pela enfermagem"** (ou "Escalado por tempo", no auto de 8h) e, quando é da enfermagem, badge **"Com a enfermagem"** no lugar de "Pendente", fundo esmaecido, **sem botões de ação** e com a linha "A enfermagem tria este caso e escala para você se precisar de médico." O card de resumo "Amarelos" vira **"Com a enfermagem"** para o médico. |
| `pages/AlertsPage.tsx` | Calcula `withNursing` por alerta e o repassa ao card **e ao drawer** (`canAttend`/`canRelease`) — sem isso Atender/Ignorar continuariam acessíveis por dentro dos detalhes. |

Nada de permissão mudou: RLS e RPCs `security definer` seguem sendo a autoridade. A correção é de **apresentação e de fila**, e é aditiva — nenhum papel perdeu visibilidade.

### Revalidação (cenário novo, mesma disciplina)

Três pacientes `is_test` na equipe 1, criados pelo caminho real (`submit_vital_record`), com homologação ligada: **P1** amarelo puro (37,8 °C), **P2** amarelo escalado pela enfermeira `enf`, **P3** vermelho (38,9 °C). Estado no banco antes de olhar a tela:

```
          name           | status_banco | severidade_efetiva | attendance_status | escalado
-------------------------+--------------+--------------------+-------------------+----------
 Elena Ricci             | YELLOW       | RED                | ATTENDED          | t
 [T77b] P1 amarelo puro  | YELLOW       | YELLOW             | PENDING           | f
 [T77b] P2 sera escalado | YELLOW       | RED                | PENDING           | t
 [T77b] P3 vermelho      | RED          | RED                | PENDING           | f
 Marcos Oliveira         | RED          | RED                | PENDING           | f
```

| Verificação | Resultado | Evidência |
|---|---|---|
| Escalado aparece **como vermelho** na lista | ✅ PASS | P2 renderiza `● ALERTA` + selo `↗ ESCALADO PELA ENFERMAGEM`, ordenado junto com os vermelhos. O valor exibido segue `37.8°C` e `status` no banco segue `YELLOW` — a severidade clínica não foi tocada. |
| Amarelo não escalado **não é pendência acionável** do médico | ✅ PASS | P1 renderiza `● ATENÇÃO` + badge `🩺 COM A ENFERMAGEM` (no lugar de "PENDENTE"), fundo esmaecido, **só "Ver detalhes"** — sem "Em análise" e sem "Atender" — com a linha explicativa. |
| A porta dos fundos do drawer também fecha | ✅ PASS | Drawer do P1 mostra apenas Acompanhar paciente / Ver registro original / WhatsApp / Copiar resumo / Reenviar. **Sem Atender e sem Ignorar.** |
| O escalado volta a ser acionável | ✅ PASS | Drawer do P2 traz **Atender** e **Ignorar**, mais o bloco "Escalado por enf · 25/08/2026, 08:39:05" com a justificativa e a nota de que a classificação clínica permanece amarela. |
| Cards de resumo por severidade efetiva | ✅ PASS | Médico: `5 Todos · 4 Vermelhos · 1 Com a enfermagem · 0 Em análise · 1 Atendidos` — bate linha a linha com a tabela do banco acima (Elena + P2 + P3 + Marcos = 4 efetivos vermelhos; P1 = 1). |
| Badge da sidebar = fila do médico | ✅ PASS | Cirurgiã: **3** (P2, P3, Marcos) em vez de 4 — o amarelo da enfermagem saiu da contagem. |
| Enfermagem não regrediu | ✅ PASS | Painel de Enfermagem da `enf`: "FILA ABERTA (**1**)" — só o P1. O escalado saiu da fila dela, como antes. |
| Admin continua com a fila inteira | ✅ PASS | Badge **4**, card mantém o rótulo "Amarelos" (não "Com a enfermagem") e a severidade efetiva também vale para ele (P2 como `ALERTA` + selo). Ausência de "Atender" para o Admin é comportamento pré-existente (`canAttendAlerts` nunca incluiu `ADM`). |

**Escolha registrada:** o **drawer** continua exibindo o badge com o `status` cru (amarelo) para o alerta escalado, porque é ali que fica o bloco que explica a distinção — *"A classificação clínica permanece amarela — o escalonamento é um julgamento da equipe, registrado à parte."* A lista, que é superfície de triagem, usa a severidade efetiva. Mudar o badge do drawer contradiria o texto ao lado dele.

**Rollback da revalidação:** os 3 pacientes, seus alertas e notificações foram removidos; `homologation_settings` de volta a `homologation_mode=false, test_recipients={}`; banco de volta a 4 pacientes / 5 perfis / 5 `auth.users`.

### E4 — Disciplina de teste ✅ PASS

| Requisito | Resultado |
|---|---|
| Homologação LIGADA o tempo todo | ✅ Ligada antes do primeiro lançamento e mantida durante toda a rodada (banner "AMBIENTE DE TESTE" visível em todas as telas). |
| **0 envios reais** | ✅ Garantido fisicamente: sem secrets no Vault local e com `supabase_edge_runtime` parado, todo disparo devolveu `WARNING: … não disparado`. Nenhuma linha saiu de `PENDING`/`SKIPPED_TEST_MODE`. |
| Tudo `is_test` | ✅ Os 12 pacientes de teste com `is_test=true`; os 16 alertas e as 45 linhas de notificação herdaram a marca. |
| Caminho REAL | ✅ Nenhum `insert` cru em `clinical_alerts`; todos os alertas nasceram de `submit_vital_record` (ver premissa 3). |
| **Rollback sem resíduo** | ✅ Ver abaixo. |
| **Nada commitado** | ✅ Nenhum commit criado. Além do estado anterior à rodada, a árvore agora carrega **apenas a correção do E3** (`lib/alertSeverity.ts` + teste, `alertService.ts`, `AlertCount.tsx`, `alerts.tsx`, `AlertsPage.tsx`) e este relatório. |

#### Rollback

Backup prévio em `supabase/_backups/vitalsync_local_20260825_041249.sql` (não foi preciso restaurar). Limpeza dirigida por marcador (`[T77]` / UUIDs `7e57…`):

```
                item                | antes | depois
------------------------------------+-------+--------
 pacientes [T77]                    |    12 |      0
 alertas de pacientes [T77]         |    16 |      0
 notification_logs desses alertas   |    45 |      0
 perfis / auth.users de teste       |     7 |      0
 equipes / pools / hospitais teste  | 3/1/1 |  0/0/0
 notification_logs órfãs            |     — |      0
 audit YELLOW_NO_NURSE_FALLBACK     |     3 |      0
```

Estado pré-existente **restaurado exatamente**: 4 pacientes, 5 perfis, 5 `auth.users`, 1 equipe, 2 vínculos em `team_members`. `homologation_settings` de volta a `homologation_mode=false, test_recipients={}`. As 8 faixas clínicas voltaram a bater com `clinical_threshold_defaults`, com a marca de edição (`updated_by`) limpa. Container e banco descartáveis do teste E2 removidos.

---

## Observações laterais — **todas corrigidas**

Os três achados abaixo foram anotados na rodada e corrigidos em seguida; ficam registrados com o diagnóstico original e o que mudou.

### 1. Ramo inalcançável em `alert_escalate_to_red` ✅ corrigido

A exceção de admin no teste de lock (`… and not public.is_admin()`) nunca era atingida: o admin já é barrado antes pela guarda `is_nurse()`, e `profiles.role` guarda **um** papel só — ninguém é `ADMIN` e `NURSING_PROFESSIONAL` ao mesmo tempo. Código morto herdado da 0064, e código morto numa regra de exclusividade engana quem lê depois.

**Correção:** condição removida da 0077 (que estava em PR aberto, nunca deployada — por isso editada no arquivo, sem migration de conserto), com comentário explicando por que ali **não** existe exceção de admin, ao contrário das outras RPCs de alerta.

**Regressão:** admin segue barrado com `Apenas o profissional de enfermagem escala um caso para o médico.`; enfermeira sem o lock segue barrada com `Este alerta está em análise por outro profissional.`; a dona do lock escala normalmente. Comportamento observável idêntico ao de antes — o ramo nunca tinha chance de rodar.

### 2. Nome do job × nome da função ✅ corrigido

O cabeçalho da 0077 chamava a rede de 8h de `nurse_queue_sweep`; **essa função não existe**. O job do pg_cron se chama `nurse-queue-sweep` e executa `reoffer_expired_alerts()` (0068).

> **Correção de uma imprecisão desta análise:** a anotação original dizia que o `CLAUDE.md` também usava o nome errado. Não usa — ele nunca menciona `nurse_queue_sweep`. O nome errado estava só no cabeçalho da 0077 e no prompt de trabalho da rodada.

**Correção:** cabeçalho da 0077 aponta a função certa e avisa que o nome do job não é o nome da função; `docs/FLUXO_ENFERMAGEM.md` ganhou a tabela de de-para **job × função** (conferida contra `cron.job` no banco); `CLAUDE.md` passa a registrar a armadilha.

### 3. Guarda estreita do `pg_cron` ✅ corrigido

O bloco tratava só `exception when insufficient_privilege`. Fora do banco de `cron.database_name` (normalmente `postgres`), o pg_cron recusa a instalação com um RAISE próprio — **SQLSTATE `P0001`** (`raise_exception`), medido empiricamente — que escapava da guarda e **abortava a migration**, contrariando a intenção declarada dela ("avisa e segue"). Foi exatamente o que derrubou a primeira tentativa do E2.

**Correção:** as três migrations com o padrão (`0038`, `0061`, `0063`) passam a tratar `insufficient_privilege` **e** `raise_exception`; `CLAUDE.md` documenta os dois modos de falha para as próximas.

**Ressalva registrada:** essas três já estavam aplicadas e deployadas, e o repositório proíbe editar migration aplicada. A edição foi feita mesmo assim porque é **inerte para banco existente** — o `DO` já rodou, e nenhum banco muda — e altera só a aplicação *do zero*, onde a versão antiga abortava e a nova avisa e segue. Sem isso, a técnica de conferir a sequência num banco descartável (recomendada aqui justamente por `db reset` ser proibido) não funciona.

**Verificação:** a sequência **0001 → 0077 aplica limpa num banco que não se chama `postgres`**, com 3 avisos tratados (um por migration) em vez do aborto na 0038.

### 4. O botão "Escalar" exige o lock — decisão, não defeito

Ele só aparece no bucket `MINE_IN_ANALYSIS`: a enfermeira precisa "Assumir" antes. É mais restrito que "qualquer amarelo da equipe/pool", porém coerente com a regra de exclusividade da própria RPC. Mantido.
