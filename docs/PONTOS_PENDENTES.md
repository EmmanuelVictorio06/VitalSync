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

## 5. Lançamento pela equipe de medição esquecida — decisões operacionais assumidas

Migrations `0059`–`0062` implementam o alerta de esquecimento à equipe (priorizando o
Profissional de Enfermagem) e a RPC `staff_insert_vital_record`, que permite lançar em nome do
paciente o período de hoje que ele esqueceu. Três decisões foram tomadas sem validação adicional
do time do estudo e podem precisar ser revisitadas:

- **Só o dia corrente**: não há lançamento retroativo de dias anteriores dentro dos 10 dias de
  acompanhamento — só o período de hoje, e só depois que a janela já fechou (10:00/20:00). Se o
  time do estudo quiser recuperar lacunas de dias passados, o gate de janela em
  `staff_insert_vital_record` (migration `0062`) precisa ser revisto.
- **Quem pode lançar**: só Profissional de Enfermagem, Cirurgião e Médico Associado
  (`profiles.role in ('NURSING_PROFESSIONAL', 'MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR')`). Gerente
  de Equipe e Suporte ficam de fora por serem papéis não assistenciais — decisão confirmada com o
  Emmanuel, mas revisável se o estudo quiser incluir o Gerente.
- **Sem fotos**: o lançamento pela equipe não inclui foto de cicatriz/dreno — o upload por token
  (`upload-patient-photo`) exige `secure_token`+CPF do paciente, indisponível para staff
  autenticado. Se isso for necessário, requer um novo caminho de upload autenticado (bucket
  liberado por `is_team_member()` ou nova Edge Function), não construído nesta fase.

## 6. Triagem de Enfermagem — decisões que exigem confirmação humana

Migrations `0063`–`0069` (ver `docs/FLUXO_ENFERMAGEM.md`). Foram implementadas
com os defaults abaixo, **todos revisáveis**. Os três primeiros itens são
decisão do Emmanuel; o quarto é bloqueio jurídico/ético.

### 6.1 🚩 Amarelo ainda notifica o médico por WhatsApp?

**Estado atual: NÃO MUDADO.** O `notify_team_of_alert` continua disparando para
amarelo exatamente como antes — a triagem foi construída **por cima** do fluxo
existente, sem removê-lo. A proposta do desenho era que o amarelo virasse
in-app só para o enfermeiro (médico recebe vermelho e escalados), o que
reduziria ruído mas **é mudança de comportamento clínico** e não foi aplicada
sem confirmação. Para aplicar, é preciso uma migration nova que condicione a
chamada a `notify_team_of_alert` ao `status = 'RED' or escalated_at is not null`.

### 6.2 Valores default dos parâmetros operacionais

Todos em `app_settings`, seção `nursing` — mudam sem deploy:

| Parâmetro | Default | Risco se estiver errado |
|---|---|---|
| `lockTtlMinutes` | 15 | Curto demais rouba o alerta de quem está atendendo; longo demais prende |
| `offerWindowMinutes` | 5 | Longo demais atrasa a fila |
| `wipLimit` | 5 | Alto demais sobrecarrega; baixo demais deixa alerta sem dono |
| `slaYellowMinutes` | 60 | — |
| `slaMaxHours` | 8 | **É a rede de segurança**: alto demais deixa amarelo envelhecer |
| `escalationFallbackMinutes` | 30 | — |
| `reviewSamplingPct` | 10 | Baixo demais não detecta falso-negativo |

### 6.3 Cobertura de plantão — haverá turno noturno?

Sem turno noturno, vale a **regra da madrugada**: o alerta espera na fila com o
relógio de SLA parado e é entregue na abertura do próximo turno; o SLA máximo
(8h, tempo corrido) continua correndo e escala sozinho para o médico. Se houver
turno noturno, os defaults de SLA provavelmente precisam ser revistos.

### 6.4 🚩 GATE JURÍDICO — Responsável Técnico com COREN

**Nenhum enfermeiro deve contatar um paciente real antes desta definição.**
Quem é o Responsável Técnico com COREN que assina o protocolo de teleconsulta
de enfermagem, e ele é funcionário da startup ou do hospital? Não é bloqueio
técnico (o código está pronto), mas é pré-requisito operacional.

### 6.5 🚩 LGPD — DPA com o hospital

O pool amplia o acesso do enfermeiro para além da equipe. Dado de saúde ⇒ art.
11 da LGPD; o tratamento por operador (VitalSync) para controlador (hospital)
exige **contrato de operador/DPA** com cada hospital coberto pelo pool. A
trilha técnica (`patient_access_logs`) já existe; o contrato, não.

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
