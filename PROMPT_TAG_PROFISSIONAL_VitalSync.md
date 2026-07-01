# Prompt — Tag única de profissional (VitalSync)

> Versão refinada e **ancorada na arquitetura real do projeto**. Substitui o pedido
> genérico anterior. Use este texto como a tarefa a ser implementada.

---

## 0. Contexto técnico REAL do VitalSync (ler antes de tudo)

A versão anterior do prompt assumia "Supabase service" de forma vaga e citava
"migration/Prisma" como se fossem intercambiáveis. **Não são.** A arquitetura
viva é a seguinte — respeite-a:

- **Camada de dados viva = Supabase** (PostgreSQL + RLS + RPCs `SECURITY DEFINER` +
  Edge Functions). O frontend fala **direto com o Supabase** via `supabase-js`
  (`frontend/src/lib/supabase.ts`), **não** existe API REST/Express em produção.
- **O diretório `backend/` (Express + Prisma) é LEGADO.** O `schema.prisma` usa
  `users` / enum `SURGEON`/`ASSOCIATE` — **NÃO é o que roda**. **Ignore `backend/`
  e `backend/prisma/` por completo.** Não crie migration Prisma. Não altere o
  schema Prisma.
- **Tabela dos profissionais = `public.profiles`** (criada em
  `supabase/migrations/0001_init.sql`). Colunas atuais: `id`, `name`, `email`,
  `whatsapp`, `role`, `avatar_url`, `specialty`, `crm`, `notes`, `status`,
  `notification_prefs`, `created_at`, `updated_at`. (Pacientes **não** são
  `profiles`.)
- **Enum de papel = `public.user_role`** com os valores reais:
  `ADMIN`, `MAIN_SURGEON`, `ASSOCIATED_DOCTOR`, `SUPPORT`.
  - "Cirurgião Principal" = `MAIN_SURGEON`
  - "Médico Associado" = `ASSOCIATED_DOCTOR`
- **Equipes:** `public.medical_teams` (`team_number`, `main_surgeon_id → profiles.id`,
  `status`). O cirurgião principal é `medical_teams.main_surgeon_id`. Os associados
  são linhas em `public.team_members` (`team_id`, `doctor_id → profiles.id`,
  `role_in_team`, `status`).
- **Migrations Supabase = arquivos SQL sequenciais** em `supabase/migrations/00XX_*.sql`.
  A maior hoje é `0018_homologation.sql`. **A nova migration deve ser
  `0019_professional_tag.sql`.**
- **Extensões disponíveis:** apenas `pgcrypto` (em `extensions`). **`unaccent` NÃO
  está instalada** — ou crie `create extension if not exists unaccent` na migration,
  ou remova acentos via `translate(...)`. Decida e justifique.
- **Tipo TS do profissional:** `interface Profile` em
  `frontend/src/services/types.ts`. Precisará do novo campo.

### Os 3 pontos de criação de profissional onde a tag PRECISA nascer
1. **RPC `public.admin_create_user(p_name, p_role, ...)`** — `supabase/migrations/0007_admin_users.sql`
   (faz `insert into public.profiles`). Usada por "Gerenciar Usuários"
   (`frontend/src/services/userService.ts`).
2. **RPC `public.admin_create_doctor(...)`** — `supabase/migrations/0004_admin_create_doctor.sql`
   (caminho mais antigo; verificar se ainda é chamado e cobrir se for).
3. **Edge Function `supabase/functions/accept-invite/index.ts`** — fluxo de
   **convite por link** (`professional_invites`, migration `0017`); insere/completa
   `profiles` com `service_role`. A tag tem de ser gerada aqui também.

> Regra de ouro: **a geração da tag deve viver no banco** (função SQL única,
> `SECURITY DEFINER`, com `unique index`), e os 3 pontos acima a invocam. Não
> reimplemente a lógica em 3 lugares e **nunca** gere a tag definitiva só no
> frontend.

---

## 1. Objetivo

Dar a cada profissional uma **tag pública única** no formato
`PrimeiroNomeReal#0000` (ex.: `Joao#4821`, `Ana#0392`), persistida em `profiles`,
exibida de forma discreta junto ao nome em todo o sistema, e usada como critério
de **busca** ao montar equipes. A tag é **identificador visual/de busca apenas** —
o salvamento de relações continua usando o `id` (uuid) real de `profiles`.

Faça **análise antes de codar** e a **menor alteração segura**. Não saia do escopo.

---

## 2. Regra da tag

- Aplicar a, no mínimo, `MAIN_SURGEON` e `ASSOCIATED_DOCTOR`.
  **Recomendado:** gerar para **todo** `profiles` (inclui `ADMIN`/`SUPPORT`) — é
  barato, garante unicidade global e evita casos sem tag. Confirme essa decisão no
  relatório final.
- Formato: `PrimeiroNome#NNNN` (4 dígitos).
- A base é o **primeiro nome REAL**, nunca título/cargo.

### Limpeza do nome antes de gerar (server-side)
1. `trim` + colapsar espaços.
2. Remover **do início** títulos/prefixos: `Dr`, `Dr.`, `Dra`, `Dra.`, `Doutor`,
   `Doutora`, `Médico`, `Medico`, `Médica`, `Medica`, `Cirurgião`, `Cirurgiao`,
   `Cirurgiã`, `Cirurgia`, `Profissional`, `Principal`, `Associado`, `Associada`
   (case-insensitive, com e sem acento, repetidos).
3. Remover acentos (`unaccent`/`translate`).
4. Manter só letras/números; descartar pontuação/símbolos.
5. Pegar o primeiro token restante = primeiro nome.
6. Capitalizar limpo (`Joao`).
7. Gerar 4 dígitos.
8. Combinar `Nome#NNNN` e **garantir unicidade** (re-tentar em colisão).
9. **Fallback extremo** se nada sobrar: `User#NNNN`.

Exemplos corretos:
`Dr. João Pereira → Joao#4821` · `Dra. Ana Souza → Ana#0392` ·
`Médico Associado Carlos Lima → Carlos#7184` ·
`Dr. Cirurgião Principal Marcos Oliveira → Marcos#7710`.
**Errado:** `Dr#...`, `Medico#...`, `Cirurgiao#...`.

---

## 3. Persistência e unicidade (migration `0019_professional_tag.sql`)

Na migration:
1. `alter table public.profiles add column if not exists professional_tag text;`
   (nome do campo: **`professional_tag`** — claro e consistente com o estilo do
   projeto; não usar `tag` solto).
2. `create unique index if not exists uq_profiles_professional_tag on public.profiles(professional_tag) where professional_tag is not null;`
3. Função SQL **única** `public.generate_professional_tag(p_name text) returns text`
   (`SECURITY DEFINER`, `search_path` fixo) implementando a limpeza da seção 2,
   gerando os 4 dígitos e **re-tentando em colisão** (loop com checagem +
   tratamento de `unique_violation`).
4. **Backfill** dos profissionais existentes sem tag, na própria migration
   (ou função chamada por ela), respeitando: nenhum fica sem tag; sem duplicar; sem
   sobrescrever tag já existente; **sem** tocar em `name`/`email`/`role`/`status`/
   permissões; sem apagar nada.
5. Garantir que a coluna seja **legível** pelos papéis autenticados que já leem
   `profiles` (revisar policies de RLS — a tag é pública por natureza). Não afrouxar
   RLS além disso.
6. A unicidade **não pode** depender do frontend: fica no `unique index` +
   função `SECURITY DEFINER`.

> Onde injetar nas criações: `admin_create_user` (0007) e `admin_create_doctor`
> (0004) passam a chamar `generate_professional_tag(p_name)` no `insert into profiles`;
> a Edge `accept-invite` chama a mesma RPC/lógica ao completar o profile. Em
> colisão (corrida), capturar e re-gerar.

---

## 4. Frontend — tipos e dados

- Adicionar `professional_tag: string | null` à `interface Profile`
  (`frontend/src/services/types.ts`) e aos tipos derivados usados em equipes
  (`teams-types.ts`, retornos de `teamService`/`userService`/`profileService`).
- **Incluir a coluna nos `select` do Supabase** que hoje trazem o profissional —
  ex.: em `teamService.ts` o select
  `profiles!team_members_doctor_id_fkey(id,name,email,whatsapp,role)` passa a
  incluir `professional_tag`. Revisar todos os `select('... profiles ...')`.

---

## 5. Exibição da tag (discreta, dentro do design system)

Texto menor abaixo do nome **ou** badge sutil ao lado. Cor/typografia discretas,
sem poluir, sem competir com o nome. Aplicar em:

- **Meu Perfil** — `frontend/src/pages/MyProfilePage.tsx` + `components/profile.tsx`
  (card de perfil e área de dados pessoais).
- **Sidebar / usuário logado** — `components/RoleBasedSidebar.tsx` e
  `components/Layout.tsx` (rodapé/card do usuário). Não quebrar layout.
- **Detalhes da Equipe** — `pages/TeamsPage.tsx` + `components/teams.tsx`
  (`TeamDashboard.tsx`, `TeamCarousel.tsx`): tag do cirurgião principal e de cada
  associado.
- **Nova Equipe Médica** — formulário em `pages/TeamsPage.tsx`: opções de seleção
  mostram nome + tag.
- **Gerenciar Equipes** — `components/teams-admin.tsx` (listagens, chips, filtros de
  cirurgião/associado): mostrar tag onde aparecer o profissional.
- **Gerenciar Usuários** — `pages/admin/UsersPage.tsx` + `components/users-admin.tsx`.
- **Convites** — `pages/InvitesPage.tsx` (quando exibir o profissional/convidado).
- Demais telas onde nome de cirurgião/associado apareça e a tag ajude.

Não force a tag onde poluir; mas revise o sistema inteiro.

---

## 6. Seleção de profissional escalável (substituir `<select>` nativo)

Hoje a escolha de cirurgião e associados usa `<select>`/`<option>` nativos
(`teams-admin.tsx`, formulário em `TeamsPage.tsx`). Isso não escala. **Não existe
biblioteca de combobox no projeto** (sem `cmdk`/headless) — construa um componente
**leve e próprio**, reaproveitando os estilos de `components/ui.tsx`, sem
adicionar dependências pesadas. Padrão: input de busca + lista filtrada
(client-side sobre os profiles já carregados é suficiente).

Buscar por: **nome completo, tag, e-mail e papel**. Cada resultado mostra
**nome + tag** e o papel. Ex.:

```
Dr. João Pereira   Joao#1842 · Cirurgião Principal
Dra. Ana Souza     Ana#0392  · Médica Associada
```

- **Cirurgião principal** (Nova Equipe e Detalhes/edição): combobox pesquisável;
  salva `medical_teams.main_surgeon_id` (uuid).
- **Adicionar médico associado** (Detalhes da Equipe): combobox pesquisável;
  insere em `team_members` com `doctor_id` (uuid) e `role_in_team='ASSOCIATED_DOCTOR'`.

A tag é só para achar; **o valor salvo é sempre o `id` (uuid)**.

---

## 7. Escopo — fazer só isto

Manter intactos: autenticação, RLS/permissões, rotas, cadastro de pacientes,
dashboard, alertas, acompanhamento individual (salvo exibir tag onde aparece nome
de médico), fluxo do paciente. Regras de equipe inalteradas (1 cirurgião principal
por equipe; associados conforme regra atual; validações existentes).

**Não:** apagar dados; criar dados fictícios; trocar `id` por tag; usar tag como
chave primária; quebrar equipes/convites existentes; refatorar o sistema; mexer no
`backend/`/Prisma; alterar identidade visual geral; **fazer commit, push, PR ou
criar branch** sem o usuário pedir.

---

## 8. Responsividade (desktop + mobile, prioridade mobile)

Testar em 320, 360, 375, 390, 412 e 430 px. Garantir: sem scroll lateral; tag não
estoura/corta cards nem nomes; combobox/resultados fáceis de tocar e não cortados;
sidebar/card mobile não quebra; Nova Equipe e Detalhes da Equipe usáveis em telas
pequenas.

---

## 9. Critérios de aceite

Todo `MAIN_SURGEON`/`ASSOCIATED_DOCTOR` (idealmente todo profile) tem tag única no
padrão `PrimeiroNomeReal#0000`; títulos (Dr./Dra./Médico/Cirurgião/Associado) nunca
viram a base; **zero** tags duplicadas (garantido por `unique index`); usuários
antigos receberam tag sem perda de dados; tag visível em perfil, sidebar, detalhes
da equipe, nova equipe, listagens relevantes; busca por nome **e** por tag
funcionando, mostrando nome + tag; relações salvas via `id` (uuid); seleção escala
para muitos profissionais; layout coerente; mobile sem scroll lateral; nada fora do
escopo alterado; nenhum commit/push/PR feito.

---

## 10. Testes obrigatórios

1. Criar usuário via "Gerenciar Usuários" (`admin_create_user`) → recebe tag única.
2. Aceitar convite (`accept-invite`) de cirurgião e de associado → cada um recebe tag única.
3. Dois profissionais com mesmo primeiro nome → tags diferentes.
4. Nome com Dr./Dra./Médico/Cirurgião → tag sem o título.
5. Profissionais antigos sem tag → recebem tag (backfill).
6. Conferir no banco que não há `professional_tag` duplicada.
7. Meu Perfil exibe a tag bem posicionada.
8. Sidebar/card do usuário logado exibe a tag sem quebrar.
9–12. Nova Equipe: buscar cirurgião por nome e por tag; resultado mostra nome + tag.
13–16. Detalhes da Equipe: buscar/adicionar associado por nome e por tag; vincula o correto.
17. Equipe continua usando `id` (uuid) na relação (conferir `main_surgeon_id`/`team_members.doctor_id`).
18–21. Desktop e mobile (320–430 px); sem scroll lateral; busca confortável no celular.

---

## 11. Entregar antes de finalizar (relatório)

Listar arquivos alterados; explicar geração da tag (função SQL única + unicidade);
como os títulos são removidos; como a duplicidade é evitada (`unique index` +
re-tentativa); onde a tag é salva (`profiles.professional_tag`); como o backfill
rodou; onde a tag passou a aparecer; como ficou a busca por nome/tag; por que a
associação de equipe não quebra (continua via `id`); confirmar mobile testado;
confirmar nada fora do escopo; **confirmar que não houve commit/push/PR** e
**aguardar validação manual do usuário**.
