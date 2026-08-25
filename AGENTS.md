# AGENTS.md

A orientação completa para agentes está em **`CLAUDE.md`** (raiz). **Leia-o primeiro** — arquitetura (Supabase vs. backend legado), comandos, testes, gotchas de migration, ambiente e mapeamentos de fonte única vivem lá. O resumo abaixo evita apenas os tropeços que mais custam a corrigir.

## Tropeços que custam caro (leia antes de mexer)

- **Há dois backends.** `supabase/` (Postgres + RLS + Edge Functions em Deno) é o que o frontend de produção usa. `backend/` (Fastify + Prisma) é **legado** — o frontend não o consome em produção, **mas a CI roda `npm run build`, que inclui o backend**; quebrar o build do backend derruba a CI. Regra de dados/segurança quase sempre é em `supabase/` + service do front, **não** em `backend/`.
- **Não existe script `lint`.** Não rode `npm run lint` em workspace algum — só `typecheck` + `test`. A CI roda `build` + `test` (shared e frontend); o backend legado não tem testes.
- **`@vitalsync/shared` é pré-requisito.** `dev:frontend` e o `typecheck`/`test` do front **não** o recompilam — rode `npm run build:shared` depois de mexer em `packages/shared`. Já `npm run dev` e os `build:*` da raiz encadeiam o `build:shared`.
- **Migrations Supabase são aditivas e idempotentes.** Nunca edite uma já aplicada. Antes de criar, confira o maior número em `supabase/migrations/` (`ls`) — duplicatas de `0010`/`0041` já quebraram o `db push`. A função viva raramente é a que a criou: `grep -ln "nome" supabase/migrations/*.sql | tail -1` acha a mais recente.
- **Dois `.env.example`, não confunda.** O da **raiz** é do backend legado (Prisma/JWT); o de `frontend/.env.example` é o que importa para o Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`). No front vai só a key `anon` — **nunca** a `service_role`.
- **`README.md` está vazio.** Não confie em referências a ele descrevendo arquitetura — esse conteúdo não existe mais. Fonte autoritativa: `CLAUDE.md` + o próprio código.
- **Testes são só de lógica pura.** Não há testing-library nem testes de render — extraia regra derivável para `lib/` (ou `packages/shared`) e teste ali. Não tente adicionar testes de componente/render.

## Comandos rápidos (a partir da raiz, Node 22)

- `npm run dev:frontend` — só o front (Vite, porta 5173); modo normal p/ Supabase.
- `npm run build` — reproduz o build da CI (shared + backend + frontend). **Em checkout fresco / após `npm ci`, rode `npm run db:generate` antes**: a CI gera o client Prisma num passo à parte e o `build` da raiz **não** encadeia isso (só o `build:backend` encadeia). O `DATABASE_URL` da CI é fictício — o build (tsc + vite) não conecta ao banco.
- Verificação por workspace (a raiz **não** tem scripts `test`/`typecheck`): `npm run typecheck --workspace @vitalsync/frontend` e `npm run test --workspace @vitalsync/frontend` (ou `@vitalsync/shared`).
- Teste único: `npx vitest run src/lib/arquivo.test.ts --root frontend` (ou `-t "nome"`).

O resto (Supabase `db push`/`functions deploy`, Prisma do backend legado, envs, ciclo de vida do alerta clínico, rotas/autorização, tabelas de fonte única) está em `CLAUDE.md`.
