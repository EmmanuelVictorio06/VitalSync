# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

VitalSync (também chamado **CuraPath**) — monitoramento domiciliar pós-operatório: pacientes registram sinais vitais 2×/dia via link de WhatsApp durante os 10 dias pós-alta; a equipe médica acompanha gráficos, recebe alertas e exporta dados. Código, comentários e UI em **português**.

## Duas arquiteturas coexistem — entenda qual está viva

Este monorepo contém **dois backends**. É a fonte nº 1 de confusão:

- **Supabase (produção/atual)** — o que o frontend realmente usa. Postgres + RLS + Edge Functions (Deno), Auth do Supabase, Storage. Deploy do front na **Vercel**. Todo trabalho novo de dados/segurança acontece aqui: `supabase/migrations/` e `supabase/functions/`.
- **Fastify + Prisma (`backend/`, legado)** — a arquitetura Clean descrita no `README.md`. Ainda é **compilada pela CI** (`.github/workflows/ci.yml` roda `npm run build`, que inclui o backend) e por isso não pode quebrar o build, mas o frontend **não** o consome em produção. Só `frontend/src/components/photo.tsx` e `frontend/src/lib/dashboard-data.ts` ainda importam `lib/api.ts` (o cliente HTTP que fala com `VITE_API_URL`/localhost:3333). Trate `backend/`, `lib/api.ts`, `lib/admin-api.ts` e `lib/teams-api.ts` (repositórios **MOCK** em memória) como legado — não invista neles a menos que seja pedido explicitamente.

Ao mexer em regras de negócio de dados, **a mudança quase sempre é em `supabase/` (SQL/RLS/Edge Function) + no service do frontend**, não em `backend/`.

## Como o frontend fala com o backend (Supabase)

Camada de serviços em `frontend/src/services/*Service.ts`. Dois padrões:

- **Leitura/escrita direta com RLS**: `supabase.from('tabela').select/insert/...`. A autorização por perfil/equipe é imposta pelas **políticas RLS no banco**, não pelo TS. Ex.: `teamService.list()` retorna só as equipes visíveis ao usuário porque a RLS filtra.
- **Operações sensíveis via Edge Functions**: `supabase.functions.invoke('nome')`. Usado quando há segredo (CPF hash/cifra, token WhatsApp), validação de token do paciente, ou lógica que a `anon`/`authenticated` key não pode fazer sozinha. Funções em `supabase/functions/` (ex.: `create-patient`, `submit-vital-record`, `process-vital-record`, `send-whatsapp-alert`, `validate-patient-access`, `admin-create-user`, `accept-invite`, `export-data`). Utilitários compartilhados em `supabase/functions/_shared/` (`cors.ts`, `cpf.ts`, `patientAccess.ts`).

`edgeError.ts` padroniza erros das Edge Functions no front.

## Regras e mapeamentos de fonte única (não duplicar)

- **Regras clínicas** → `packages/shared/src/clinical/thresholds.ts` (faixas de validação de entrada + limiares verde/amarelo/vermelho) e `status.ts`. Ponto de manutenção **único**: backend, frontend e gráficos leem daqui. Campos com `PENDING_MEDICAL_VALIDATION = true` são provisórios (Pressão Arterial e FC aguardam confirmação médica — ver `docs/PONTOS_PENDENTES.md`). Não invente limiares finais.
- **Papéis** → `frontend/src/lib/roles.ts`. O banco usa `profiles.role` (`ADMIN`/`MAIN_SURGEON`/`ASSOCIATED_DOCTOR`/`SUPPORT`); o app usa o enum `Role` de `@vitalsync/shared` (`ADM`/`SURGEON`/`ASSOCIATE`/`SUPPORT`). Converta com `dbRoleToAppRole`; rótulos PT-BR em `APP_ROLE_LABEL_PT`. Não recriar esse de-para.
- **Pacote `@vitalsync/shared`** (`packages/shared`) é neutro de framework (tipos, utils, clínico) e é dependência dos três workspaces — **precisa ser compilado antes** de backend/frontend. Todos os scripts `dev`/`build` já fazem `build:shared` primeiro.

## Rotas e autorização no frontend

`frontend/src/App.tsx` define as rotas. Guarda de acesso via `<PermissionGuard roles={[...]}>`. Rotas **públicas sem login** (ficam fora do `Layout`/guard):
- `/registro-sinais/:token` e o alias `/r/:token` — tela do paciente (token no link do WhatsApp).
- `/convite/:token` — auto-cadastro de profissional convidado.

## Comandos

Rodar todos a partir da **raiz** (npm workspaces).

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
npm run test --workspace @vitalsync/frontend        # vitest run (poucos testes; ex.: components/attendances/utils.test.ts)
npm run test:watch --workspace @vitalsync/frontend
```
Rodar um único teste: `npx vitest run caminho/do/arquivo.test.ts` dentro de `frontend/`, ou `-t "nome do teste"`.

Banco/Prisma (**apenas backend legado**; o banco real é o Supabase):
```bash
npm run db:up / db:down     # Postgres via docker-compose (porta host 5544, não 5432)
npm run db:migrate / db:seed / db:reset
```

Supabase (banco de produção): migrations aplicadas com `supabase db push`; Edge Functions com `supabase functions deploy <nome>`. Segredos via `supabase secrets set ...` (CPF_PEPPER, CPF_ENC_KEY, WHATSAPP_*). Reset local completo em `supabase/_scripts/0000_reset.sql`.

## Gotchas de migrations Supabase (histórico real de quebras)

- Numeração sequencial `NNNN_descricao.sql` em `supabase/migrations/` (atual vai até `0028`). **Não** repita um número já usado — um `0010` duplicado já quebrou `db push`.
- **`CPF_PEPPER` é imutável**: se trocar depois, todos os hashes de CPF existentes deixam de bater.
- Coloque `ALTER TYPE ... ADD VALUE` (enum) em uma **migration isolada** — não pode rodar na mesma transação que o usa.

## Ambiente

Variáveis em `.env.example`. Frontend (Vite) precisa de `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_PUBLIC_APP_URL` (passo a passo em `docs/CONFIG_SUPABASE.md`). Nunca colocar a `service_role` no frontend — só a `anon`. `lib/supabase.ts` valida se a URL/chave são reais (rejeita placeholders) e expõe `isSupabaseConfigured` para a UI mostrar erro claro em vez de tela branca. CORS do Supabase/Edge está restrito a `localhost:5173` em dev.

## Documentação de apoio

`README.md` descreve a arquitetura Clean do backend legado (útil para conceitos, não para o fluxo atual). `docs/`: `CONFIG_SUPABASE.md` (setup), `ACESSO_PUBLICO_PACIENTE.md` (fluxo do link do paciente), `HOMOLOGACAO.md`, `PONTOS_PENDENTES.md` (valores clínicos aguardando validação). `AUDITORIA_VitalSync_*.md` e `PROMPT_*.md` na raiz são notas de trabalho/auditoria.
