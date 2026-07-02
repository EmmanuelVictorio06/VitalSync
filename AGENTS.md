# AGENTS.md

Orientação compacta para agentes trabalhando neste repo. Para o contexto completo
(arquitetura, fluxo do link do paciente, mapeamento de papéis), leia **`CLAUDE.md`**
e `docs/`. Código, comentários e UI em **português** — mantenha o idioma.

## Arquitetura: duas coexistem, só uma está viva

- **Supabase (produção/atual)** — Postgres + RLS + Edge Functions (Deno) + Auth +
  Storage. Frontend (Vercel) fala direto com o Supabase. Todo trabalho novo de
  dados/segurança acontece em `supabase/migrations/` e `supabase/functions/`.
- **`backend/` (Fastify + Prisma, legado)** — descrito no `README.md`, mas o
  frontend **não** o consome em produção. Ainda é compilado pela CI
  (`.github/workflows/ci.yml` roda `npm run build`), então **não pode quebrar o
  build**. Não invista aqui a menos que seja pedido explicitamente. Trate
  `lib/api.ts`, `lib/admin-api.ts`, `lib/teams-api.ts` (MOCK em memória) como
  legado.

Regra prática: ao mexer em regra de negócio de dados, a mudança quase sempre é em
`supabase/` (SQL/RLS/Edge Function) **+** no service do frontend, não em `backend/`.

## Comandos (rodar a partir da raiz — npm workspaces)

```bash
npm install                 # instala tudo (o `prepare` do shared já compila o dist)
npm run dev:frontend        # só o front (Vite, porta 5173) — o que você quer p/ Supabase
npm run dev                 # shared + backend(legado) + frontend juntos
npm run build               # shared + backend + frontend (o que a CI roda)
npm run build:frontend      # só o front (buildCommand da Vercel)
npm run build:shared        # pré-requisito de tudo; os scripts dev/build já fazem isso
```

Verificação por workspace:

```bash
npm run typecheck --workspace @vitalsync/frontend   # tsc -p tsconfig.json (sem emitir)
npm run test --workspace @vitalsync/frontend        # vitest run
npm run test --workspace @vitalsync/shared
```

Teste único (dentro de `frontend/`): `npx vitest run caminho/do/arquivo.test.ts`
ou `-t "nome do teste"`.

**Não existe script `lint`.** Não procure nem tente rodar lint — só `typecheck`
+ `test`. (Backend legado também não tem lint.)

## Testes

- Vitest v4, sem config customizada. Testes colocalizados como `*.test.ts` ao
  lado da fonte. Suítes pequenas: shared (`packages/shared/src/utils.test.ts`,
  `clinical/status.test.ts`) e frontend (`lib/roles.test.ts`,
  `lib/teamLimits.test.ts`, `components/attendances/utils.test.ts`).
- CI: `npm run build` (shared+backend+frontend) **depois** `test` do shared e do
  frontend. Backend quebra o build → CI vermelho, mesmo sendo legado.
- Sem testes de integração com serviços externos; Supabase/WhatsApp não são
  exercitados pela CI.

## Node

`.node-version` = 22; `engines` = `>=20`; CI usa Node 20. Use Node 20+.

## Frontend ↔ Supabase

- Serviços em `frontend/src/services/*Service.ts`. Dois padrões:
  - **RLS direta**: `supabase.from('tabela').select/insert/...` — a autorização
    por perfil/equipe é imposta pelas **políticas RLS no banco**, não pelo TS.
  - **Edge Functions**: `supabase.functions.invoke('nome')` para segredos
    (CPF hash/cifra, token WhatsApp), validação de token do paciente e lógica
    que a `anon`/`authenticated` não pode fazer sozinha.
- Edge Functions em `supabase/functions/`: `create-patient`, `update-patient`,
  `submit-vital-record`, `process-vital-record`, `send-whatsapp-alert`,
  `whatsapp-webhook`, `validate-patient-access`, `admin-create-user`,
  `accept-invite`, `export-data`. Compartilhado em `_shared/`
  (`cors.ts`, `cpf.ts`, `patientAccess.ts`).
- `frontend/src/lib/edgeError.ts` padroniza erros das Edge Functions.
- `frontend/src/lib/supabase.ts` valida URL/chave reais e expõe
  `isSupabaseConfigured` (UI mostra erro claro em vez de tela branca).
- Alias `@` → `frontend/src` (em `vite.config.ts`), mas a maioria dos imports é
  relativa.

## Rotas públicas (sem login, fora do `Layout`/`PermissionGuard`)

`/registro-sinais/:token` e alias `/r/:token` (tela do paciente, token no link
de WhatsApp); `/convite/:token` (auto-cadastro de profissional). Definidas em
`frontend/src/App.tsx`.

## Fontes únicas (não duplicar)

- **Regras clínicas** → `packages/shared/src/clinical/thresholds.ts` (faixas de
  validação + limiares verde/amarelo/vermelho) e `status.ts`. Backend, frontend
  e gráficos leem daqui. Campos com `PENDING_MEDICAL_VALIDATION = true` são
  provisórios (PA e FC) — ver `docs/PONTOS_PENDENTES.md`. **Não inventa
  limiares finais.**
- **Papéis** → `frontend/src/lib/roles.ts`. Banco usa `profiles.role`
  (`ADMIN`/`MAIN_SURGEON`/`ASSOCIATED_DOCTOR`/`SUPPORT`); app usa enum `Role`
  de `@vitalsync/shared` (`ADM`/`SURGEON`/`ASSOCIATE`/`SUPPORT`). Converta com
  `dbRoleToAppRole`; rótulos PT-BR em `APP_ROLE_LABEL_PT`.
- **`@vitalsync/shared`** (`packages/shared`) é neutro de framework e dependência
  dos três workspaces — precisa estar compilado antes de backend/frontend.

## Supabase (banco de produção)

```bash
supabase db push                       # aplica migrations
supabase functions deploy <nome>       # deploy de Edge Function
supabase secrets set CPF_PEPPER=... CPF_ENC_KEY=... WHATSAPP_API_TOKEN=...
```

Reset local completo: `supabase/_scripts/0000_reset.sql`.

### Gotchas de migration (histórico real de quebras)

- Numeração sequencial `NNNN_descricao.sql` em `supabase/migrations/`
  (atual até **`0033`**). **Não repita número já usado** — um `0010`
  duplicado já quebrou `db push`.
- **`CPF_PEPPER` é imutável**: trocar depois invalida todos os hashes de CPF.
- `ALTER TYPE ... ADD VALUE` (enum) vai em **migration isolada** — não pode
  rodar na mesma transação que o usa.

## Ambiente

- **Frontend (Vite)**: copie `frontend/.env.example` → `frontend/.env.local`.
  Precisa de `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_PUBLIC_APP_URL`. **Nunca** a `service_role` no frontend — só `anon`.
  Passo a passo em `docs/CONFIG_SUPABASE.md`.
- **O `.env.example` da raiz é do backend legado** (Prisma/JWT/WhatsApp em log)
  — não confunda com o do frontend.
- CORS do Supabase/Edge em dev restrito a `localhost:5173`.
- Docker do backend legado usa porta host **5544** (não 5432).

## Documentação de apoio

`docs/`: `CONFIG_SUPABASE.md` (setup), `ACESSO_PUBLICO_PACIENTE.md` (fluxo do
link do paciente), `HOMOLOGACAO.md`, `PONTOS_PENDENTES.md` (valores clínicos
aguardando validação). `README.md` descreve a arquitetura Clean do backend
legado (útil p/ conceitos, não p/ o fluxo atual). `AUDITORIA_VitalSync_*.md` e
`PROMPT_*.md` na raiz são notas de trabalho/auditoria.
