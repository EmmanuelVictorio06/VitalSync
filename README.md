# VitalSync — Monitoramento Domiciliar Pós-Operatório

Sistema web responsivo, seguro e escalável para acompanhamento de pacientes nos **10 dias
pós-alta hospitalar**. Pacientes registram sinais vitais 2×/dia (via link de WhatsApp) e a
equipe médica acompanha gráficos, recebe alertas automáticos e exporta os dados.

> Produto desenvolvido com **Clean Architecture**, componentes reutilizáveis, RBAC por equipe,
> e regras clínicas centralizadas. As 10 heurísticas de Nielsen e boas práticas mobile-first
> guiaram a interface.

---

## 1. Stack

| Camada     | Tecnologia |
|------------|------------|
| Frontend   | React 18 + Vite + TypeScript (mobile-first, Recharts) |
| Backend    | Node.js + Fastify + TypeScript (Clean Architecture) |
| ORM/DB     | Prisma + PostgreSQL 16 |
| Compartilhado | Pacote `@vitalsync/shared` (regras clínicas, tipos, utilidades) |
| Segurança  | bcrypt, JWT, Helmet, CORS, rate-limit, tokens SHA-256 para links |

Monorepo com **npm workspaces**:

```
VitalSync/
├── packages/shared/   # Núcleo clínico (thresholds, status, validações) — sem framework
├── backend/           # API (domain → application → infrastructure → interface)
│   └── prisma/        # schema + migrations + seed
└── frontend/          # SPA React (telas, componentes reutilizáveis, gráficos)
```

---

## 2. Arquitetura (Clean Architecture)

Dependências apontam **sempre para dentro** — as regras de negócio não conhecem Fastify,
Prisma nem o provedor de WhatsApp.

```
interface (HTTP/Fastify)  ─┐
infrastructure (Prisma,    │  dependem de →   application (use cases)
  WhatsApp, export, JWT)  ─┘                         │ dependem de →
                                                    domain (entidades, ports, erros)
```

- **`domain/`** — entidades planas, interfaces de repositório (ports), erros de domínio.
- **`application/`** — use cases (`LoginUseCase`, `CreateTeamUseCase`, `RegisterPatientUseCase`,
  `RegisterVitalSignsUseCase`, `AlertDispatcher`, `ExportDataUseCase`, …) e o serviço de
  autorização `AccessControl`. Dependem apenas de **ports** (`ports.ts`).
- **`infrastructure/`** — implementações concretas: repositórios Prisma, `BcryptPasswordHasher`,
  `JwtTokenService`, `CryptoLinkTokenService`, gateway de WhatsApp (com factory de provedor),
  serviço de exportação CSV/XLSX, logger de auditoria.
- **`interface/http/`** — rotas Fastify, middlewares de autenticação/RBAC e tratamento de erros.
- **`container.ts`** — *Composition Root*: o único lugar que conhece as implementações concretas.

**Pontos de troca isolados** (baixo acoplamento):
- Banco de dados → trocar implementações em `infrastructure/prisma`.
- Provedor de WhatsApp → `createWhatsappGateway` (`log` | `twilio` | `meta`).
- Formato de exportação → `ExcelExportService`.
- **Regras clínicas → `packages/shared/src/clinical/thresholds.ts` (arquivo único).**

---

## 3. Como rodar localmente

### Pré-requisitos
- Node.js ≥ 20, Docker Desktop.

### Passos

```bash
# 1. Instalar dependências (raiz do monorepo)
npm install

# 2. Configurar ambiente
cp .env.example .env        # ajuste segredos se quiser

# 3. Subir o banco (Postgres em Docker, porta host 5544)
npm run db:up

# 4. Compilar o pacote compartilhado (necessário antes de backend/frontend)
npm run build:shared

# 5. Migrar o schema e popular ADM + catálogos
npm run db:migrate          # cria as tabelas
npm run db:seed             # ADM, tipos de cirurgia, hospitais

# 6. Rodar backend + frontend juntos
npm run dev
```

- API: <http://localhost:3333> (rotas em `/api`, healthcheck em `/health`)
- App: <http://localhost:5173>

### Acesso inicial
- **ADM:** `admin@vitalsync.local` / `Admin@123` (definido no `.env`).
- Crie equipes em **Equipes** → cadastre pacientes em **Cadastrar paciente** → o link gerado
  abre a tela do paciente em `/r/:token` (compartilhável por WhatsApp).

> ℹ️ A porta do Postgres foi mapeada para **5544** no host para evitar conflito com instalações
> locais de PostgreSQL na 5432. Para usar 5432, edite `docker-compose.yml` e `DATABASE_URL`.

### Scripts úteis (raiz)
| Comando | Ação |
|---------|------|
| `npm run dev` | shared + backend + frontend |
| `npm run build` | build de produção de tudo |
| `npm run db:up` / `db:down` | sobe/derruba o Postgres |
| `npm run db:migrate` / `db:seed` / `db:reset` | Prisma |

---

## 4. Fluxo de navegação

```
LOGIN (/login)  ──► redireciona conforme perfil
   │
   ├─ ADM / Cirurgião / Associado
   │     ├─ /monitoring            Pacientes em Monitoramento (cards, filtros, export*)
   │     │      └─ /patients/:id   Acompanhamento Individual (gráficos, atendimento)
   │     ├─ /patients/new          Cadastro de Pacientes (gera link)
   │     └─ /teams**               Gerenciar Equipes
   │
   └─ PACIENTE (sem login)
         └─ /r/:token              Registro de Sinais Vitais (manhã/noite) ──► tela de sucesso

 *  Exportação CSV/XLSX: somente ADM.
 ** Equipes: somente ADM e cirurgião responsável.
```

Quando uma medição gera status **amarelo/vermelho**, um alerta é enviado a **todos os médicos da
equipe** (cirurgião + associados). Marcar "Atendido por" no acompanhamento reflete no card de
monitoramento; uma nova medição do paciente **reseta** o atendimento.

---

## 5. Segurança e privacidade (LGPD)

- Senhas com **bcrypt**; sessão via **JWT**; CORS restrito; **Helmet**; **rate-limit**.
- **Autorização validada no backend** (não só no front): médico associado só vê pacientes da
  própria equipe (`AccessControl`).
- **Links do paciente**: token aleatório de 256 bits; o banco guarda só o **hash SHA-256**.
  O token existe apenas na URL — nenhum dado sensível é exposto. Link com validade.
- **Auditoria**: login, cadastro, alteração, exclusão, visualização de paciente, atendimento,
  envio de alerta e exportação são registrados em `audit_logs`.
- Validação de entrada com **Zod** (HTTP) **e** nas use cases (autoritativa).

---

## 6. Sugestões de deploy

- **Banco**: PostgreSQL gerenciado (Neon, Supabase, RDS). Rodar `npm run db:deploy`
  (`prisma migrate deploy`) no pipeline.
- **Backend**: container Docker (Node 20) em Railway/Render/Fly.io/ECS. Variáveis de ambiente
  conforme `.env.example`; trocar `JWT_SECRET` por segredo forte e `WHATSAPP_PROVIDER` para
  `twilio`/`meta` com as credenciais reais.
- **Frontend**: build estático (`npm run build --workspace @vitalsync/frontend`) servido por
  Vercel/Netlify/CDN. Definir `VITE_API_URL` para a URL pública da API.
- **Escala (≥500 → crescimento)**: índices já previstos (paciente, equipe, status, período);
  paginação nas listagens; cache pode ser adicionado em catálogos. Arquitetura desacoplada
  permite trocar banco/provedor/framework sem reescrever regras.

---

## 7. Pontos pendentes (confirmação médica)

Ver **[`docs/PONTOS_PENDENTES.md`](docs/PONTOS_PENDENTES.md)**. Resumo: as **faixas de validação
de Pressão Arterial e Frequência Cardíaca** na tela do paciente e os **limiares de alerta da
Pressão Arterial** estão marcados como provisórios no código
(`PENDING_MEDICAL_VALIDATION = true`) conforme a anotação *"Letícia irá confirmar os valores"*.
Nenhum valor final foi inventado — todos são facilmente editáveis em
`packages/shared/src/clinical/thresholds.ts`.

---

## 8. Extensibilidade

Pensado para crescer sem grandes mudanças:
- **Novo sinal vital** → adicionar em `VitalKind`, `thresholds.ts`, `status.ts` e um gráfico.
- **Novo canal de notificação** → implementar `NotificationGateway` e registrar no factory.
- **Novo perfil** → adicionar em `Role` e nas regras de `AccessControl`.
- **Novo formato de exportação** → estender `ExportService`.
