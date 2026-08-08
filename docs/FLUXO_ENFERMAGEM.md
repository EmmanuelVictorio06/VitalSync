# Fluxo de Triagem de Enfermagem — VitalSync / CuraPath

Migrations `0063`–`0069` + frontend (`NurseTriage.tsx`, `NurseDashboard.tsx`,
`alerts.tsx`). Este documento descreve o desenho e **o que ele substitui**.

> ⚠️ **Este desenho substitui a premissa de escopo por equipe da `0054`.** Até
> aqui, o Profissional de Enfermagem só enxergava as equipes das quais era
> membro (`is_team_member()`, que não distingue `role_in_team`). Agora ele
> enxerga os pacientes dos **hospitais cobertos pelo seu pool**. A `0054`
> continua válida quanto ao enum do papel; o que mudou é a fronteira de acesso.

---

## 1. As três decisões estruturais

**1. Atribuição por OFERTA, não por exclusividade.** O alerta é oferecido a um
enfermeiro (dono preferencial, com contagem regressiva), mas **permanece
visível para todo o pool de plantão**, marcado "aguardando Fulano — 4:12". Se
ele não assumir dentro da janela, cai para a fila aberta. Direcionamento sem
perder a redundância do broadcast: um alerta nunca fica preso e invisível.

**2. "Livre" é calculado, não declarado.** Não existe toggle de
disponibilidade — um toggle mente quando a pessoa esquece ligado e some da
distribuição. `nurse_is_free()` = em plantão **E** não pausado **E**
`nurse_active_load() < wipLimit`.

**3. Severidade clínica é imutável.** `clinical_alerts.status` vem de
`eval_clinical_status` / `packages/shared/src/clinical/thresholds.ts` e alimenta
as métricas do estudo (`0055`). **Escalar não muda `status`** — grava em
`escalated_at`/`escalated_by`/`escalation_reason`. Isso preserva o dado de
pesquisa e a distinção entre "o algoritmo achou vermelho" e "a enfermeira achou
que precisa de médico". Quem precisa tratar como vermelho lê `escalated_at`.

---

## 2. O que cada migration faz

| Migration | Conteúdo |
|---|---|
| `0063` | **TTL do lock** (bug corrigido: `in_analysis_at` nunca expirava). `release_stale_alert_locks()` + cron 5min. Seção `nursing` em `app_settings`. Vale para **todos os papéis**. |
| `0064` | Escalonamento: colunas + `alert_escalate_to_red()` + fallback `ESCALATION_UNANSWERED` (Cirurgião Principal + Admin) + cron 5min. |
| `0065` | `nurse_pools` / `nurse_pool_hospitals` / `nurse_pool_members` / `nurse_shifts`; helpers `is_nurse_on_duty`, `nurse_active_load`, `nurse_is_free`, `is_nurse_for_patient`; RPCs de plantão; seed do pool geral. |
| `0066` | RLS aditiva (`or is_nurse_for_patient(...)`) em 7 políticas. |
| `0067` | Guardas das RPCs + restrição "só amarelos" + `alert_register_contact` + `patient_access_logs` (LGPD). |
| `0068` | Oferta/distribuição atrás da flag `autoRouting`; SLA de fila; **escalonamento automático por tempo**; amostragem de revisão. |
| `0069` | Medição esquecida roteada pelo pool, com cadeia de fallback e `NO_RECIPIENT`. |

### Ordem de aplicação
`0063` → `0069`, em sequência. A `0063` é pré-requisito de todas (cria a seção
`nursing` em `app_settings` e os leitores `nursing_setting_num/bool`).

---

## 3. Ciclo de vida de um alerta amarelo

```
gerado (YELLOW, PENDING)
   ├─ autoRouting ON  → offer_yellow_alert() → assigned_nurse_id + offer_expires_at
   │                     ├─ enfermeiro assume  → nurse_claim_alert() → IN_ANALYSIS (lock)
   │                     ├─ devolve            → nurse_decline_alert() → fila aberta
   │                     └─ janela expira      → reoffer_expired_alerts() → fila aberta
   └─ autoRouting OFF → fila aberta desde o início (modo manual)

em análise
   ├─ conclui  → alert_mark_attended()  (só amarelo; vermelho é bloqueado)
   ├─ ignora   → alert_ignore()
   ├─ escala   → alert_escalate_to_red() → sai da fila da enfermagem, vai p/ médicos
   └─ abandona → release_stale_alert_locks() devolve à fila em 15 min

rede de segurança
   ├─ SLA de fila (60 min, só em horário coberto) → marca sla_breached_at
   ├─ SLA máximo (8h de tempo corrido)            → escalona AUTOMATICAMENTE
   └─ amostragem (10% dos amarelos finalizados)   → review_pending p/ revisão médica
```

---

## 4. Parâmetros (`app_settings`, seção `nursing`)

| Chave | Default | O que governa |
|---|---|---|
| `lockTtlMinutes` | 15 | Quando um lock abandonado volta à fila |
| `offerWindowMinutes` | 5 | Janela de preferência da oferta |
| `wipLimit` | 5 | Máximo de alertas ativos por enfermeiro |
| `slaYellowMinutes` | 60 | Amarelo em fila aberta vira "atrasado" |
| `slaMaxHours` | 8 | Amarelo escala sozinho para o médico |
| `escalationFallbackMinutes` | 30 | Médico não assumiu o escalado |
| `reviewSamplingPct` | 10 | Fração sorteada para revisão médica |
| `autoRouting` | **false** | Feature flag da distribuição automática |

Ligar a distribuição automática:
```sql
update public.app_settings set data = data || '{"autoRouting": true}'::jsonb where section = 'nursing';
```

---

## 5. Regra da madrugada (§4.5)

- **Fora de plantão** (ninguém de turno no pool que cobre o hospital): o alerta
  fica na fila aberta e o relógio de SLA **não corre** — `sla_breached_at` só é
  marcado quando existe alguém de plantão. É entregue na abertura do próximo turno.
- **O SLA máximo (8h) conta tempo corrido**, inclusive madrugada. É a rede que
  garante que **nenhum amarelo morre em silêncio** — passou de 8h sem
  atendimento, escala sozinho para o médico (`auto_escalated = true`,
  `escalated_by = null`).

---

## 6. LGPD — base legal e pendências

Ampliar o escopo do enfermeiro **remove a RLS por equipe como controle técnico
de minimização de acesso**. As contrapartidas implementadas:

- **Pool como fronteira contratual**: o enfermeiro só alcança hospitais que o
  `nurse_pool_hospitals` cobre. Paciente sem `hospital_id` é *fail-closed*.
- **`patient_access_logs`**: trilha de quem leu qual paciente e em que contexto,
  alimentada pelas RPCs de triagem. Só Admin lê; ninguém edita nem apaga.

**Base legal**: dado de saúde ⇒ art. 11 da LGPD. O tratamento por um operador
(VitalSync) para um controlador (hospital) exige **DPA/contrato de operador**
com cada hospital cujos pacientes o pool cobrir.

🚩 **Decisão de negócio, não de código** — ver `docs/PONTOS_PENDENTES.md`.

---

## 7. Cenários de teste manual

| # | Cenário | Esperado |
|---|---|---|
| 1 | Dois enfermeiros livres, três amarelos | Distribuição balanceada; todos visíveis ao pool |
| 2 | Oferta expira sem aceite | Re-oferecida; o alerta **nunca some** |
| 3 | Ninguém de plantão | Fila aberta, sem `sla_breached_at`; entrega ao abrir turno |
| 4 | Amarelo além do SLA máximo | Escalonamento automático; `status` continua `YELLOW` |
| 5 | Dois enfermeiros assumem o mesmo alerta | Um vence; o outro recebe erro amigável (claim atômico) |
| 6 | Enfermeiro fecha o navegador com alerta travado | Liberado pelo TTL em 15 min |
| 7 | Escalonamento | Médico vê badge, justificativa e histórico; `status` continua `YELLOW` |
| 8 | Médico não responde ao escalonamento | Fallback avisa Cirurgião Principal + Admin |
| 9 | Enfermeiro tenta finalizar um vermelho | Bloqueado com mensagem clara |

Os blocos `VERIFICAÇÃO` no rodapé de cada migration trazem o SQL de cada um.
