# Pontos pendentes de confirmação médica

Este documento lista os valores clínicos que **ainda dependem de confirmação médica** e as
**divergências conhecidas** entre o protocolo do estudo (`FLUXOoperacional.pdf`) e as regras
implementadas em `packages/shared/src/clinical/thresholds.ts` (fonte única — espelhada em
`eval_clinical_status`, ver `supabase/migrations/0048_ajustes_clinicos.sql` e
`0051_fase1_conformidade_alertas.sql`).

📁 Arquivo único: [`packages/shared/src/clinical/thresholds.ts`](../packages/shared/src/clinical/thresholds.ts)
🚩 Flag no código: `PENDING_MEDICAL_VALIDATION: true`

Para listar as pendências em tempo de execução (frontend): `listPendingMedicalValidations()`
em `thresholds.ts`.

---

## 1. Pressão arterial sistólica — protocolo diverge do valor confirmado (ago/2026)

| Fonte | Vermelho |
|-------|----------|
| Protocolo do estudo (`FLUXOoperacional.pdf`, 5.7.1) | PAS **> 160** (sem faixa amarela alta explícita) |
| Código atual (confirmado pela equipe médica, ago/2026 — migration `0048`) | PAS **≥ 140** (amarelo 130–139) |

**Status:** ⚠️ PENDENTE — não alterado. A regra ago/2026 pode ser uma decisão médica posterior
e mais rigorosa que o protocolo, ou o protocolo pode não ter sido atualizado desde então. Não
decidimos sozinhos: o cirurgião responsável precisa confirmar **qual das duas regras vale** antes
de qualquer mudança em `thresholds.ts`/`eval_clinical_status`.

## 2. Saturação de O2 — fronteira exata em 92% (ambiguidade no próprio protocolo)

| Fonte | Verde | Amarelo | Vermelho |
|-------|-------|---------|----------|
| Protocolo (5.7.1) | ≥ 95% | 92–94% | ≤ 92% |
| Código atual | > 94% | 92,1–94% | ≤ 92% |

O próprio protocolo lista o valor **92** tanto no amarelo ("92–94") quanto no vermelho ("≤92") —
uma sobreposição, não uma regra clara. Para valores inteiros (o que o oxímetro sempre informa) as
duas fontes já concordam, **exceto exatamente em 92**, onde o código mantém RED (mais conservador
para um sinal crítico). **Status:** ⚠️ Documentado, não alterado — aguardando confirmação de qual
lado da ambiguidade do protocolo deve valer.

## 3. Escala de satisfação do D+30 — assunção, não definida no protocolo

O protocolo (5.8) pede um questionário de satisfação (segurança/facilidade de uso/comunicação/
satisfação geral + campo aberto), mas o resumo disponível não especifica a escala exata.
Implementado como **Likert 1–5** (1 = muito insatisfeito, 5 = muito satisfeito) em
`patient_day30_assessments` (migration `0055`) — é o padrão mais comum para esse tipo de
questionário, mas **não é uma definição literal do protocolo**. Confirmar com o time do estudo;
se a escala for diferente, ajustar a constraint `day30_satisfaction_range_check` (migration nova)
e `PatientDay30Section.tsx`.

## 4. "Perda de seguimento" — definição operacional, não numérica no protocolo

O protocolo (5.11) lista "perda de seguimento" como métrica do desfecho primário, mas não define
um corte numérico exato no resumo disponível. Implementado em `adherenceService.ts` como: **janela
de 10 dias encerrada COM adesão < 50%**. É uma assunção operacional razoável, não uma regra
confirmada — ajustar `LOST_TO_FOLLOWUP_THRESHOLD_PCT` nesse arquivo se o time do estudo definir
outro critério (ex.: dias consecutivos sem coleta, independente da adesão total).

---

## Alterações já aplicadas na Fase 1 de conformidade (não são mais pendências)

Estas regras **foram alteradas** para seguir o protocolo do estudo e já estão implementadas em
`thresholds.ts`/`status.ts` + `eval_clinical_status` (migration `0051`):

- **Ingestão hídrica**: "não consegue tomar líquidos" mudou de 🟡 Amarelo para 🔴 **Vermelho**
  (protocolo 5.7.3 lista como critério vermelho).
- **Passos**: a referência deixou de ser "o dia anterior" e passou a ser uma janela de **~48h**;
  o corte único agora é **queda ≥50% → Amarelo**. Não existe mais vermelho isolado de passos — o
  vermelho de passos só ocorre **combinado** (ver abaixo).
- **Critérios combinados de vermelho** (novos, protocolo 5.7.2/5.7.3), avaliados mesmo quando
  nenhum sinal isolado chegaria a vermelho sozinho:
  - queda ≥50% dos passos (48h) **+** (FC > 110 **ou** aumento ≥3 pontos na dor vs. a medição
    anterior);
  - 2–3 micções/dia **+** (FC ≥ 110 **ou** SpO₂ ≤ 92 **ou** Temperatura ≥ 38 **ou** queda ≥50%
    dos passos).

## Valores JÁ confirmados (implementados como definitivos)

| Sinal | Verde | Amarelo | Vermelho |
|-------|-------|---------|----------|
| Temperatura | < 37,8 °C | 37,8–38,4 °C | ≥ 38,5 °C |
| Saturação SpO₂ | > 94% (ver pendência acima p/ o valor 92) | 92,1–94% | ≤ 92% |
| Frequência cardíaca | ≤ 110 bpm | 111–119 bpm | ≥ 120 bpm |
| Pressão sistólica (ago/2026 — ver pendência acima) | 100–129 mmHg | 90–99 / 130–139 mmHg | ≤89 / ≥140 mmHg |
| Pressão diastólica | 60–89 mmHg | 50–59 / 90–99 mmHg | ≤49 / ≥100 mmHg |
| Diurese | ≥ 4 micções/dia | 2–3 micções/dia | < 2 micções/dia |
| Ingestão hídrica | Sim | — | Não |
| Vômitos | Não | — | Sim |
| Sangramento | Não | — | Sim |
| Dor (0–10) | 0–6 | 7–8 | 9–10 |
| Dispneia (3 níveis) | Sem dispneia | Leve | Moderada/intensa |
| Passos | sem redução relevante | queda ≥50% vs. referência 48h | só combinado (ver acima) |

---

## Como confirmar / alterar

1. Abra `packages/shared/src/clinical/thresholds.ts`.
2. Ajuste os valores em `INPUT_RANGES` (validação de entrada) e/ou `ALERT_THRESHOLDS`/
   `STEPS_RULES`/`WATER_INTAKE_RULE` (limiares de alerta).
3. Espelhe a mudança em `eval_clinical_status` (nova migration `supabase/migrations/NNNN_...sql`,
   aditiva — nunca edite uma migration já aplicada).
4. Adicione/ajuste os testes em `packages/shared/src/clinical/status.test.ts` cobrindo os novos
   limites.
5. Recompile o pacote: `npm run build:shared` (backend e frontend passam a usar os novos valores
   automaticamente — fonte única de verdade).
