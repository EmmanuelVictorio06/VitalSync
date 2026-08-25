# Prompt — Reavaliação de enfermagem em 2h + reorganização da tela de Acompanhamento Individual (VitalSync)

> Cole no assistente de código, trabalhando dentro de `D:\VitalSync`.
> Duas entregas nesta tarefa: **(1)** nova funcionalidade "reavaliação de enfermagem em 2h" após um alerta AMARELO ser atendido; **(2)** reorganizar a tela de Acompanhamento Individual (`frontend/src/pages/PatientDashboardPage.tsx`) para caber bem em desktop e mobile.
> Padrão do repo: migration NOVA a partir de **0078** (append-only), aditiva e idempotente; testar E2E local com **homologação LIGADA** (0 envios reais, `is_test`); caminho REAL (RPC), nunca INSERT cru; nada commitado até PASS; relatório go/no-go no fim.

---

## Contexto (confirme lendo o código antes de mexer)

**Tela:** `frontend/src/pages/PatientDashboardPage.tsx` (título de nav "Acompanhamento Individual"). Hoje é uma rolagem ÚNICA com estas seções empilhadas, na ordem:
1. Voltar + **Resumo do paciente** (status, datas, resumo de prontuário, botões Editar / WhatsApp / **Marcar atendido** do alerta atual);
2. **Banner** de medição esquecida (janela fechada sem registro);
3. Toggle de **Período** (Manhã/Noite/Ambos);
4. **Gráficos vitais** (temperatura, SpO₂, PA, FC, passos);
5. **Indicadores do último registro** (dor, dispneia, diurese, vômitos, sangramento);
6. **Foto** da ferida/dreno (`PatientMeasurementPhotoSection`);
7. **Atendimentos (videochamada 48h)** — `components/PatientFollowupSection.tsx` (tabela `patient_followups`, 0050);
8. **Avaliação em 30 dias** — `components/PatientDay30Section.tsx` (0055).
É role-aware em pontos isolados (`useAuth().hasRole`, `Role.SURGEON/ASSOCIATE/NURSE`, `permissionService.canEditPatient`).

**Atendimento do alerta (modelo atual):** `services/patientDashboardService.ts → markAttended()` chama a RPC **`alert_mark_attended(p_alert, p_professional, p_observation)`**, que marca `clinical_alerts.attendance_status='ATTENDED'` / `attended=true` / `attended_by` e grava em **`attendance_confirmations`** (status ATTENDED/IGNORED/ESCALATED, observation). O alerta atual carrega `attendance_status`, `attended`, `attended_by`, `escalated_at/by/reason`, `in_analysis_by`. Escalada amarelo→vermelho é a RPC **`alert_escalate_to_red(p_alert, p_reason)`** (0077, só enfermagem). `is_nurse(uid)`, `can_act_on_alert(team, patient)`, `is_team_manager()` existem. Parâmetros operacionais editáveis vivem em **`app_settings`** (0063). Filas/lembretes usam pg_cron (`nurse_queue_sweep` 0068, `missed_measurement`/`reminder_logs` 0061/0069) sob o gate de homologação.

---

# PARTE 1 — Reavaliação de enfermagem em 2h

## Requisitos

1. Quando um alerta **AMARELO** é **atendido por um profissional de enfermagem**, o sistema agenda automaticamente uma **reavaliação em 2 horas**: a enfermagem deve recontatar o paciente para verificar se melhorou e **registrar** esse recontato.
2. A reavaliação pendente (com horário previsto e estado **em atraso** quando passa do prazo) aparece na tela de **Acompanhamento Individual** e também na **fila/painel da enfermagem** (para não depender de abrir cada paciente).
3. Ao registrar, a enfermagem informa o desfecho — **melhorou / mantém / piorou** — mais uma observação. Registrar **conclui** a reavaliação.
4. Se o desfecho for **piorou**, oferecer **escalar para vermelho** na hora (reaproveitando `alert_escalate_to_red`, com a observação como motivo).
5. Não dispara para médico automaticamente — segue a regra da 0077 (amarelo é da enfermagem; médico só entra via escalada).

## Design backend (migration nova `0078_reavaliacao_2h_enfermagem.sql`, aditiva/idempotente)

- **Tabela `nurse_reassessments`** (uma linha por reavaliação): `id`, `alert_id` (FK `clinical_alerts` on delete cascade), `patient_id`, `team_id`, `scheduled_by` (enfermeiro que atendeu), `due_at` (= `attended_at` + intervalo), `status` (`PENDING`|`DONE`|`CANCELLED`), `outcome` (`IMPROVED`|`UNCHANGED`|`WORSENED`, nulo enquanto PENDING), `observation` text, `performed_by`, `performed_at`, `created_at`. Índice parcial por `status='PENDING'`/`due_at` e por `team_id`.
- **Intervalo configurável:** ler de `app_settings` (chave nova, ex. `nurse_reassessment_minutes`, default **120**) — mesmo padrão dos outros parâmetros operacionais (0063). Não hardcodar 2h.
- **Agendamento:** estender **`alert_mark_attended`** (via `create or replace` se a assinatura não muda; senão DROP+recreate com re-grant a `authenticated`) para, ao concluir a marcação, inserir **uma** `nurse_reassessments` PENDING quando: `is_nurse(p_professional)` **e** a severidade EFETIVA do alerta é AMARELA (`status='YELLOW'` e `escalated_at is null`). Idempotente: no máximo **uma** reavaliação PENDING por alerta (evitar duplicar se marcado de novo).
- **Conclusão:** RPC **`nurse_reassessment_complete(p_id, p_outcome, p_observation)`** — só `is_nurse()` e `can_act_on_alert`; exige observação; marca `status='DONE'`, grava `outcome/performed_by/performed_at`; audita (`audit_alert_action`). Se `p_outcome='WORSENED'`, **não** escala sozinha — devolve um sinal/campo que o front usa para oferecer a escalada (a escalada continua sendo ato explícito via `alert_escalate_to_red`). `SECURITY DEFINER`, grant só a `authenticated`.
- **Cancelamento automático:** se o alerta for **escalado para vermelho** antes da reavaliação (a 0077 já grava `escalated_at`), a reavaliação PENDING vira `CANCELLED` (agora é caso do médico). Fazer isso dentro de `alert_escalate_to_red` (ou por trigger em `clinical_alerts` quando `escalated_at` passa a não-nulo). Idem se o alerta for finalizado.
- **Rede de segurança (opcional, recomendado):** um `pg_cron` leve (espelhando `nurse_queue_sweep`/`reminder_logs`, sob o gate de homologação) que marca reavaliações **em atraso** e, passado um limite maior, escalona ou avisa — sem envio real em homologação. Se implementar, `log()`/auditar o que foi varrido; se não, deixar explícito como pendência de staging.
- **RLS:** leitura/escrita restritas à equipe do paciente + enfermagem (reusar `can_act_on_alert`/`is_nurse`); admin lê. Sem policy de escrita direta — só as RPCs definer.

## Design front

- **Serviço** `services/nurseReassessmentService.ts`: `listByPatient(patientId)`, `listMine()`/`listDue()` (pendentes/atrasadas da enfermagem logada), `complete(id, outcome, observation)`.
- **Nova seção** `components/NurseReassessmentSection.tsx` na Acompanhamento Individual: lista as reavaliações do paciente com **horário previsto**, **contagem regressiva** e destaque de **em atraso**; formulário para registrar desfecho (melhorou/mantém/piorou + observação); no caso "piorou", botão **"Escalar para vermelho"** que chama `alert_escalate_to_red` com a observação como motivo. Histórico das concluídas (quem/quando/desfecho). Visível principalmente para enfermagem (respeitar RLS — se não houver dado, não renderiza card vazio para outros papéis).
- **Fila da enfermagem** (`NurseDashboard`/`NurseTriage`): adicionar um bloco "Reavaliações 2h" com as pendentes/atrasadas (paciente, horário previsto, atraso), link direto para a tela do paciente. É o que garante o requisito 2 (não depende de abrir cada paciente).
- Sem `localStorage`/`sessionStorage` como fonte de verdade.

---

# PARTE 2 — Reorganizar a tela de Acompanhamento Individual (desktop + mobile)

## Diagnóstico
Hoje são ~9 seções numa rolagem única muito longa; no mobile isso vira um scroll interminável e no desktop desperdiça a largura (tudo em coluna única). Some a isso a nova seção de reavaliação → precisa de estrutura, não de mais uma seção empilhada.

## Estrutura proposta (preservando os componentes existentes — envolver, não reescrever)

- **Cabeçalho fixo (sticky) do paciente:** nome + `StatusBadge` + ações rápidas (WhatsApp, Editar, e a ação do **alerta atual**: Marcar atendido / status). Fica visível ao rolar/trocar de aba.
- **Abas / segmented control** logo abaixo do cabeçalho, com deep-link por `?tab=` (uma aba por grupo):
  1. **Visão geral** — período + gráficos vitais + indicadores do último registro + foto da ferida.
  2. **Enfermagem / Atendimentos** — alerta atual + **Reavaliação 2h (NOVA)** + Atendimentos 48h (`PatientFollowupSection`). É a aba central do fluxo de enfermagem.
  3. **Avaliação 30 dias** — `PatientDay30Section`.
  (Se preferir, "Prontuário/Resumo" pode ser uma 4ª aba, ou ficar no cabeçalho.)
- **Ordem por relevância clínica + por papel:** enfermeiro cai por padrão na aba **Enfermagem/Atendimentos**; médico/cirurgião na **Visão geral**. Badges de pendência nas abas (ex.: "Reavaliação em atraso", "medição esquecida") para não esconder o urgente atrás de uma aba.
- **O banner de medição esquecida** e alertas críticos ficam **acima das abas** (sempre visíveis), não dentro de uma aba.

## Regras responsivas
- **Desktop (≥ lg):** abas horizontais; dentro de "Visão geral", aproveitar a largura em 2–3 colunas (grid que já existe nos gráficos/indicadores). Onde fizer sentido, layout de 2 colunas (ex.: formulário à esquerda, histórico à direita).
- **Mobile:** abas viram um **segmented control** rolável ou um seletor; cada seção em coluna única; blocos internos longos (histórico de atendimentos, gráficos) **colapsáveis** (accordion) com o mais recente aberto. Se os gráficos hoje aparecem como carrossel no mobile (indicadores em "dots"), manter o carrossel só nessa faixa e grid no desktop. Nada deve causar **scroll horizontal** da página — conteúdo largo (gráficos, tabelas) rola dentro do próprio container (`overflow-x:auto`).
- Alvos de toque ≥ 40px; tipografia e espaçamentos já do design system (`components/ui`).
- Manter acessibilidade: abas com `role="tablist"`/`aria-selected`, foco visível, e o conteúdo de cada aba com heading.

## Não regressões
- Todos os componentes atuais (`PatientFollowupSection`, `PatientDay30Section`, `PatientMeasurementPhotoSection`, gráficos, `PatientEditModal`, `PatientRecordSummaryModal`) continuam funcionando — apenas reagrupados nas abas. Nenhuma mudança de dado/RPC nesta parte 2 além de consumir o novo serviço da parte 1.

---

## Casos extremos (tratar)
- Alerta amarelo atendido por **não-enfermeiro** (médico/associado) → **não** agenda reavaliação de 2h (é fluxo da enfermagem).
- Alerta **vermelho** atendido → não agenda 2h.
- Marcar atendido duas vezes / corrida → no máximo uma reavaliação PENDING por alerta.
- Alerta escalado ou finalizado antes das 2h → reavaliação PENDING vira `CANCELLED`.
- Reavaliação **em atraso** deve ficar visível (badge/estado), nunca sumir silenciosamente.
- Fuso: usar o fuso da clínica (America/Sao_Paulo) para "horário previsto" e "em atraso", coerente com M-15/M-16.

## Convenções obrigatórias do repo
- Migration nova a partir de **0078**, aplica limpo em `0001→0078` (`supabase migration up`; se resetar, `./supabase/_scripts/reset_keep_data.ps1`). Mudança de assinatura de função = DROP+recreate + re-grant só a `authenticated`.
- **Homologação LIGADA** nos testes; 0 envios reais; tudo `is_test`; rollback sem resíduo; **nada commitado** até PASS.
- Testar pelo caminho REAL (gerar amarelo via `staff_insert_vital_record`, atender via `alert_mark_attended` como enfermeiro), nunca INSERT cru.
- Gotcha do seed: `trg_protect_profile` (o `seed.sql` já desliga no upsert).

## Critérios de aceite / plano de teste (E2E local, tudo PASS antes de commit)
1. Amarelo atendido por **enfermeiro** → cria **1** `nurse_reassessments` PENDING com `due_at ≈ atendido_em + 120min`.
2. Amarelo atendido por **médico** → **não** cria reavaliação.
3. Aparece na Acompanhamento Individual (aba Enfermagem) e na fila da enfermagem, com horário previsto e estado **em atraso** após o prazo.
4. Registrar **melhorou/mantém** → `status=DONE`, `outcome`/`performed_by`/`performed_at` gravados; some das pendências.
5. Registrar **piorou** → oferece escalar; ao escalar, `alert_escalate_to_red` roda com a observação como motivo e a rota vermelha vai aos médicos (checar `notification_logs.recipient_is_nurse=false`).
6. Escalar/finalizar o alerta antes das 2h → reavaliação PENDING vira `CANCELLED`.
7. Idempotência: marcar atendido de novo não duplica reavaliação.
8. Autorização: não-enfermeiro não conclui reavaliação; RLS não vaza reavaliação de outra equipe.
9. **Reorganização:** em desktop e mobile (DevTools responsivo), sem scroll horizontal da página; abas navegáveis com deep-link `?tab=`; enfermeiro cai na aba de enfermagem, médico na visão geral; badges de pendência (reavaliação em atraso / medição esquecida) visíveis.
10. Regressão automatizada: `@vitalsync/shared`, `@vitalsync/frontend`, `typecheck`, `build (CI)` verdes; migrations `0001→0078` limpas. Checklist manual da UI (projeto sem teste de render).

Entregar **relatório go/no-go** por item (1–10) no formato de `docs/RELATORIO_TESTES_PILOTO.md`, com premissas e itens só testáveis em staging (pg_cron real, envio real) marcados como fora do escopo local.

---

## Melhorias sugeridas (opcionais, se não atrapalharem o núcleo)
- **Contagem regressiva + badge de atraso** com cores do design system; "atrasada há X min".
- **Reagendar/adiar** a reavaliação com motivo (ex.: paciente não atendeu) em vez de só concluir — registra tentativa de contato (fecha também a pendência de backlog `alert_register_contact`, que documenta o contato pela UI).
- **Linha do tempo do alerta** por paciente (criado → atendido → reavaliação 2h → escalado → resolvido) — dá rastreabilidade para a conferência manual do piloto.
- **Rede de 2ª ordem:** se a reavaliação não for feita em X h além do prazo, auto-escalonar/avisar (espelhando o sweep de 8h da 0068) — sem envio real em homologação.
- **Preferência de aba lembrada** por papel (via query string, não localStorage), para o enfermeiro voltar direto ao fluxo dele.
