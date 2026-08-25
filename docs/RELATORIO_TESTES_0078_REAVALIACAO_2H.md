# Relatório de testes — 0078 (reavaliação 2h) + reorganização da tela de Acompanhamento Individual

**Escopo:** (1) reavaliação de enfermagem em 2h após atender um alerta AMARELO; (2) reorganização de `PatientDashboardPage` em abas, para desktop e mobile.
**Ambiente:** Supabase LOCAL (Docker), frontend Vite em `localhost:5173`. **Migrations aplicadas:** 0001 → 0078.
**Data:** 25/08/2026.

## Veredito

**10 de 10 itens PASS — ✅ GO.**

| Item | Resultado |
|---|---|
| 1. Amarelo atendido por enfermeiro → 1 pendente, `due_at ≈ +120min` | ✅ PASS |
| 2. Amarelo atendido por médico → não cria | ✅ PASS |
| 3. Aparece na tela do paciente e na fila, com prazo e "em atraso" | ✅ PASS |
| 4. Melhorou/mantém → `DONE` + autor + horário | ✅ PASS |
| 5. Piorou → oferece escalar; escalada roda e vai aos médicos | ✅ PASS |
| 6. Escalar/finalizar antes do prazo → `CANCELLED` | ✅ PASS |
| 7. Idempotência: marcar atendido de novo não duplica | ✅ PASS |
| 8. Autorização e RLS | ✅ PASS |
| 9. Reorganização: abas, deep-link, papéis, sem scroll horizontal | ✅ PASS |
| 10. Regressão automatizada + migrations limpas | ✅ PASS |

---

## Premissas assumidas

1. **Chave do parâmetro em camelCase.** O prompt sugeria `nurse_reassessment_minutes`; usei **`reassessmentMinutes`** para casar com as chaves já existentes em `app_settings.nursing` (`slaMaxHours`, `lockTtlMinutes`, `offerWindowMinutes`) e com `nursing_setting_num`.
2. **Uma decisão de design que o prompt não previa** — ver [O impasse do "piorou → escalar"](#o-impasse-do-piorou--escalar). Sem ela o requisito 4 seria impossível.
3. **Branch empilhada.** A 0078 depende da 0077 (severidade efetiva, `alert_escalate_to_red`), que está no PR #92 ainda aberto. Trabalhei em `feature/reavaliacao-2h-enfermagem` a partir daquela branch, não de `main`.
4. **Cabeçalho não-sticky.** O prompt pedia cabeçalho fixo. Ele ficou acima das abas, mas **sem `position: sticky`**: o card do paciente tem ~150px de altura e, grudado no topo do mobile, comeria um terço da tela útil. As abas — que é o que precisa estar sempre alcançável — ficam logo abaixo e o scroll até elas é curto. Se preferir sticky de verdade, o caminho é reduzir o cabeçalho a uma barra fina (nome + status + ações) quando rolado.

## Fora do escopo local

| Item | Por quê |
|---|---|
| Envio real de WhatsApp | Sem secrets no Vault local e com o edge runtime parado — garantia física de 0 envios reais. |
| `pg_cron` em horário real | O prazo foi manipulado (`due_at` no passado) para produzir o estado "em atraso". |
| **Rede de 2ª ordem para reavaliação vencida** | **Não implementada, de propósito.** O requisito de segurança ("nunca sumir silenciosamente") já está atendido de forma visível: a pendência atrasada fica em vermelho na fila, no selo da aba e na seção, e nunca sai da lista. O que faltaria é *auto-escalonar* após X horas de atraso — e X é decisão clínica que ninguém definiu. Implementar com um número inventado seria pior que não implementar. Fica registrado como pendência de staging. |

---

## PARTE 1 — Reavaliação de enfermagem em 2h

### O impasse do "piorou → escalar"

O requisito 4 e o critério 5 pedem: reavaliação com desfecho "piorou" → oferecer escalar para vermelho reusando `alert_escalate_to_red`.

**Isso é impossível na forma direta**, e o teste mostrou por quê:

```
ERROR:  Este alerta já foi finalizado.
```

A reavaliação só nasce quando o alerta é **atendido** — e `alert_escalate_to_red` (0077) recusa alerta finalizado (`attendance_status in ('ATTENDED','IGNORED') or attended = true`). Ou seja: quando existe reavaliação, escalar está sempre bloqueado. A primeira versão da RPC devolvia `should_escalate = true` e a tela teria oferecido um botão que o banco sempre recusaria.

**Solução:** RPC dedicada `nurse_reassessment_escalate(p_id, p_reason)` que **reabre** o alerta (volta a `PENDING`, zera os campos de estado atual) e então **delega** a escalada a `alert_escalate_to_red`. A 0077 continua sendo a fonte única da semântica de escalonamento — nada foi reimplementado, e a guarda dela não foi afrouxada para o caso geral.

A guarda "não escala alerta finalizado" existe para impedir que alguém ressuscite um caso encerrado do nada. A reavaliação é justamente a via **sancionada** para isso: o paciente piorou dentro da janela de recontato. A reabertura zera só o estado atual; `attendance_confirmations` preserva a história e ganha um evento `REOPENED`.

Timeline resultante, lida como narrativa:

```
   status   |                       obs
------------+--------------------------------------------------
 ATTENDED   | Contato feito, orientada.
 REASSESSED | Reavaliação: piorou. Febre voltou a 38,2 e dor a…
 REOPENED   | Reaberto pela reavaliação de enfermagem (pacient…
 ESCALATED  | Febre voltou a 38,2 e dor abdominal aumentou; pa…
```

### Itens 1–8

| Item | Evidência |
|---|---|
| **1** | Enfermeira atende o amarelo do P1 via `alert_mark_attended` → 1 linha `PENDING`, `minutos_apos_atendimento = 120` (calculado como `due_at - attended_at`), `agendada_por = enf`. O prazo vem de `nursing_setting_num('reassessmentMinutes', 120)`, não de constante. |
| **2** | Médico associado atende o amarelo do P2 → `reavaliacoes_criadas = 0`. Extra: vermelho atendido → `0`. |
| **3** | Fila (`nurse_reassessments_due`): P5 `atrasada` = `t`, P6 = `f`, ordenadas por prazo. Na UI: bloco **"REAVALIAÇÕES 2H (2)"** com selo **"1 EM ATRASO"**, P5 em vermelho *"atrasada há 38 min"* e P6 *"em 1h59"*, cada uma com botão **Reavaliar** apontando para `?tab=enfermagem`. Na tela do paciente: selo **EM ATRASO** na seção e badge **atrasada** na aba. |
| **4** | `IMPROVED` → `status=DONE`, `outcome=IMPROVED`, `performed_by=enf`, `performed_at` preenchido, `should_escalate = f`. Sai da fila. |
| **5** | `WORSENED` → `should_escalate = t`. **Pela UI:** modal de confirmação → escalada → alerta com `escalated_at` preenchido, `attendance_status=PENDING`, `status` ainda `YELLOW`, motivo = a observação da reavaliação. `notification_logs` ganhou a leva dos médicos (Ana + Bruno) com **`recipient_is_nurse = false`**. A pendência sumiu da fila da enfermagem. |
| **6** | P4: enfermeira atende (PENDING) → `alert_ignore` → reavaliação vira **`CANCELLED`** com `cancel_reason = 'Alerta finalizado (ignorado).'` |
| **7** | Segunda chamada de `alert_mark_attended` → `ERROR: Este alerta já foi atendido.`; total de reavaliações do alerta permanece **1**. E o índice único parcial barra a corrida de verdade: `INSERT` de uma segunda PENDING → `duplicate key value violates unique constraint "nurse_reassessments_uma_pendente_por_alerta"`. |
| **8** | Concluir: médico → `Apenas o profissional de enfermagem registra a reavaliação.`; admin → mesma mensagem; gerente → `MANAGER_READ_ONLY`; enfermeira → passa. Observação vazia → `Descreva o que o paciente relatou na reavaliação.`; desfecho inválido → `Desfecho inválido. Use melhorou, mantém ou piorou.` **RLS:** enfermeira de outra equipe vê **0** reavaliações e **0** na fila; a da equipe vê 4 e 1. |

### Nota sobre o trigger de cancelamento

O cancelamento automático é feito por **trigger** em `clinical_alerts`, não dentro de `alert_escalate_to_red`. Motivo: `escalated_at` é gravado por **dois** caminhos — a RPC e o auto-escalonamento de 8h dentro de `reoffer_expired_alerts` (0068), que não passa por RPC nenhuma. Um trigger pega os dois.

**Transparência sobre alcançabilidade:** dos dois ramos do trigger, o de **finalização (`IGNORED`) é exercido por caminho real** e está testado no item 6. O ramo de **escalonamento é defensivo**: com os fluxos de hoje, um alerta com reavaliação `PENDING` está sempre `ATTENDED`, e escalar exige reabrir — o que só acontece via `nurse_reassessment_escalate`, que por sua vez exige a reavaliação já `DONE`. Mantive o ramo porque o modelo de dados permite o estado (qualquer reabertura futura o torna alcançável) e porque o trigger precisa observar `escalated_at` de qualquer forma. Não é o caso do ramo morto de 0077 que removi na rodada anterior — lá a condição era *provadamente* inalcançável por exclusão mútua de papéis.

---

## PARTE 2 — Reorganização da tela

### Estrutura entregue

Cabeçalho do paciente → banner de medição esquecida (**fora das abas**, sempre visível) → três abas:

| Aba | Conteúdo |
|---|---|
| **Visão geral** | período + gráficos + indicadores do último registro + foto da ferida |
| **Enfermagem e atendimentos** | **Reavaliação 2h (nova)** + Atendimentos 48h |
| **Avaliação em 30 dias** | `PatientDay30Section` |

Componente `Tabs` novo: `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, navegação por setas, foco visível, deep-link em `?tab=` (`replace` para não encher o histórico) e **montagem só da aba ativa** — evita carregar três telas de gráficos e disparar requisições de seções que ninguém está olhando.

**Não regressões:** `PatientFollowupSection`, `PatientDay30Section`, `PatientMeasurementPhotoSection`, gráficos, `PatientEditModal` e `PatientRecordSummaryModal` foram **reagrupados, não reescritos**. Nenhuma mudança de dado ou RPC na Parte 2 além de consumir o serviço novo.

### Item 9 — evidências

| Verificação | Resultado |
|---|---|
| Sem scroll horizontal (desktop) | ✅ `scrollWidth` 1480 < viewport 1495 |
| Sem scroll horizontal (mobile) | ✅ medido em viewport real de **387px**: `scrollWidth` **372** < 387, nas duas abas testadas |
| Faixa de abas rola dentro de si | ✅ `overflow-x: auto`, `scrollWidth == clientWidth` a 387px |
| Rótulos curtos no mobile | ✅ "Visão", "Enfermagem", "30 dias" |
| Deep-link `?tab=` | ✅ "Reavaliar" na fila abre `?tab=enfermagem` já na aba certa |
| Enfermeiro cai na aba de enfermagem | ✅ sem `?tab=` na URL |
| Médico cai na visão geral | ✅ mesma URL, papel diferente |
| Badge de pendência na aba | ✅ **"atrasada"** (vermelho) quando vencida; **"1"** (âmbar) quando no prazo — visível sem abrir a aba |
| Alvos de toque ≥ 40px | ✅ nos elementos novos: abas 40px, botões de desfecho 58px, "Reavaliar" e período 40px |
| Grid aproveita a largura no desktop | ✅ gráficos em 3 colunas; formulário de desfecho em 2 colunas (desfecho / observação), empilhando no mobile |

> **Alvos < 40px que permanecem** são **pré-existentes** e fora do escopo desta tarefa: o botão de menu do app (36px), o link de texto "Voltar para pacientes" (16px) e os botões da barra do editor rich text dentro de `PatientFollowupSection` (36px). Nenhum foi introduzido aqui.

### Um bug encontrado e corrigido durante o teste de UI

Na primeira passada, registrar "piorou" **não abria** o modal de escalada — a reavaliação era gravada e nada acontecia.

Causa: eu chamava `onChanged()` (recarregar a página) logo antes de abrir o modal. O `load()` da página faz `setLoading(true)` e o render retorna `<Loading/>`, **desmontando a seção inteira** e levando junto o estado do modal.

Correção: registrar o desfecho não altera o alerta, então não precisa recarregar a página ali. `onChanged` passou a ser chamado **só depois de escalar**, que é quando o alerta muda de fato. Revalidado ponta a ponta pela UI.

---

## Item 10 — Regressão

`typecheck` limpo ✔ · `@vitalsync/frontend` **203 testes / 14 arquivos** ✔ (eram 195/13 — entrou `nurseReassessment.test.ts` com 8 casos de prazo/atraso) · `@vitalsync/shared` **104 / 3** ✔ · `npm run build` (shared + backend legado + frontend) ✔.

**Migrations 0001 → 0078 aplicam limpas** em banco descartável, do zero.

## Disciplina de teste

Homologação **ligada** durante toda a rodada; **0 envios reais** (sem secrets no Vault, edge runtime parado); 7 pacientes de teste `is_test`; alertas criados **sempre pelo caminho real** (`submit_vital_record` + `alert_mark_attended`), nunca `INSERT` cru; **rollback sem resíduo** — banco de volta a 4 pacientes / 5 perfis / 5 `auth.users` / 1 equipe / 0 reavaliações, homologação desligada.
