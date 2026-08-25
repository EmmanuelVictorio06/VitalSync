# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

VitalSync (também chamado **CuraPath**) — monitoramento domiciliar pós-operatório: pacientes registram sinais vitais 2×/dia via link de WhatsApp durante os 10 dias pós-alta; a equipe médica acompanha gráficos, recebe alertas e exporta dados. Código, comentários e UI em **português**.

## Duas arquiteturas coexistem — entenda qual está viva

Este monorepo contém **dois backends**. É a fonte nº 1 de confusão:

- **Supabase (produção/atual)** — o que o frontend realmente usa. Postgres + RLS + Edge Functions (Deno), Auth do Supabase, Storage. Deploy do front na **Vercel**. Todo trabalho novo de dados/segurança acontece aqui: `supabase/migrations/` e `supabase/functions/`.
- **Fastify + Prisma (`backend/`, legado)** — arquitetura Clean (`domain/`/`application/`/`infrastructure/` dentro de `backend/src/`). Ainda é **compilada pela CI** (`.github/workflows/ci.yml` roda `npm run build`, que inclui o backend) e por isso não pode quebrar o build, mas o frontend **não** o consome em produção. Só `frontend/src/components/photo.tsx` e `frontend/src/lib/dashboard-data.ts` ainda importam `lib/api.ts` (o cliente HTTP que fala com `VITE_API_URL`/localhost:3333). Trate `backend/`, `lib/api.ts`, `lib/admin-api.ts` e `lib/teams-api.ts` (repositórios **MOCK** em memória) como legado — não invista neles a menos que seja pedido explicitamente.

Ao mexer em regras de negócio de dados, **a mudança quase sempre é em `supabase/` (SQL/RLS/Edge Function) + no service do frontend**, não em `backend/`.

## Como o frontend fala com o backend (Supabase)

Camada de serviços em `frontend/src/services/*Service.ts`. Dois padrões:

- **Leitura/escrita direta com RLS**: `supabase.from('tabela').select/insert/...`. A autorização por perfil/equipe é imposta pelas **políticas RLS no banco**, não pelo TS. Ex.: `teamService.list()` retorna só as equipes visíveis ao usuário porque a RLS filtra.
- **Operações sensíveis via Edge Functions**: `supabase.functions.invoke('nome')`. Usado quando há segredo (CPF hash/cifra, token WhatsApp), validação de token do paciente, ou lógica que a `anon`/`authenticated` key não pode fazer sozinha. Funções em `supabase/functions/` (lista completa mais abaixo, em "Comandos"). Utilitários compartilhados em `supabase/functions/_shared/` (`cors.ts`, `cpf.ts`, `patientAccess.ts`).

`edgeError.ts` padroniza erros das Edge Functions no front.

## Regras e mapeamentos de fonte única (não duplicar)

- **Regras clínicas** → `packages/shared/src/clinical/thresholds.ts` (faixas de validação de entrada + limiares verde/amarelo/vermelho) e `status.ts`. Ponto de manutenção **único** para: validação de entrada, gráficos e as regras **não** table-driven (`STEPS_RULES`, `BINARY_RULES`, `WATER_INTAKE_RULE`, critérios combinados de vermelho). Campos com `PENDING_MEDICAL_VALIDATION = true` são provisórios (ver `docs/PONTOS_PENDENTES.md`). Não invente limiares finais.
- **Faixas verde/amarelo/vermelho das 8 métricas simples** (temperature, spo2, bloodPressureSystolic, bloodPressureDiastolic, heartRate, diuresis, pain, dyspnea) → tabela `clinical_threshold_settings` (0075), **editável pelo ADMIN sem deploy** em Configurações → Regras Clínicas. Quem classifica é o banco: `eval_clinical_status` → `classify_by_bands` lê a tabela (fallback em `clinical_threshold_defaults`). `ALERT_THRESHOLDS` no TS é o **default de seed + fallback da tela**, não a fonte viva — mudar um número lá **não** muda o status em banco já semeado. Escrita só via RPC `admin_set_clinical_threshold` (is_admin + validação de cobertura sem buraco + `audit_logs`); nunca `update` direto. Por depender da tabela, `eval_clinical_status` é `stable` (não mais `immutable`).
- **Papéis** → `frontend/src/lib/roles.ts`. O banco usa `profiles.role` (`ADMIN`/`MEDICAL_SURGEON`/`ASSOCIATED_DOCTOR`/`SUPPORT`/`TEAM_MANAGER`/`NURSING_PROFESSIONAL`); o app usa o enum `Role` de `@vitalsync/shared` (`ADM`/`SURGEON`/`ASSOCIATE`/`SUPPORT`/`MANAGER`/`NURSE`). Converta com `dbRoleToAppRole`; rótulos PT-BR em `APP_ROLE_LABEL_PT`. Não recriar esse de-para (era duplicado em `AuthContext`, `MyProfilePage`, `profile` e `exportService` antes de ser centralizado). `DB_ROLE_TO_APP_ROLE` e `APP_ROLE_LABEL_PT` são `Record<...>` completos: adicionar um papel novo ao enum quebra o build até o de-para ser atualizado — isso é proposital.
- **Parâmetros operacionais** → tabela `app_settings` (`section` text PK + `data` jsonb; seções em uso: `security`, `nursing`), lida no SQL por `nursing_setting_num/bool` (0063). Janelas, limites e feature flags vivem aqui para mudarem **sem deploy** — não hardcode valores desses no TS nem no SQL.
- **Pacote `@vitalsync/shared`** (`packages/shared`) é neutro de framework (tipos, utils, clínico) e é dependência dos três workspaces — **precisa ser compilado antes** de backend/frontend. Todos os scripts `dev`/`build` já fazem `build:shared` primeiro.
- **Dropdowns** → `CustomSelect` (`frontend/src/components/ui.tsx`) é o padrão do app: listbox estilizado (não `<select>` nativo, que no mobile abre o menu cinza do SO). `ProfessionalCombobox` é a variante para listas de profissionais (tem busca; espera `{ id, name, tag, email?, roleLabel? }`). `SelectField` (`<select>` nativo) está **obsoleto** — só existe por compatibilidade, não usar em código novo.

## Ciclo de vida de um alerta clínico (espalhado por várias migrations)

`clinical_alerts` acumulou **camadas ortogonais** que é fácil confundir. Cada uma responde a uma pergunta diferente:

| Camada | Colunas | Pergunta | Onde |
|---|---|---|---|
| Severidade clínica | `status` (GREEN/YELLOW/RED) | O que a regra clínica calculou? | `eval_clinical_status` (SQL) + `thresholds.ts` (TS) |
| Atendimento | `attendance_status` (PENDING/IN_ANALYSIS/ATTENDED/IGNORED) | Em que ponto do fluxo está? | 0008 |
| Lock | `in_analysis_by/at` | Quem está atendendo **agora** (exclusividade)? | 0044/0045, TTL na 0063 |
| Atribuição | `assigned_nurse_id`, `offer_expires_at` | De quem é a **preferência** de triar? | 0065/0068 |
| Escalonamento | `escalated_at/by`, `escalation_reason` | A equipe julgou que precisa de médico? | 0064 |

Invariantes que **não** podem ser quebradas:

- **`status` nunca é sobrescrito por decisão humana.** Escalar grava numa camada separada justamente por isso — `status` alimenta as métricas do estudo (0055) e distingue "o algoritmo achou vermelho" de "a enfermeira achou que precisa de médico". Quem precisa tratar como vermelho lê `escalated_at is not null`.
- **Lock ≠ atribuição.** Atribuição é preferência (o alerta continua visível a todo o pool); lock é exclusividade. O claim atômico (`update ... where in_analysis_by is null`) é quem decide corrida entre profissionais — não reimplemente com `select` + `update`.
- **Só o dono do lock finaliza** (Admin é a exceção administrativa). Para assumir de outro, libere primeiro.

Toda mudança de estado passa por RPC `security definer` (`alert_set_in_analysis`, `alert_mark_attended`, `alert_ignore`, `alert_release_analysis`, `alert_escalate_to_red`, `alert_register_contact`) — o frontend **nunca** faz `update` direto em `clinical_alerts`. Cada uma grava a timeline em `attendance_confirmations` (campo `status` é texto livre: `ATTENDED`, `IGNORED`, `RELEASED`, `OFFERED`, `DECLINED`, `OFFER_EXPIRED`, `CONTACT`, `ESCALATED`, `ESCALATION_UNANSWERED`; `attended_by` nulo = evento gerado pelo sistema) e audita em `audit_logs`.

Fluxo completo da triagem de enfermagem (pool, plantão, oferta, SLA) em **`docs/FLUXO_ENFERMAGEM.md`** — inclui a nota de que esse desenho substitui a premissa de escopo por equipe da `0054`.

### Escopo de acesso: quatro funções combinadas, não uma

As políticas de RLS e as guardas internas das RPCs combinam `is_admin()`, `is_team_member(team_id)`, `is_team_manager_of(team_id)` e `is_nurse_for_patient(patient_id)`. Ao estender uma política, **acrescente** um `or` — nunca reescreva removendo condições (o histórico de 0016/0030/0039/0066 é uma cadeia de extensões aditivas, e cada uma lista no cabeçalho as políticas que tocou). Lembre que RPCs `security definer` **ignoram RLS** e repetem a checagem no corpo: mudar só a política deixa o usuário vendo o registro e sem conseguir agir sobre ele.

## Rotas e autorização no frontend

`frontend/src/App.tsx` define as rotas. Guarda de acesso via `<PermissionGuard roles={[...]}>`, com listas de `Role` diferentes por rota (ex.: `/patients/new` e `/manager-teams` são `ADM`/`MANAGER`; `/admin/users` e `/teams` são só `ADM`; `/my-team` é só `SURGEON`). Rotas **públicas sem login** (ficam fora do `Layout`/guard):

- `/registro-sinais/:token` e o alias `/r/:token` — tela do paciente (token no link do WhatsApp).
- `/convite/:token` — auto-cadastro de profissional convidado.

## Comandos

Rodar todos a partir da **raiz** (npm workspaces). Node ≥20 (`.node-version` local é 22; a CI usa 22).

```bash
npm install                 # instala tudo
npm run build:shared        # compila @vitalsync/shared (pré-requisito de tudo)
npm run dev                 # shared + backend(Fastify) + frontend juntos (legado + front)
npm run dev:frontend        # só o frontend (Vite) — normalmente o que você quer p/ Supabase
npm run build               # build de produção de shared + backend + frontend (o que a CI roda)
npm run build:frontend      # só o front (é o buildCommand da Vercel)
```

Frontend (rodar dentro de `frontend/` ou via `npm ... --workspace @vitalsync/frontend`):

```bash
npm run typecheck --workspace @vitalsync/frontend   # tsc sem emitir
npm run test --workspace @vitalsync/frontend        # vitest run
npm run test --workspace @vitalsync/shared          # vitest run do pacote shared
npm run test:watch --workspace @vitalsync/frontend
```

Rodar um único teste: `npx vitest run src/lib/arquivo.test.ts --root frontend` a partir da raiz (ou `npx vitest run caminho.test.ts` dentro de `frontend/`), e `-t "nome do teste"` para filtrar.

Os testes cobrem **lógica pura**, não componentes — não há testing-library nem testes de render no projeto. O padrão ao criar uma regra derivável é extraí-la para um módulo em `lib/` (ou `packages/shared`) e testar ali: `packages/shared/src/{utils,clinical/status,clinical/measurementWindows}.test.ts` e `frontend/src/lib/{roles,teamLimits,staffEntry,nurseDashboard,nurseTriage}.test.ts` + `frontend/src/components/attendances/utils.test.ts`.

**Não existe script `lint`** em nenhum workspace — não procure nem tente rodar lint; só `typecheck` + `test`. A CI (`.github/workflows/ci.yml`) roda `npm run build` (shared+backend+frontend) e depois `test` do shared e do frontend; o backend legado não tem testes automatizados, mas quebrar seu build derruba a CI mesmo assim.

Banco/Prisma (**apenas backend legado**; o banco real é o Supabase):

```bash
npm run db:up / db:down     # Postgres via docker-compose (porta host 5544, não 5432)
npm run db:migrate / db:seed / db:reset
```

Supabase (banco de produção): migrations aplicadas com `supabase db push`; Edge Functions com `supabase functions deploy <nome>`. Segredos via `supabase secrets set ...` (CPF_PEPPER, CPF_ENC_KEY, WHATSAPP_*). Reset local completo em `supabase/_scripts/0000_reset.sql`. Funções atuais em `supabase/functions/`: `create-patient`, `update-patient`, `submit-vital-record`, `process-vital-record`, `send-whatsapp-alert`, `send-measurement-reminder`, `send-missed-measurement-alert`, `send-welcome-message`, `whatsapp-webhook`, `validate-patient-access`, `admin-create-user`, `accept-invite`, `export-data`, `upload-patient-photo`.

## Gotchas de migrations Supabase (histórico real de quebras)

- Numeração sequencial `NNNN_descricao.sql` em `supabase/migrations/` — **confira o maior número com `ls` antes de criar** (esta linha envelhece). **Não** repita um número já usado: duplicatas de `0010` e `0041` já quebraram `db push`.
- Migrations são **aditivas e idempotentes**; nunca edite uma já aplicada. Para mudar uma função, `create or replace` numa migration nova — e **parta da versão viva**, que raramente é a que criou a função (ex.: `submit_vital_record` nasceu na 0008 mas a viva está na 0053; `alert_mark_attended` nasceu na 0044 e foi reescrita na 0045 e na 0067). `grep -ln "nome_da_funcao" supabase/migrations/*.sql | tail -1` acha a mais recente.
- **`CPF_PEPPER` é imutável**: se trocar depois, todos os hashes de CPF existentes deixam de bater.
- Coloque `ALTER TYPE ... ADD VALUE` (enum existente) em uma **migration isolada** — não pode rodar na mesma transação que usa o valor novo. `CREATE TYPE` de enum novo não tem essa restrição.
- Funções nascem com `EXECUTE` para `PUBLIC`: revogue de `public` **e** de `anon` antes de conceder a quem deve (a 0022 documenta o caso em que revogar só de `anon` não teve efeito).
- **`pg_cron` é carga funcional, não enfeite** — expiração de lock, fila de triagem, SLA, lembretes e alertas de medição esquecida dependem dele. Envolva `create extension` num bloco que trate **os dois** modos de falha — `exception when insufficient_privilege` (em alguns projetos só o Dashboard habilita) **e `when raise_exception`** (fora do banco de `cron.database_name`, normalmente `postgres`, o pg_cron recusa com um RAISE próprio, SQLSTATE `P0001`, que escapa do primeiro) — e torne o `cron.schedule` idempotente (unschedule antes de recriar). Modelo pronto no bloco de agendamento da 0038. Sem pg_cron o app funciona, mas as redes de segurança silenciam. **O nome do job não é o nome da função** (`nurse-queue-sweep` executa `reoffer_expired_alerts()`); o de-para está em `docs/FLUXO_ENFERMAGEM.md`.
- Os blocos `-- VERIFICAÇÃO` no rodapé das migrations recentes trazem o SQL para conferir o efeito depois do `db push`; siga o padrão.

## Ambiente

Há **dois `.env.example` distintos, não confunda**: o da **raiz** é do backend legado (Prisma/JWT/WhatsApp em log); o de `frontend/.env.example` é o que importa para o Supabase. Frontend (Vite) precisa de `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_PUBLIC_APP_URL` (passo a passo em `docs/CONFIG_SUPABASE.md`). Nunca colocar a `service_role` no frontend — só a `anon`. `lib/supabase.ts` valida se a URL/chave são reais (rejeita placeholders) e expõe `isSupabaseConfigured` para a UI mostrar erro claro em vez de tela branca. CORS do Supabase/Edge está restrito a `localhost:5173` em dev.

## Documentação de apoio

`README.md` está vazio — não conte com ele. `docs/`:

- `CONFIG_SUPABASE.md` — setup do ambiente.
- `ACESSO_PUBLICO_PACIENTE.md` — fluxo do link do paciente.
- `CONFIG_WHATSAPP_CLOUD_API.md` — Meta Cloud API: templates aprovados, secrets, deploy das Edge Functions e das automações agendadas.
- `HOMOLOGACAO.md` — modo de teste com médicos; o gate de homologação (`homologation_settings` + status `SKIPPED_TEST_MODE`) vale para **toda** notificação nova.
- `FLUXO_ENFERMAGEM.md` — triagem de enfermagem ponta a ponta (pool, plantão, oferta, SLA, LGPD).
- `PONTOS_PENDENTES.md` — decisões clínicas e operacionais **aguardando confirmação humana**. Consulte antes de "corrigir" um limiar ou um default que pareça arbitrário: provavelmente já está registrado ali como pendência consciente.
- `SETUP_LOCAL.md` — subir o Supabase local do zero (`db reset` já semeia migrations + usuários de Auth + papéis + dados de demo).
- `RUNBOOK_PILOTO.md` — runbook operacional do piloto; inclui o preflight (`supabase/_scripts/preflight_primeiro_paciente.sql`) a rodar **antes** de cadastrar o primeiro paciente real (checagem nº 1 é o modo homologação ligado).
- `BACKUP.md` — backup do banco: workflow `.github/workflows/backup.yml` (diário 03:10 America/Sao_Paulo + manual).
- `AVISO_CONTATO_ATIVO.md` — por que o contato de enfermagem ao paciente segue um roteiro específico (evitar parecer golpe).

`AUDITORIA_VitalSync_*.md`, `PROMPT_*.md` e `council-*` na raiz são notas de trabalho/auditoria, não especificação viva.
