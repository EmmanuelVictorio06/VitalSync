# Prompt — Rodada de testes: Reavaliação de enfermagem em 2h + reorganização da tela (VitalSync)

> Cole no assistente de código, dentro de `D:\VitalSync`. Rode **depois** de implementada a funcionalidade descrita em `supabase/_scripts/PROMPT_reavaliacao_2h_e_reorg_tela.md` (migration **0078**).
> Padrão do piloto: ambiente LOCAL, **homologação LIGADA o tempo todo**, **0 envios reais** (tudo `is_test`), testar pelo **caminho REAL** (RPC que cria/atende o alerta), rollback sem resíduo, **nada commitado** até tudo PASS. Entregar um **relatório go/no-go** por item, no formato de `docs/RELATORIO_TESTES_PILOTO.md`.

---

## O que está sendo testado (confirme os nomes reais no código antes de rodar)

- Tabela `nurse_reassessments` (PENDING/DONE/CANCELLED, `due_at`, `outcome`, `alert_id`, `patient_id`, `team_id`, `scheduled_by`, `performed_by/at`).
- Agendamento embutido em `alert_mark_attended(p_alert, p_professional, p_observation)`: só quando `is_nurse(p_professional)` **e** a severidade efetiva do alerta é AMARELA (`status='YELLOW'` e `escalated_at is null`).
- Intervalo configurável em `app_settings` (ex.: `nurse_reassessment_minutes`, default **120**).
- RPC `nurse_reassessment_complete(p_id, p_outcome, p_observation)` (desfecho `IMPROVED`/`UNCHANGED`/`WORSENED`).
- Cancelamento automático da reavaliação PENDING quando o alerta é escalado (`alert_escalate_to_red`) ou finalizado.
- Front: seção `NurseReassessmentSection` na Acompanhamento Individual + bloco na fila da enfermagem (`NurseDashboard`/`NurseTriage`); tela reorganizada em abas (`?tab=`), responsiva.

> ⚠️ Sempre pelo caminho real: gerar amarelo via `staff_insert_vital_record` (ex.: 37,8 °C) e atender via `alert_mark_attended` — nunca INSERT cru em `clinical_alerts`.

---

## Precondições
1. `supabase migration up` até a **0078**; `0001→0078` aplicam limpo. Se precisar zerar, `./supabase/_scripts/reset_keep_data.ps1`.
2. **Homologação LIGADA** com whitelist de teste (números fictícios). Todo envio deve virar `PENDING`/`SKIPPED_TEST_MODE` — nunca real.
3. Seed com papéis corretos (o `seed.sql` já desliga `trg_protect_profile` no upsert): admin, cirurgião (equipe 1), médico associado (equipe 1), **enfermeiro** (equipe 1) e paciente na janela.
4. Para acelerar os testes de prazo/atraso, saber alterar o intervalo via `app_settings` (ex.: baixar `nurse_reassessment_minutes` para 1–2 min num cenário controlado) e restaurar 120 ao final.

---

## Bloco A — Agendamento (o gatilho de 2h)
- **A1.** Amarelo (37,8 °C) atendido por **enfermeiro** via `alert_mark_attended` → cria **exatamente 1** `nurse_reassessments` PENDING, com `alert_id`/`patient_id`/`team_id` corretos, `scheduled_by` = enfermeiro, `due_at ≈ atendido_em + 120 min`.
  `select status, due_at, scheduled_by from nurse_reassessments where alert_id='<amarelo>';`
- **A2.** Amarelo atendido por **médico/associado** → **não** cria reavaliação.
- **A3.** Alerta **VERMELHO** (38,9 °C) atendido → **não** cria reavaliação (só amarelo).
- **A4.** Idempotência: marcar atendido novamente (ou dois enfermeiros em corrida) → continua **1** PENDING, sem duplicar.
- **A5.** Intervalo vem de `app_settings` (não hardcodado): mudar `nurse_reassessment_minutes` e conferir que um novo atendimento usa o novo `due_at`.

## Bloco B — Conclusão e desfechos
- **B1.** `nurse_reassessment_complete(<id>, 'IMPROVED', 'paciente melhor')` → `status=DONE`, `outcome`/`performed_by`/`performed_at` gravados; some das pendências.
- **B2.** `UNCHANGED` idem (concluída, sem escalar).
- **B3.** `WORSENED` → conclui e **oferece** escalar; ao escalar, `alert_escalate_to_red` roda com a observação como motivo e a rota vermelha vai aos médicos.
  `select recipient_is_nurse from notification_logs where alert_id='<amarelo>' order by created_at desc;` → nova leva `false` (médicos).
- **B4.** Concluir exige observação: `p_observation` vazio → erro.
- **B5.** Concluir uma reavaliação já `DONE`/`CANCELLED` → erro (não reabre).

## Bloco C — Cancelamento, autorização e escopo
- **C1.** Escalar o alerta (`alert_escalate_to_red`) **antes** de concluir a reavaliação → a PENDING vira `CANCELLED` (agora é do médico).
- **C2.** Finalizar o alerta (ATTENDED/IGNORED conforme o fluxo) antes das 2h → PENDING vira `CANCELLED`.
- **C3.** Autorização: **não-enfermeiro** (médico/admin) chamando `nurse_reassessment_complete` → negado; **gerente** → `MANAGER_READ_ONLY` (se aplicável).
- **C4.** RLS: enfermeiro/equipe A **não** enxerga nem conclui reavaliação de paciente da equipe B.

## Bloco D — Prazo / atraso (rede de segurança)
- **D1.** Com intervalo curto (via `app_settings`), passar do `due_at` → a reavaliação aparece como **em atraso** (na tela e na fila), nunca some silenciosamente.
- **D2.** Se implementado o sweep de 2ª ordem (espelho da 0068): passado o limite maior, ele marca/escalona/avisa — **sem envio real** em homologação; conferir auditoria/log do que foi varrido. (Se não implementado, marcar como pendência de staging.)
- **D3.** Fuso: `due_at` e "em atraso" no fuso da clínica (America/Sao_Paulo), coerente com M-15/M-16.

## Bloco E — Front (tela + fila + responsivo)
- **E1.** Acompanhamento Individual (aba **Enfermagem/Atendimentos**): a reavaliação pendente aparece com **horário previsto**, **contagem regressiva** e destaque de **em atraso**; formulário registra o desfecho; "piorou" mostra o botão **Escalar para vermelho** (chama `alert_escalate_to_red` com a observação). Histórico das concluídas (quem/quando/desfecho).
- **E2.** Fila da enfermagem (`NurseDashboard`/`NurseTriage`): bloco "Reavaliações 2h" lista pendentes/atrasadas (paciente, horário, atraso) com link para o paciente — requisito de "não depender de abrir cada paciente".
- **E3.** Reorganização em abas: navegação por `?tab=` (deep-link); **enfermeiro** cai por padrão na aba de enfermagem, **médico/cirurgião** na Visão geral; badges de pendência nas abas (reavaliação em atraso / medição esquecida); banner de urgência acima das abas.
- **E4.** Responsivo (DevTools): desktop aproveita a largura (colunas); mobile com segmented control + accordions; **sem scroll horizontal** da página; conteúdo largo (gráficos/tabelas) rola no próprio container. Alvos de toque ≥ 40px; abas com `role="tablist"`/`aria-selected` e foco visível.
- **E5.** Não regressão: `PatientFollowupSection` (48h), `PatientDay30Section`, foto da ferida, gráficos, modais de editar/prontuário continuam funcionando, apenas reagrupados nas abas.

## Bloco F — Regressão automatizada + integração
- **F1.** `@vitalsync/shared`, `@vitalsync/frontend`, `typecheck`, `build (CI)` verdes.
- **F2.** Migrations `0001→0078` aplicam limpas (`db reset`); nenhuma alteração de valor clínico.
- **F3.** Homologação LIGADA o tempo todo, 0 envios reais, tudo `is_test`, rollback sem resíduo, **nada commitado**.

---

## Entregável final
Relatório **go/no-go** por item (A1–A5, B1–B5, C1–C4, D1–D3, E1–E5, F1–F3), cada um com PASS/FAIL + evidência (query e resultado, ou passo de UI/print). No topo, liste premissas assumidas e itens só verificáveis em staging (pg_cron em horário real, envio real de WhatsApp) como **fora do escopo local**. Ao final, restaure `nurse_reassessment_minutes=120` e deixe o ambiente limpo (rollback), sem commit.
