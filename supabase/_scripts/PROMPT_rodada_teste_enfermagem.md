# Prompt — Rodada de testes das novas funcionalidades (VitalSync)

> Cole no assistente de código, trabalhando dentro de `D:\VitalSync`.
> Escopo: validar E2E as migrations **0075** (regras clínicas editáveis), **0076** (enfermagem como papel de equipe) e **0077** (roteamento do alerta amarelo + escalada pela enfermagem).
> Padrão: mesmo rigor do piloto — ambiente LOCAL, **homologação LIGADA o tempo todo**, **0 envios reais**, tudo `is_test`, testar pelo **caminho REAL** (RPC que cria o alerta), rollback sem resíduo, **nada commitado** até tudo PASS. Entregar um relatório **go/no-go** no espírito de `docs/RELATORIO_TESTES_PILOTO.md`.

---

## Contexto do que foi implementado (confirme lendo o código antes de testar)

**0075 — Regras clínicas editáveis pelo admin (runtime, sem deploy).**
- Tabela `clinical_threshold_settings` (uma linha por métrica; `rules` = array ordenado de `{status,min?,max?}`, limites inclusivos, 1ª faixa que casa vence). Semeada com os valores EXATOS de `ALERT_THRESHOLDS` (`packages/shared/src/clinical/thresholds.ts`) — nenhum valor clínico muda por padrão.
- 8 métricas editáveis: `temperature, spo2, bloodPressureSystolic, bloodPressureDiastolic, heartRate, diuresis, pain, dyspnea`.
- Escrita só via RPC `admin_set_clinical_threshold` (admin), validada por `validate_clinical_rules` (prova cobertura do domínio: sem buraco, sem faixa inalcançável, status válidos, os 3 status presentes). Leitura: RLS `clinical_thresholds_read` (qualquer logado).
- `eval_clinical_status` virou STABLE e passou a ler a tabela via `classify_by_bands`/`clinical_rules_for`. Continuam EM CÓDIGO (não editáveis): critérios combinados de vermelho, STEPS_RULES, vômito/sangramento, ingestão hídrica, fallback de diurese sem contagem.

**0076 — Enfermagem = papel de primeira classe na equipe.**
- Constraints antigas (`team_members_assoc_only_chk`, `team_members_role_associate_only`) trocadas por `team_members_role_allowed_chk` que aceita `ASSOCIATED_DOCTOR` **ou** `NURSING_PROFESSIONAL`. `MAIN_SURGEON` segue barrado (mora em `medical_teams.main_surgeon_id`).
- Migração de dados desfaz a gambiarra do piloto (enfermeiro que estava como `ASSOCIATED_DOCTOR` vira `NURSING_PROFESSIONAL`, por `profiles.role`).
- `count_associated_doctors` filtra só `ASSOCIATED_DOCTOR` → enfermeiro NÃO consome as 10 vagas de médico. Sem teto de enfermeiros por equipe.
- Helper `team_active_nurses(team)`; aviso `after_team_member_added` estendido para enfermagem.

**0077 — Amarelo é evento da enfermagem; vermelho, dos médicos.**
- **Severidade EFETIVA:** `RED` quando `status='RED'` OU `escalated_at is not null`; senão `YELLOW`. (`clinical_alerts.status` nunca é sobrescrito — escalada grava em `escalated_at`.)
- `alert_nurse_recipients(team,patient)` = enfermeiros ATIVOS da **equipe** (`role_in_team='NURSING_PROFESSIONAL'`) **∪** enfermeiros do **pool** que cobre o hospital do paciente (`nurse_pool_*`). As duas vias somam (aditivo).
- `alert_doctor_recipients(team)` = cirurgião responsável + membros ativos que NÃO são enfermagem.
- `notify_team_of_alert`: amarelo → enfermagem; se não houver enfermeiro (equipe **e** pool) → **fallback** para os médicos + audit `YELLOW_NO_NURSE_FALLBACK`; vermelho/escalado → médicos; ninguém → audit `ALERT_NO_RECIPIENT`. Coluna nova `notification_logs.recipient_is_nurse` marca a rota amarela.
- `alert_escalate_to_red(alert, reason)`: exige `is_nurse()` (médico e **admin** não escalam; gerente recebe `MANAGER_READ_ONLY`), exige `reason`, só `YELLOW`, respeita lock `in_analysis_by`, **idempotente** (`escalated_at`), não finalizado. Grava `escalated_at/by/reason`, volta `attendance_status='PENDING'` e dispara a rota vermelha (médicos).
- Auto-escalonamento de 8h (`nurse_queue_sweep`, 0068) NÃO passa por essa RPC e segue como rede de segurança.

> ⚠️ `notify_team_of_alert` **não** é chamada por trigger em INSERT cru de `clinical_alerts`. Sempre teste pelo caminho real: `staff_insert_vital_record` (lançamento pela equipe) ou `submit_vital_record` (paciente). Ex.: 37,8 °C → YELLOW; 38,9 °C → RED.

---

## Preparação do ambiente (uma vez)

1. Subir limpo e verificar migrations: `supabase start` → aplicar até a 0077 (`supabase migration up`; se precisar zerar, `./supabase/_scripts/reset_keep_data.ps1`). Confirmar que `0001 → 0077` aplicam sem erro.
2. **Homologação LIGADA** com whitelist de teste preenchida (números fictícios). Todo envio deve virar `PENDING` (whitelisted) ou `SKIPPED_TEST_MODE` — **nunca** envio real. Conferir gate em `homologation_settings`.
3. Seed com papéis corretos (lembrar do gotcha: `trg_protect_profile` reverte troca de role sem sessão admin — o `seed.sql` já desliga a trava no upsert). Garantir usuários: admin, cirurgião (equipe 1), médico associado (equipe 1), **enfermeiro** e **gerente de equipe**.
4. Montar os dados de teste:
   - Equipe **1** com: cirurgião responsável + 1 médico associado + **≥1 enfermeiro** (`role_in_team='NURSING_PROFESSIONAL'`) + ≥1 paciente na janela.
   - Equipe **2** com paciente próprio (para testar isolamento por equipe).
   - Um cenário de **pool** cobrindo o hospital de um paciente (para a via `alert_nurse_recipients` por pool).
   - Um cenário **sem enfermeiro** (equipe sem enfermagem e pool sem o hospital) para o fallback.

> Verificar sempre pelas linhas criadas em `notification_logs` (quem recebeu, `recipient_is_nurse`), independentemente de `status` ser `PENDING`/`SKIPPED_TEST_MODE` — o que importa no teste de roteamento é o **destinatário**, não o envio.

---

## Bloco A — Enfermagem como papel de equipe (0076)

- **A1.** Admin adiciona um enfermeiro na tela **Gerenciar Equipes** → surge em `team_members` com `role_in_team='NURSING_PROFESSIONAL'` e `status='ACTIVE'`.
- **A2.** **Gerente de equipe** adiciona **dois** enfermeiros à(s) sua(s) equipe(s) pela mesma tela → ambos ativos.
- **A3.** Papel sem permissão (ex.: médico associado) **não** consegue adicionar enfermeiro.
- **A4.** Constraint: inserir `MAIN_SURGEON` em `team_members` é **rejeitado**; `NURSING_PROFESSIONAL` e `ASSOCIATED_DOCTOR` aceitos.
  `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.team_members'::regclass and contype='c';`
- **A5.** Gambiarra desfeita: nenhum enfermeiro (`profiles.role='NURSING_PROFESSIONAL'`) continua gravado como `ASSOCIATED_DOCTOR`.
  `select m.role_in_team, p.role from team_members m join profiles p on p.id=m.doctor_id where p.role::text='NURSING_PROFESSIONAL';`
- **A6.** Teto de 10 associados ignora enfermagem: `select public.count_associated_doctors('<EQUIPE1>');` não conta os enfermeiros.
- **A7.** `select * from public.team_active_nurses('<EQUIPE1>');` retorna os enfermeiros ativos; desativar a conta (`profiles.status`) faz sumir da lista.
- **A8.** Aviso "você foi adicionado à equipe" dispara ao adicionar enfermeiro (via `after_team_member_added`).

## Bloco B — Roteamento do alerta amarelo (0077)

- **B1.** Lançamento que gera **YELLOW** na equipe 1 (ex.: 37,8 °C via `staff_insert_vital_record`) → em `notification_logs` do alerta só aparecem **enfermeiros**, `recipient_is_nurse=true`; **nenhum médico**.
  `select recipient_name, recipient_is_nurse, status from notification_logs where alert_id='<amarelo>';`
- **B2.** Isolamento por equipe: enfermeiro da equipe 1 **não** recebe amarelo de paciente da equipe 2.
- **B3.** Via **pool**: paciente cujo hospital é coberto por um pool com enfermeiro ativo → esse enfermeiro do pool recebe o amarelo (mesmo sem vínculo de equipe). Confirma que equipe **∪** pool somam.
- **B4.** **Fallback**: paciente em equipe **sem** enfermeiro e cujo hospital **não** está em pool → o amarelo vai para os **médicos** da equipe e grava `YELLOW_NO_NURSE_FALLBACK`.
  `select action, entity from audit_logs where action='YELLOW_NO_NURSE_FALLBACK' order by created_at desc limit 3;`
- **B5.** Sem nenhum destinatário ativo → grava `ALERT_NO_RECIPIENT` (visível, não silencioso).
- **B6.** Alerta **VERMELHO** direto (ex.: 38,9 °C) → só **médicos** (`recipient_is_nurse=false`); enfermagem **não** recebe o vermelho automático.

## Bloco C — Escalada amarelo → vermelho (0077)

- **C1.** Enfermeiro da equipe chama `alert_escalate_to_red('<amarelo>', 'motivo clínico')` (ou pelo botão na tela) → `clinical_alerts.status` **continua 'YELLOW'**; `escalated_at/escalated_by/escalation_reason` preenchidos; `attendance_status` volta a `PENDING`; **nova leva** em `notification_logs` para os **médicos** (`recipient_is_nurse=false`).
- **C2.** Sem motivo (`reason` vazio) → erro "Descreva por que este caso precisa do médico."
- **C3.** Autorização: **médico** escalando → "Apenas o profissional de enfermagem escala..."; **admin** também **não** escala; **gerente** → `MANAGER_READ_ONLY`.
- **C4.** **Idempotência**: segundo enfermeiro (ou segunda chamada) → "já foi escalado", **sem nova leva** de logs. (O `for update` serializa concorrentes.)
- **C5.** Só amarelo: escalar um alerta já **RED** → erro; alerta já finalizado (`ATTENDED`/`IGNORED`/`attended=true`) → erro.
- **C6.** Lock: alerta em análise por **outro** profissional (`in_analysis_by`) → erro "está em análise por outro profissional" (admin é exceção).
- **C7.** Rede de segurança intacta: o auto-escalonamento de 8h (`nurse_queue_sweep`, 0068) **não** passa por `alert_escalate_to_red` e continua escalando amarelo não triado (verificar que a função existe e o job de 8h está ativo, sem depender de pool).

## Bloco D — Regras clínicas editáveis (0075)

- **D1.** Leitura: qualquer papel logado lê `clinical_threshold_settings`. Escrita: só admin via `admin_set_clinical_threshold`; outro papel → negado; escrita direta na tabela por `authenticated` → negada (sem policy de write).
- **D2.** **Nenhum valor mudou por padrão** — bateria de bordas confere com o comportamento atual (ex.: temperatura 37,79→GREEN, 37,8→YELLOW, 38,4→YELLOW, 38,5→RED; SpO2 94,01→GREEN, 94→YELLOW, 92→RED). Rodar via `classify_by_bands('<metrica>', <valor>)` e/ou um lançamento real e conferir `clinical_alerts.status`.
- **D3.** Validação rejeita faixa ruim: (a) status inválido; (b) **buraco** (valor plausível sem faixa); (c) faixa **inalcançável** (sombreada por anterior); (d) faltando um dos três status. A mensagem PT-BR deve chegar crua na tela.
- **D4.** Edição **muda a classificação ao vivo**: alterar a faixa de uma métrica via `admin_set_clinical_threshold`, fazer um novo lançamento pelo caminho real e confirmar que o `status`/alerta muda conforme a nova faixa (e depois restaurar o default).
- **D5.** Métrica **não editável**: tentar `admin_set_clinical_threshold` numa métrica fora das 8 (ou nos critérios combinados/passos/binários) → erro "regra definida em código".
- **D6.** `pending_validation=true` numa métrica espelha `PENDING_MEDICAL_VALIDATION` (faixa provisória aguardando confirmação médica) sem quebrar a classificação.

## Bloco E — Regressão automatizada + integração de front

- **E1.** Automatizados verdes: `@vitalsync/shared`, `@vitalsync/frontend`, `typecheck` limpo, `build (CI)` ok.
- **E2.** Migrations `0001 → 0077` aplicam limpas (`db reset`); bloco de guarda da 0075 (que aborta se `eval_clinical_status` mudar algum status de borda) **passa**.
- **E3.** Checklist manual de UI (o projeto não tem teste de render):
  - **Gerenciar Equipes**: seção de enfermagem com listar/adicionar/remover, visível e acionável para **admin** e **gerente**; busca traz só `role=NURSING_PROFESSIONAL`.
  - **NurseTriage/NurseDashboard**: botão **"Escalar para vermelho"** só aparece para **enfermeiro**, só em alerta **YELLOW** da equipe/pool dele, com **confirmação + campo de motivo**; após escalar, some da fila da enfermagem e o alerta aparece para os médicos.
  - Médico **não** vê o amarelo como pendência acionável; passa a vê-lo (como vermelho) só após a escalada.
  - **Configurações → Regras Clínicas** (admin): editar uma faixa, ver a validação recusar uma faixa ruim com a mensagem crua, salvar uma boa.
- **E4.** Homologação LIGADA o tempo todo, **0 envios reais**, tudo `is_test`, rollback sem resíduo, **nada commitado** (mesma disciplina do piloto).

---

## Entregável final

Um relatório **go/no-go** por item (A1–A8, B1–B6, C1–C7, D1–D6, E1–E4), cada um com PASS/FAIL + evidência (query e resultado, ou passo de UI), no formato de `docs/RELATORIO_TESTES_PILOTO.md`. Liste no topo qualquer premissa assumida e qualquer item que só é testável em staging (ex.: envio real de WhatsApp, pg_cron em horário real) como **fora do escopo local**.
