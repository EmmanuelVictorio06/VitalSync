# Pontos pendentes de confirmação médica

O documento do projeto marca alguns valores clínicos como **"\*Letícia irá confirmar os valores"**.
Esses valores **não foram inventados**: estão como **constantes provisórias claramente sinalizadas**
no código, todas em um único arquivo, fáceis de revisar e alterar.

📁 Arquivo único: [`packages/shared/src/clinical/thresholds.ts`](../packages/shared/src/clinical/thresholds.ts)
🚩 Flag no código: `PENDING_MEDICAL_VALIDATION: true`

Para listar as pendências em tempo de execução: `GET /api/catalog/pending-validations`.

---

## 1. Faixas de validação de ENTRADA (tela do paciente)

O documento define faixas para Temperatura (34–43 °C) e Saturação (93–100%), mas deixa
**"\*\*\*\*\*\*\*"** (a confirmar) para os campos abaixo. Usamos faixas **amplas e seguras** apenas
para impedir entradas absurdas — **revisar antes do uso clínico real**.

| Campo | Faixa provisória | Status |
|-------|------------------|--------|
| Pressão **sistólica** | 50–260 mmHg | ⚠️ PENDENTE |
| Pressão **diastólica** | 30–160 mmHg | ⚠️ PENDENTE |
| **Frequência cardíaca** | 30–220 bpm | ⚠️ PENDENTE |

## 2. Limiares de ALERTA da Pressão Arterial (gráfico/semáforo)

O documento traz valores, mas com a ressalva *"Letícia irá confirmar"*. Estão implementados como
provisórios:

| Faixa | Regra atual (provisória) |
|-------|--------------------------|
| 🟢 Verde (Normal) | sistólica < 110,9 mmHg |
| 🟡 Amarelo (Atenção) | 110,9 < sistólica < 119,9 mmHg |
| 🔴 Vermelho (Alerta) | sistólica > 119,9 mmHg |

> Observação: com esses limiares, uma sistólica de 118 mmHg já cai em **Atenção (amarelo)**.
> Isso é intencional conforme o documento — mas é justamente o ponto a validar clinicamente.

---

## Valores JÁ confirmados no documento (implementados como definitivos)

| Sinal | Verde | Amarelo | Vermelho |
|-------|-------|---------|----------|
| Temperatura | < 37,8 °C | 37,8–38,4 °C | ≥ 38,5 °C |
| Saturação SpO₂ | > 94% | 92,1–94% | ≤ 92% |
| Frequência cardíaca | ≤ 110 bpm | 111–119 bpm | ≥ 120 bpm |
| Diurese | ≥ 4 micções/dia | 2–3 micções/dia | < 2 micções/dia |
| Vômitos | Não | — | Sim |
| Sangramento | Não | — | Sim |
| Dor (0–10) | 0–6 | 7–8 | 9–10 |
| Dispneia (0–10) | 0 | 1–5 | 6–10 |
| Passos | — | redução 25% vs. dia anterior | redução 50% vs. dia anterior |

---

## Como confirmar / alterar

1. Abra `packages/shared/src/clinical/thresholds.ts`.
2. Ajuste os valores em `INPUT_RANGES` (validação de entrada) e/ou `ALERT_THRESHOLDS`
   (limiares de alerta).
3. Mude `PENDING_MEDICAL_VALIDATION` para `false` quando o valor for confirmado.
4. Recompile o pacote: `npm run build:shared` (o backend e o frontend passam a usar os novos
   valores automaticamente — fonte única de verdade).
