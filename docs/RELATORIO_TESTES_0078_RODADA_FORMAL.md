# Relatório de testes — 0078: reavaliação de enfermagem em 2h + reorganização da tela

**Escopo:** rodada formal sobre a migration **0078** e a reorganização de `PatientDashboardPage` em abas.
**Ambiente:** Supabase LOCAL (Docker), frontend Vite em `localhost:5173`. **Migrations:** 0001 → 0078.
**Data:** 25/08/2026 · **Branch:** `feature/reavaliacao-2h-enfermagem` (empilhada sobre o PR #92).

## Veredito

**19 PASS · 1 PASS COM RESSALVA · 1 NÃO IMPLEMENTADO (declarado) — ✅ GO.**

| Bloco | Resultado |
|---|---|
| **A — Agendamento** | ✅ A1–A5 PASS |
| **B — Conclusão e desfechos** | ✅ B1–B5 PASS |
| **C — Cancelamento, autorização, escopo** | ⚠️ C1 **PASS com ressalva** · ✅ C2–C4 PASS |
| **D — Prazo / atraso** | ✅ D1, D3 PASS · ⛔ D2 **não implementado** (declarado) |
| **E — Front** | ✅ E1–E5 PASS (com 2 achados menores) |
| **F — Regressão** | ✅ F1–F3 PASS |

Nada commitado. Ambiente restaurado: `reassessmentMinutes = 120`, homologação desligada, zero resíduo.

---

## Premissas assumidas

1. **Nome da chave do parâmetro.** O prompt cita `nurse_reassessment_minutes`; o implementado é **`reassessmentMinutes`**, para casar com as chaves já existentes em `app_settings.nursing` (`slaMaxHours`, `lockTtlMinutes`, `offerWindowMinutes`) e com o helper `nursing_setting_num`. Confirmado que a chave snake_case **não** existe na seção.
2. **Caminho real = `staff_insert_vital_record`.** Esta rodada correu às 13:36–13:50 (São Paulo), com a janela da manhã aberta (`≥ 10:00`), então **todos os alertas foram criados pelo caminho da equipe**, como o prompt pede — fechando a lacuna da rodada anterior, que precisou usar `submit_vital_record` por causa do gate de horário. Nenhum `INSERT` cru em `clinical_alerts`.
3. **Existe uma RPC a mais do que o prompt previa:** `nurse_reassessment_escalate`. Ela é necessária — ver [C1](#c1--a-premissa-do-item-não-é-alcançável-hoje).

## Fora do escopo local

| Item | Por quê |
|---|---|
| Envio real de WhatsApp | Sem secrets no Vault local e edge runtime parado — garantia física de 0 envios reais. Todas as linhas ficaram `SKIPPED_TEST_MODE`. |
| `pg_cron` em horário real | Prazos manipulados via `app_settings` (3 min) para produzir o estado "em atraso" de verdade, sem esperar 2h. |
| **D2 — sweep de 2ª ordem** | **Não implementado.** Ver [D2](#d2--sweep-de-2ª-ordem-não-implementado). |

---

## Bloco A — Agendamento

| Item | Resultado | Evidência |
|---|---|---|
| **A1** | ✅ PASS | Enfermeira atende o amarelo do P01 → **1** linha `PENDING`; `min_apos_atender = 120` (medido como `due_at − attended_at`); `scheduled_by = enf`; `alert_id_ok`, `patient_id_ok`, `team_id_ok` todos `t`. |
| **A2** | ✅ PASS | Médico associado atende o amarelo do P02 → `reavaliacoes = 0`. |
| **A3** | ✅ PASS | Vermelho (38,9 °C) do P03 atendido pelo médico → `reavaliacoes = 0`. Reforço: a enfermagem sequer pode atendê-lo — `Alertas vermelhos são atendidos pelo médico da equipe.` |
| **A4** | ✅ PASS | (a) Segunda marcação → `Este alerta já foi atendido.`, segue **1** pendente. (b) **Corrida real** com duas transações concorrentes (duas enfermeiras, uma com `pg_sleep` dentro da transação): a segunda recebeu `Este alerta já foi atendido.` e o resultado foi **1** pendente. O `for update` de `alert_mark_attended` serializa; o índice único parcial `nurse_reassessments_uma_pendente_por_alerta` é a segunda barreira. |
| **A5** | ✅ PASS | `reassessmentMinutes` baixado para **3** → novo atendimento (P05) gerou `min_apos_atender = 3`, enquanto o P01, agendado antes, **permaneceu com 120**. Prova que o valor é lido no momento do atendimento e não está hardcodado. |

## Bloco B — Conclusão e desfechos

| Item | Resultado | Evidência |
|---|---|---|
| **B1** | ✅ PASS | `IMPROVED` → `status=DONE`, `outcome=IMPROVED`, `performed_by=enf`, `performed_at` preenchido, `should_escalate = f`. Sumiu da fila (`nurse_reassessments_due` = 0 para o paciente). |
| **B2** | ✅ PASS | `UNCHANGED` → `DONE`, `should_escalate = f`; o alerta segue `YELLOW` e **não escalado**. |
| **B3** | ✅ PASS | `WORSENED` → `should_escalate = t`. Escalada com a observação como motivo: alerta com `escalated_at` preenchido, `escalation_reason` = a observação, `status` **ainda `YELLOW`** (severidade clínica imutável). `notification_logs`: antes só enfermagem (`recipient_is_nurse = t`); depois **nova leva** para Dra. Ana e Dr. Bruno com **`recipient_is_nurse = f`**. |
| **B4** | ✅ PASS | Observação em branco → `Descreva o que o paciente relatou na reavaliação.` Desfecho inválido → `Desfecho inválido. Use melhorou, mantém ou piorou.` |
| **B5** | ✅ PASS | Já `DONE` → `Esta reavaliação já foi registrada.` Já `CANCELLED` → `Esta reavaliação foi cancelada porque o caso saiu da enfermagem.` Nenhuma reabre. |

## Bloco C — Cancelamento, autorização e escopo

### C1 — a premissa do item não é alcançável hoje

**⚠️ PASS com ressalva.** O item pede: escalar o alerta **antes** de concluir a reavaliação → a PENDING vira `CANCELLED`. Testei os **três** caminhos reais, com uma reavaliação `PENDING` viva no P09:

| Caminho | Resultado |
|---|---|
| Enfermeira chama `alert_escalate_to_red` direto | `ERROR: Este alerta já foi finalizado.` |
| Enfermeira chama `nurse_reassessment_escalate` | `ERROR: Só um caso reavaliado como "piorou" é escalado por aqui. Registre o desfecho primeiro.` |
| Auto-escalonamento de 8h (`reoffer_expired_alerts`) | `elegivel_ao_sweep_8h = f` — o alerta está `ATTENDED`/`attended=true`, fora do critério do sweep |

**Por quê:** a reavaliação só nasce quando o alerta é **atendido**, e escalar exige alerta **não finalizado**. Os dois estados se excluem. Escalar depois de atender só acontece via `nurse_reassessment_escalate`, que **reabre** o alerta — e essa RPC exige a reavaliação já `DONE`/`WORSENED`, logo nunca há PENDING para cancelar.

**O trigger em si está correto.** Verificado com uma **sonda sintética explicitamente rotulada** (não é caminho real), numa transação revertida:

```
  antes    →  PENDING
  (update clinical_alerts set escalated_at = now() …)
  depois   →  CANCELLED  |  cancel_reason = 'Alerta escalado para o médico.'
```

Sonda revertida; confirmado depois que a reavaliação seguia `PENDING` e o alerta não escalado.

**Conclusão:** o ramo de escalonamento do trigger é **defensivo**, não morto por construção — o modelo de dados permite o estado e qualquer reabertura futura o torna alcançável. O trigger precisa observar `escalated_at` de qualquer forma, porque esse campo é gravado por **dois** caminhos (a RPC e o sweep de 8h, que não passa por RPC). Registrado como ressalva, não como falha.

### C2–C4

| Item | Resultado | Evidência |
|---|---|---|
| **C2** | ✅ PASS | P08: enfermeira atende (PENDING) → `alert_ignore` → reavaliação vira **`CANCELLED`**, `cancel_reason = 'Alerta finalizado (ignorado).'` Este é o ramo do trigger **exercido por caminho real**. |
| **C3** | ✅ PASS | Médico associado, cirurgiã responsável e **admin** → `Apenas o profissional de enfermagem registra a reavaliação.`; **gerente** → `MANAGER_READ_ONLY`; enfermeira da equipe → passa. |
| **C4** | ✅ PASS | Equipe B (cirurgião + enfermeira próprios, paciente próprio). Enfermeira da **equipe 1**: vê **0** na tabela, **0** na fila, e ao tentar concluir → `Sem permissão para esta reavaliação.` Enfermeira da **equipe B**: vê **1** na fila e conclui normalmente. |

## Bloco D — Prazo / atraso

| Item | Resultado | Evidência |
|---|---|---|
| **D1** | ✅ PASS | Com `reassessmentMinutes = 3`, passado o prazo: `vencida = t`. A função real da tela (`nurse_reassessments_due`) devolveu `overdue = t` e a linha **continua na fila** — não sumiu. Na UI: **"atrasada há 3 min"** em vermelho, e a fila ordena as atrasadas primeiro. |
| **D2** | ⛔ **NÃO IMPLEMENTADO** | Ver abaixo. |
| **D3** | ✅ PASS | `due_at` é `timestamp with time zone` (instante absoluto). O mesmo registro renderiza `25/08/2026 15:37` em São Paulo e `18:37` em UTC — offset correto. A fila e a UI formatam com `timeZone: 'America/Sao_Paulo'`; o banco roda em UTC, como manda M-15/M-16. |

### D2 — sweep de 2ª ordem: não implementado

Confirmado por consulta: **0 jobs** de cron mencionando reavaliação, **0 funções** varrendo `nurse_reassessments` além das próprias RPCs, e os 10 jobs pré-existentes intactos (a 0078 não adicionou nenhum).

**Decisão registrada:** o requisito de segurança — *"em atraso deve ficar visível, nunca sumir silenciosamente"* — **já está atendido** e testado (D1): a pendência vencida fica em vermelho na fila, no selo da aba e na seção, e nunca sai da lista. O que faltaria é **auto-escalonar após X horas de atraso**, e **X é decisão clínica que ninguém definiu**. Implementar com um número inventado seria pior do que não implementar — o projeto já tem `docs/PONTOS_PENDENTES.md` justamente para não cravar limiar sem validação médica. Fica como **pendência de staging**, a decidir junto com a equipe clínica.

## Bloco E — Front

| Item | Resultado | Evidência |
|---|---|---|
| **E1** | ✅ PASS | Seção mostra **horário previsto** (`25/08/2026, 13:41`), **contagem regressiva viva** (`atrasada há 4 min` — atualizou de 3 para 4 entre a fila e a tela) e selo **EM ATRASO**. Formulário com os três desfechos + observação obrigatória. "Piorou" → modal de confirmação → escalada. **Histórico** das concluídas com selo colorido do desfecho, data/hora e o relato. |
| **E2** | ✅ PASS | Bloco **"RECONTATOS DE ENFERMAGEM (3)"** (renomeado após o achado abaixo; nos prints da rodada aparece como "REAVALIAÇÕES 2H") com selo **"2 EM ATRASO"**: P05 *atrasada há 3 min*, P09 *atrasada há 2 min* (ambos em vermelho), P04 *em 1h53* — ordenados por prazo, cada um com **Recontatar** para `?tab=enfermagem`. Bate linha a linha com `nurse_reassessments_due()`. |
| **E3** | ✅ PASS | Verificado **programaticamente no DOM**: `bannerExiste: true`, `bannerAntesDasAbas: true`, `bannerDentroDeUmaAba: false` — o banner de medição esquecida fica acima das abas, fora de qualquer `tabpanel`. Enfermeira caiu em **"Enfermagem e atendimentos"** sem `?tab=` na URL; cirurgiã caiu em **"Visão geral"**. Deep-link funciona nos dois sentidos (clicar na aba atualiza a URL para `?tab=dia-30`). Selo de pendência na aba: **"atrasada"** (vermelho) / **"1"** (âmbar). |
| **E4** | ✅ PASS | Viewport real de **390px**: `scrollWidth` 375 ≤ 390 → **sem scroll horizontal**. `role="tablist"` presente, **todas** as abas com `aria-selected`, **todos** os `tabpanel` com `aria-labelledby`, navegação por setas e `focus-visible`. Alvos novos ≥ 40px (abas 40, desfechos 58). Desktop: `scrollWidth` 1480 ≤ 1495, gráficos em 3 colunas e formulário em 2. |
| **E5** | ✅ PASS | `PatientFollowupSection` renderiza na aba de enfermagem; `PatientDay30Section` renderiza completa na aba de 30 dias (todos os campos de desfecho e satisfação); gráficos, indicadores e foto na Visão geral. Nenhum componente foi reescrito — apenas reagrupado. |

### Dois achados menores (não bloqueiam)

1. ~~**Colisão de nomes na central de enfermagem.**~~ ✅ **CORRIGIDO.** A tela já tinha **"REAFERIÇÕES DE 2H"** (protocolo 5.7.2 — nova *medição* em 2h após amarelo isolado) e o bloco novo se chamava **"REAVALIAÇÕES 2H"** (recontato da enfermagem): coisas diferentes, ambas "2h", nomes quase idênticos e **adjacentes na mesma página**. Os textos de tela foram renomeados para **"Recontatos de enfermagem"** / **"Recontato de enfermagem"**, com o botão da fila virando **"Recontatar"**. Os identificadores de código e banco seguem `nurse_reassessment*` — ver a nota de terminologia no cabeçalho de `0078`.
2. **Selo da aba fica velho após registrar.** `useReassessmentBadge` carrega uma vez na montagem; ao concluir a reavaliação, o selo "atrasada" continua na aba até recarregar a página. Cosmético — o conteúdo da seção atualiza corretamente. Correção: expor um `refresh` do hook e chamá-lo junto com o `load()` da seção.

### Divergências assumidas em relação ao prompt

- **Accordions no mobile: não implementados.** O prompt pedia blocos internos longos colapsáveis. As abas já cortaram a rolagem drasticamente (cada aba é curta), e não há scroll horizontal. Fica como refinamento, não como pendência funcional.
- **Badge de "medição esquecida" na aba: não implementado.** O banner ficou **acima das abas**, sempre visível — o que atende ao objetivo declarado ("não esconder o urgente atrás de uma aba") de forma mais direta que um selo. Verificado no DOM (E3).
- **Cabeçalho não é `sticky`.** O card do paciente tem ~150px; grudado no topo do mobile comeria um terço da tela útil. As abas ficam logo abaixo e o scroll até elas é curto.

## Bloco F — Regressão

| Item | Resultado |
|---|---|
| **F1** | ✅ `typecheck` limpo · `@vitalsync/frontend` **203 testes / 14 arquivos** · `@vitalsync/shared` **104 / 3** · `npm run build` (shared + backend legado + frontend) OK. |
| **F2** | ✅ **0001 → 0078: as 78 migrations aplicam limpas** do zero, em banco descartável (sem `db reset`, que é proibido no projeto). **Nenhum valor clínico alterado**: no banco novo, **8 de 8** métricas de `clinical_threshold_settings` continuam idênticas a `clinical_threshold_defaults`. |
| **F3** | ✅ Homologação **ligada** durante toda a rodada; **0 envios reais** (todas as notificações `SKIPPED_TEST_MODE`); 14 pacientes de teste `is_test`; alertas sempre pelo caminho real (`staff_insert_vital_record` + `alert_mark_attended`); **rollback sem resíduo**; **nada commitado**. |

### Estado final do ambiente

```
     item     | n            parametro_restaurado | homologacao
--------------+---           ---------------------+-------------
 residuo [TR] | 0                             120 | f
 pacientes    | 4
 perfis       | 5
 auth.users   | 5
 equipes      | 1
 vinculos     | 2
```

---

## Nota de método: um bug no meu próprio script de teste

No primeiro C4 a equipe B não gerou reavaliação. Investiguei suspeitando do produto, e a causa era o **harness**: o trigger `on_auth_user_created` → `handle_new_user` já cria o `profiles` a partir do `auth.users`, então meu `insert into profiles … on conflict (id) do nothing` **não corrigiu o papel** — a "enfermeira" da equipe B ficou como `ASSOCIATED_DOCTOR`. O comportamento observado (não agendar reavaliação) estava **correto**: quem atendeu era médico.

É a mesma família do gotcha já documentado do `trg_protect_profile`, e vale registrar: **em seed local, usar `on conflict (id) do update set role = …`**, nunca `do nothing`, porque a linha já existe. Corrigido e o C4 refeito do zero, com papéis conferidos via `is_nurse()` antes de testar.
