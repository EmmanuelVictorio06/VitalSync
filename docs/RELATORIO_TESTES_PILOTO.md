# Relatório de Testes — Gate do Primeiro Paciente Real

**Data da execução:** 2026-08-09 · **Ambiente:** Supabase local (Docker), migrations `0001`–`0075`, seed autossuficiente
**Executor:** agente (Claude Code) · **Método:** impersonação real de RLS (`set local role` + `request.jwt.claims`); nada testado como superusuário conta como teste de RLS

> **VEREDITO: 🔴 NO-GO** — zero bloqueantes técnicos abertos, mas **5 dos 9 critérios de liberação dependem de execução humana** e seguem pendentes (detalhe na última seção). Três achados GRAVES foram encontrados **e corrigidos** (migrations `0074`/`0075`); um GRAVE segue aberto (webhook).

---

## Como reproduzir

```bash
supabase db reset                                       # migrations + seed, sem passo manual
docker exec -i supabase_db_VitalSync psql -U postgres -d postgres -q -tA \
  -f - < supabase/_scripts/testes/00_fixture_testes.sql # massa de escopo (2ª equipe, 2º pool, INACTIVE)
# idem para 01_matriz_leitura.sql, 02_matriz_escrita_guardas.sql, 03_ciclo_alerta_triagem.sql
# aprovado = grep -c FAIL == 0
npm run build:shared && node supabase/_scripts/testes/paridade_clinica.mjs
```

## Resultados executados

`Evidência` = saída literal dos scripts/comandos desta sessão (reproduzível pelos comandos acima).

| ID | Seção | Cenário | Esperado | Obtido | Status |
|---|---|---|---|---|---|
| S1-GOLDEN | 1.1 | 57 casos de borda do dataset clínico (temp/SpO2/PA/FC/dor/dispneia/diurese/binários/passos/combinados 0051) vs. motor TS | 57 iguais ao esperado | 57/57 · `Tests 150 passed` no shared | PASSOU |
| S1-PARID | 1.2 | Mesmos 57 casos vs. `eval_clinical_status` (SQL) — três vias (esperado×TS×SQL) | 0 divergências | `Casos: 57 · Divergências: 0` | PASSOU |
| S1-SUITES | 1.3 | Suítes vitest completas, sem `.skip`/`.only` | verdes | 109 frontend + 150 shared; nenhum skip | PASSOU |
| L01–L07 | 2.1 | Escopo por equipe (cirurgião/associado/cirurgião2 com 2 equipes reais) | só a própria equipe | 7/7 PASS | PASSOU |
| L08 | 2.1 | E-mail de perfis fora do escopo não vaza | invisível | PASS — colegas da MESMA equipe são visíveis **por desenho** (`shares_team_with`; a tela Integrantes exibe contato); fora do escopo: nada | PASSOU* |
| L09–L12 | 2.1 | `client_error_logs`/`app_settings`/`homologation_settings`/trilha LGPD só admin | 0 linhas p/ associado | 4/4 PASS | PASSOU |
| L13–L17 | 2.1 | Gerente vê equipes vinculadas; SUPORTE vê pacientes mas **não** alertas nem medições | conforme | 5/5 PASS | PASSOU |
| L18–L23 | 2.1 | Pool: enfermeira geral vê tudo coberto (mesmo sem ser da equipe); pool restrito **não** vê hospital de fora (2º pool criado p/ o teste, como o plano exige) | conforme | 6/6 PASS | PASSOU |
| L24–L25 | 2.1 | Usuário INACTIVE não acessa nada | 0 linhas | **FALHOU na 1ª execução** (achado A1) → corrigido pela `0074` → PASS no re-run | PASSOU (pós-fix) |
| L26–L32 | 2.1 | Admin vê tudo/lê logs; `anon` não lê nenhuma tabela clínica nem profiles | conforme | 7/7 PASS | PASSOU |
| E01 | 2.2 | UPDATE direto em `clinical_alerts` por authenticated | 0 linhas (RLS) | PASS | PASSOU |
| E02 | 2.2 | Escalonamento do próprio role/status (regressão 0073) | revertido | PASS | PASSOU |
| E03–E05 | 2.2 | `profiles_public` e tabelas clínicas fechadas p/ escrita de cliente/anon | 42501 | 3/3 PASS | PASSOU |
| G01–G07 | 2.3 | Guardas internas: MANAGER_READ_ONLY, suporte, equipe alheia, homologação só admin | exceção amigável | 7/7 PASS | PASSOU |
| G08–G09 | 2.3 | Varredura de EXECUTE por anon nas RPCs | zero | **FALHOU na 1ª execução: 35 RPCs executáveis por anon; 4 sem guarda interna nenhuma; regressão da 0022 em `submit_vital_record`** (achado A2) → corrigido pela `0075` → zero no re-run | PASSOU (pós-fix) |
| C01–C04 | 4 | Claim atômico + idempotência do dono + só-dono-finaliza + release + TTL do lock (20 min) | conforme 0044/0045/0063 | 4/4 PASS | PASSOU |
| C05–C06 | 4 | Escalonamento: `status` segue **YELLOW** no banco (métricas 0055 intactas); idempotente | conforme | PASS (verificação SQL direta) | PASSOU |
| C07–C10 | 4/5 | Vermelho: não escalável; enfermeira não finaliza (msg clara) mas registra contato; médico finaliza normal | conforme | 4/4 PASS | PASSOU |
| C11–C12 | 4/3 | Nova medição fecha reaferição 2h; repetição do período recusada (0047) | conforme | 2/2 PASS | PASSOU |
| C13–C16 | 5 | Oferta automática (flag on) → única enfermeira livre; oferta vigente respeitada; expiração registrada e reofertada (nunca some); fila aberta assumível por qualquer uma do pool | conforme | 4/4 PASS | PASSOU |
| C17–C19 | 5 | WIP=0 → sem oferta; SLA de fila marcado; SLA máximo → **escala sozinho** (autor = sistema, status segue YELLOW) | conforme | 3/3 PASS | PASSOU |
| C20–C21 | 5 | Sem pool e sem equipe → `NO_RECIPIENT` explícito; enqueue idempotente no dia | nunca silêncio | 2/2 PASS | PASSOU |
| CONC-1 | 4 | **Corrida real** (2 processos paralelos) no claim do mesmo alerta | 1 vence, 1 erro amigável, 1 evento | `vencedor: enfermagem@… · eventos IN_ANALYSIS: 1`; perdedor: "já está em análise por outro profissional" | PASSOU |
| S3-RATE | 3 | Proteção contra força bruta de CPF | existe | Existe por código: `_shared/patientAccess.ts` — 5 tentativas → bloqueio 15 min (`public_access_attempts`, 0013). **Não exercitada por HTTP** (Edge não servida localmente) | PASSOU (código) |
| S7-CRON | 5/7 | Jobs pg_cron esperados ativos | 10 | 10/10 ativos (lista na saída) | PASSOU |
| S10-BKP | 10 | Dump + restore em banco descartável + dado íntegro | sobe com 5 pacientes | `restaurado: pacientes=5` | PASSOU (mecânica local) |
| S11-BND | 11 | `service_role` no bundle (`frontend/dist`) | ausente | ausente | PASSOU |
| S11-ENV | 11 | Segredos preenchidos em `.env.example`/commitados | nenhum | nenhum (só `=""` e comentários) | PASSOU |
| S6-WBH | 6/11 | Webhook da Meta valida assinatura do POST | valida | **NÃO valida** `X-Hub-Signature-256` (só o verify_token do GET de subscribe). Endpoint público aceita POST forjado que altera status de entrega em `notification_logs` — pode mascarar falha de envio | **FALHOU — ABERTO (A3)** |

\* L08: asserção original era mais estrita que o desenho real; refinada para o invariante correto (nada fora do escopo de equipe). Não é defeito.

## Achados e destino

| # | Achado | Severidade | Destino |
|---|---|---|---|
| A1 | INACTIVE com vínculo ativo mantinha acesso a pacientes/alertas/medições — desativar usuário não revogava dado clínico | GRAVE | **Corrigido** — `0074_inativo_sem_acesso.sql` (gate `is_active_profile()` em `is_admin`/`is_team_member`/`is_main_surgeon_of`/`is_support`/`is_team_manager_of`); L24/L25 verdes no re-run |
| A2 | 35 RPCs executáveis por `anon` (default privileges do Supabase concedem grant DIRETO a anon — `revoke from public` não basta); 4 funções de manutenção sem guarda interna; **regressão da 0022**: `submit_vital_record` 21-args voltou a ser chamável por anon (bypass do gate CPF/rate-limit com token válido) | GRAVE | **Corrigido** — `0075_revogar_execucao_anon.sql`; G08=0 no re-run; regra nova documentada na migration |
| A3 | `whatsapp-webhook` não valida `X-Hub-Signature-256` no POST | GRAVE | **ABERTO** — exige o App Secret da Meta (decisão/credencial do Emmanuel). Não altera dado clínico; pode falsificar status de entrega |
| A4 | `is_nurse_on_duty()` trata `ends_at` futuro como turno encerrado (turno agendado nunca fica ativo) | MENOR | Registrado no seed (8c) e em PR anterior; corrigir no helper se o produto adotar escala |

## Não executado — e por quê (sem evidência = BLOQUEADO)

| Item | Motivo |
|---|---|
| Seção 3: fluxo do paciente por HTTP (token+CPF, fotos, clique duplo, conexão caindo) | Edge Functions não servidas neste ambiente (`supabase functions serve` + secrets CPF). O que era testável por SQL foi (C11/C12); rate-limit verificado por código |
| Seção 3: **celular real, 3G, uma mão, pessoa 60+ fora da equipe** | Exige humano e dispositivo — impossível por agente. **É critério de go/no-go** |
| Seção 3/4: bordas 23h/01h America/Sao_Paulo | `now()` do banco não é controlável sem extensão de clock; `measurementWindows` TS cobre as janelas 08/10/18/20 por parâmetro |
| Seção 6: matriz HTTP das 13 Edge Functions (6 casos cada) | Idem serve+secrets; guardas SQL subjacentes testadas |
| Seção 7: WhatsApp real ponta a ponta (template, variáveis, celular do médico) | Exige credenciais Meta + número real. **Critério de go/no-go** |
| Seção 8/9: CRUD administrativo completo e navegação das 20 rotas × 6 papéis na UI | Exige navegador/E2E; sem testing-library no projeto (decisão registrada) |
| Seção 11: Advisors do Supabase (Security/Performance) | Só existem no projeto hospedado — rodar em produção |
| Backup de PRODUÇÃO cifrado, restaurado | Workflow existe; mecânica local provada; o dump real nunca foi restaurado |

## Critérios de liberação (go/no-go)

| # | Critério | Estado |
|---|---|---|
| 1 | Zero bloqueantes abertos | ✅ (A3 é GRAVE, não bloqueante — não altera dado clínico) |
| 2 | Seção 2 100% executada, sem vazamento | ✅ 32+13 asserções verdes (pós `0074`/`0075`) |
| 3 | Paciente em celular real, 3G, pessoa idosa | ❌ **pendente — humano** |
| 4 | Caminho vermelho ponta a ponta com WhatsApp real | ❌ **pendente — credenciais/celular** |
| 5 | Homologação desligada + paciente real sem `is_test` | ❌ verificação de produção no dia (preflight cobre) |
| 6 | Backup gerado E restaurado | ⚠️ mecânica provada localmente; produção pendente |
| 7 | Runbook lido por todos | ❌ documento existe; leitura não comprovável |
| 8 | PAS 140×160 decidida pelo cirurgião | ❌ **aberta** (travada no golden como está) |
| 9 | typecheck + testes + build verdes | ✅ 109+150 testes, build ok |

**Próximo passo que destrava o gate:** itens 3, 4 e 8 — nenhum é de código.
