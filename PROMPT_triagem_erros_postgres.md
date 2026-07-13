# Prompt — Triar e corrigir os erros do Postgres (Supabase) do VitalSync

Cole o bloco abaixo para a IA. Antes, junte o material de entrada: no painel do Supabase → **Logs → Postgres Logs**, copie 5–20 linhas com severidade **ERROR/FATAL** (pode remover dados sensíveis) e cole no lugar indicado. Se tiver acesso, inclua também os logs das **Edge Functions** e da **API (PostgREST)** do mesmo período.

---

## Tarefa
Você é engenheiro do projeto **VitalSync (CuraPath)**. O banco de produção está no **Supabase** e o Advisor/painel mostra vários erros no Postgres (taxa de sucesso ~92%). Preciso que você **triagem cada erro** separando o que é **comportamento esperado** (proteção funcionando) do que é **bug real**, e proponha correção **cirúrgica** para os bugs.

## Logs de entrada
```
[COLE AQUI as linhas de ERROR/FATAL dos Postgres Logs — e, se tiver, Edge Functions + API]
```

## Como classificar (dois grupos)
1. **Esperado — não corrigir, só confirmar e explicar o porquê.** Ex.: `permission denied for table/function`, `new row violates row-level security policy`, rejeições das RPCs por **CPF inválido / rate-limit** no fluxo anônimo do paciente, `JWT`/`role anon` sem acesso. Isso é a RLS/os gates **bloqueando acesso indevido** — o app protegendo dados. Para cada um, aponte **qual policy/RPC/migration** está barrando (ex.: `submit-vital-record` + `verifyPatientCpf`, `0024_restrict_alert_attendance_writes`, `0025_restrict_profiles_select`).
2. **Bug real — localizar e corrigir.** Ex.: `column ... does not exist`, `function ... does not exist`, `violates foreign key/unique constraint` inesperado, `statement timeout`, `deadlock`, erro 500 em Edge Function, migration que não bate com o schema. Para cada um: causa provável, **arquivo exato** (`supabase/migrations/NNNN_*.sql`, `supabase/functions/<nome>/index.ts`, `_shared/*`, ou `frontend/src/services/*Service.ts`) e a correção mínima.

## Regras de arquitetura a respeitar (não violar)
- Banco de produção é o **Supabase**. Corrigir em `supabase/migrations/` + `supabase/functions/` (+ service do frontend). **Não** tocar em `backend/` legado (Fastify/Prisma) — o frontend não o usa.
- **Escrita em alertas/atendimentos só via RPCs** `SECURITY DEFINER` (`alert_set_in_analysis`, `alert_mark_attended`, `alert_ignore`, `alert_update_observation`) — gate por `is_team_member`. Não reabrir UPDATE direto (ver `0024`).
- **Regras clínicas** só em `packages/shared/src/clinical/thresholds.ts` — **não inventar limiares**; campos `PENDING_MEDICAL_VALIDATION` continuam provisórios.
- **Migrations**: numeração sequencial `NNNN_descricao.sql` — a próxima livre é **`0038`** (não repetir número). `ALTER TYPE ... ADD VALUE` em migration **isolada**. Aditivo/idempotente. **`CPF_PEPPER` é imutável** — não sugerir trocá-lo.
- View `profiles_public` com `security_invoker = false` é **intencional** (safe-column-subset, migration `0032`). O alerta CRITICAL do Advisor sobre ela é **falso-positivo conhecido** — **não** "corrigir" isso.

## Formato da resposta
1. **Tabela de triagem**: | Erro (resumo) | Classificação (Esperado / Bug) | Causa | Arquivo/Policy | Ação |
2. Para cada **Bug**: o diff/patch mínimo proposto (SQL da migration `0038_...` ou trecho do arquivo), e como validar (query de repro, `npm run typecheck --workspace @vitalsync/frontend`, ou teste do fluxo).
3. **Resumo final**: quantos erros eram esperados (ignorar) vs quantos são bugs, e a ordem de correção sugerida.

## Antes de propor qualquer alteração
- Confirme a causa lendo o schema/policy real no repositório (não suponha). Se um erro for ambíguo, diga o que precisa ver (ex.: log completo, payload da request) em vez de chutar a correção.
