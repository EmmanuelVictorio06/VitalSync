# Prompt — Cirurgião Principal gerencia suas próprias equipes (VitalSync / CURAPATH)

> Versão refinada e **ancorada na arquitetura real do projeto**. Corrige
> suposições de schema/permissão do pedido original. Use este texto como a tarefa.

---

## 0. Estado REAL do projeto (ler antes de codar)

A camada viva é **Supabase** (PostgreSQL + RLS + RPCs `SECURITY DEFINER` + Edge
Functions); o frontend fala direto via `supabase-js`. **O diretório `backend/`
(Express + Prisma) é LEGADO — ignore.** Migrations são SQL sequenciais em
`supabase/migrations/00XX_*.sql` (maior atual: `0019_professional_tag.sql` → a nova
deve ser **`0020_surgeon_teams.sql`**).

### O que JÁ existe (aproveitar, não recriar)
- **Tabela `public.medical_teams`**: `id`, `team_number` (int **unique, hoje manual**),
  `main_surgeon_id → profiles.id`, `status` (`entity_status`: `ACTIVE`/`INACTIVE`),
  `created_at`. **NÃO existem** `name`, `description`, `created_by`, `archived_at`,
  `updated_at`.
- **Tabela `public.team_members`**: `id`, `team_id`, `doctor_id → profiles.id`,
  `role_in_team` (`MAIN_SURGEON`/`ASSOCIATED_DOCTOR`), `status`, `created_at`,
  `unique(team_id, doctor_id)`. **Não existe** `created_by`.
- **Enum `user_role`**: `ADMIN`, `MAIN_SURGEON`, `ASSOCIATED_DOCTOR`, `SUPPORT`.
- **Helpers SQL prontos**: `is_admin()`, `is_support()`, `is_team_member(team)`,
  `is_main_surgeon_of(team)`. (Não há helpers de contagem ainda.)
- **RLS atual de equipes:**
  - `teams_select`: `is_admin() OR is_team_member(id)` → cirurgião **já enxerga** suas equipes.
  - `teams_admin` (ALL): **`is_admin()` apenas** → **cirurgião NÃO cria/edita
    `medical_teams` hoje. ESTE é o gap central a resolver.**
  - `members_select`: `is_admin() OR is_team_member(team_id)`.
  - `members_admin` (ALL): `is_admin() OR is_main_surgeon_of(team_id)` →
    **cirurgião JÁ pode adicionar/remover associados da própria equipe** (sem limite).
- **Convites**: tabela `professional_invites` + RPC `create_professional_invite(p_role,
  p_team_id,...)` + Edge `accept-invite`. Hoje a RPC é **admin/suporte apenas**
  (`is_admin() OR is_support()`). O aceite já insere o profissional na equipe do convite.
- **Telas já existentes** (estender, **não** criar do zero):
  - `frontend/src/pages/MyTeamPage.tsx` — "Minhas Equipes" do **cirurgião**
    (usa `teamViewService.getMyMainTeams()`).
  - `frontend/src/pages/MyTeamsPage.tsx` — "Minhas Equipes" do **associado** (somente leitura).
  - `frontend/src/pages/TeamsPage.tsx` + `components/teams.tsx`/`teams-admin.tsx` — visão **admin**.
  - Serviços: `services/teamViewService.ts`, `services/teamService.ts`,
    `services/professionalInviteService.ts`. (Os selects já trazem `professional_tag`.)

### Correções que o pedido original precisava
1. **Não invente campos.** Equipe é identificada por `team_number`, **não há `name`**.
   Se o produto exige nome, **adicione coluna opcional** `name text` em `0020`
   (decida e justifique); caso contrário, use `team_number`. "Arquivar" = `status='INACTIVE'`
   (não há `archived_at` — adicione só se for usar de fato).
2. **`team_number` é manual e único.** Em auto-serviço, **gere o número no banco**
   (próximo disponível) dentro de uma RPC — não deixe o frontend escolher.
3. **Limites (5/10) NÃO têm enforcement hoje.** Têm de ser garantidos **no banco**.
4. **Cirurgião não cria equipe hoje** (RLS `teams_admin` é admin-only). O caminho
   recomendado é **RPC `SECURITY DEFINER`** (que valida papel + limite + gera
   `team_number`), e **não** afrouxar a policy `teams_admin` para um INSERT livre.
5. **Convite por cirurgião** exige estender `create_professional_invite` para aceitar
   `is_main_surgeon_of(p_team_id)` (hoje bloqueia não-admin/suporte).
6. **Estender `MyTeamPage`**, não criar uma `SurgeonTeamsPage` paralela do zero
   (componentes novos podem existir, mas a página/roteamento já estão lá).

---

## 1. Objetivo

Permitir que cada **`MAIN_SURGEON`** crie e gerencie **suas próprias** equipes, com
limites e permissões aplicados **server-side**:
- **máx. 5 equipes ativas por cirurgião**;
- **máx. 10 médicos associados por equipe** (o cirurgião responsável **não** conta).

Admin mantém acesso total; associado só lê; suporte conforme permissões já definidas.

Fazer **análise antes de codar** e a **menor alteração segura**. Não sair do escopo.

---

## 2. Banco / segurança (migration `0020_surgeon_teams.sql`)

Implementar **no banco** (não confiar no frontend):

1. **Constantes/limites** centralizados (constante no SQL e espelhados no front via um
   único módulo de constantes; sem strings/numeros mágicos espalhados): `5` e `10`.
2. **Helpers de contagem** (ex.: `count_active_teams_by_surgeon(p_surgeon uuid)`,
   `count_associated_doctors(p_team uuid)` — este conta só `team_members` com
   `role_in_team='ASSOCIATED_DOCTOR'` e `status='ACTIVE'`).
3. **RPC `surgeon_create_team(...)`** (`SECURITY DEFINER`, `search_path` fixo):
   - exige `is_admin()` ou papel `MAIN_SURGEON` do `auth.uid()`;
   - define `main_surgeon_id = auth.uid()` (cirurgião nunca escolhe outro responsável);
   - **valida limite de 5** equipes ativas → erro `TEAM_LIMIT_REACHED`;
   - **gera `team_number`** automaticamente (próximo livre) com tratamento de corrida
     (`unique_violation` → re-tentar);
   - cria a linha em `medical_teams`.
4. **Enforcement do limite de 10 associados**: trigger `BEFORE INSERT` em
   `team_members` (ou RPC de adição) que rejeita o 11º associado ativo →
   erro `TEAM_DOCTOR_LIMIT_REACHED`. (Cobrir também reativação de membro.)
5. **RLS para o cirurgião gerenciar a própria equipe**:
   - `medical_teams` UPDATE/arquivamento da **própria** equipe: nova policy
     `using/with check (is_admin() OR is_main_surgeon_of(id))` **sem** permitir trocar
     `main_surgeon_id` para outro (proteger via trigger/coluna imutável);
   - manter `members_admin` como está (já cobre add/remove pelo cirurgião), mas o
     **limite** passa a ser garantido pela trigger do item 4;
   - **impedir remover o próprio cirurgião responsável** da equipe.
6. **Convite pelo cirurgião**: estender `create_professional_invite` para permitir
   `is_main_surgeon_of(p_team_id)` quando `p_role='ASSOCIATED_DOCTOR'` e o convite for
   **para a equipe dele**; manter expiração e uso único já existentes; ajustar a RLS
   `prof_invites_admin_support` conforme necessário (sem abrir além disso).
7. Preservar **auditoria** (triggers de `0005_teams_audit.sql`) e não quebrar RLS de
   pacientes/alertas (continuam escopados por equipe).

> Erros padronizados (mesmas chaves no back e no front):
> `TEAM_LIMIT_REACHED`, `TEAM_DOCTOR_LIMIT_REACHED`, `FORBIDDEN`,
> `CANNOT_REMOVE_MAIN_SURGEON`.

---

## 3. Serviços (frontend)

Estender os serviços existentes (não duplicar lógica de permissão no componente):
- `teamViewService.ts`: já tem `getMyMainTeams()`; adicionar contadores/uso
  (`x/5`, `x/10`) lendo do banco.
- `teamService.ts`: trocar o `create({ team_number, main_surgeon_id })` manual pela
  RPC `surgeon_create_team`; expor `updateMyTeam`, `archiveMyTeam`,
  `addAssociatedDoctor`, `removeAssociatedDoctor` chamando as RPCs/queries com RLS.
- `professionalInviteService.ts`: permitir o cirurgião gerar convite
  `ASSOCIATED_DOCTOR` vinculado à **sua** equipe.
- Tipos: reaproveitar `TeamRole = 'MAIN_SURGEON' | 'ASSOCIATED_DOCTOR'` e um objeto de
  limites `{ maxTeamsPerSurgeon: 5, maxAssociatedDoctorsPerTeam: 10 }` num único lugar.

Mapear erros das RPCs para mensagens PT-BR (reusar o padrão de
`teamService` que já traduz `team_number duplicate` etc.).

---

## 4. UI — estender `MyTeamPage` ("Minhas Equipes" do cirurgião)

Cabeçalho: título "Minhas Equipes", subtítulo "Crie e gerencie suas equipes médicas
de acompanhamento pós-operatório." Botão **"Nova equipe"** — **desabilitado** ao
atingir 5, com tooltip "Limite de 5 equipes atingido."

**Cards de resumo** (responsivos): `Equipes: 3/5`, `Médicos associados`, `Pacientes
em monitoramento`, `Alertas ativos`.

**Lista de equipes** (cards): número da equipe, cirurgião responsável,
`Médicos associados: 7/10`, pacientes, alertas, status. Ações primárias: Ver
pacientes / Ver alertas / Gerenciar equipe. Menu "⋮": Editar, Adicionar médico,
Gerar convite, Arquivar.

**Criar equipe** (modal no desktop → drawer/tela cheia no mobile): cirurgião logado
é responsável automaticamente (sem escolher outro); bloquear se 5 atingido; feedback
"Equipe criada com sucesso." Como não há `name` hoje, **decidir**: usar
`team_number` gerado, ou habilitar `name` opcional (item 1 da seção 2).

**Gerenciar equipe** (drawer): dados, responsável, lista de associados com contador
`x/10`, adicionar/remover associado (buscar por nome, e-mail, CRM, WhatsApp ou
**tag** — reusar o combobox/`professional_tag` já existente), pacientes e alertas da
equipe. Confirmar remoção; **bloquear remover o responsável**.

**Estados vazios**: "Nenhuma equipe criada" / CTA "Criar equipe"; e, no limite,
"Limite de equipes atingido — arquive uma equipe ou fale com o administrador."

Componentes sugeridos (criar se ajudar, dentro do padrão de `components/ui.tsx`):
`SurgeonTeamsSummaryCards`, `SurgeonTeamCard`, `CreateSurgeonTeamDialog`,
`ManageSurgeonTeamDrawer`, `TeamDoctorsList`, `AddTeamDoctorForm`, `TeamLimitBadge`,
`DoctorLimitBadge`, `TeamActionsMenu`.

---

## 5. Permissões (resumo)

- **Admin**: tudo (já coberto por `is_admin()`).
- **Cirurgião (`MAIN_SURGEON`)**: cria até 5 equipes próprias; edita/arquiva as suas;
  adiciona até 10 associados; remove associados; vê pacientes/alertas das suas;
  gera convite de associado para a sua equipe. **Não** edita equipe de outro, não
  remove o responsável, não ultrapassa limites, não acessa equipe alheia.
- **Associado (`ASSOCIATED_DOCTOR`)**: só leitura (`MyTeamsPage`).
- **Suporte (`SUPPORT`)**: conforme `is_support()`/migration `0016`; por padrão não
  cria/edita equipe nem remove médicos.

Tudo isso **garantido por RLS/RPC no banco**, não só na UI.

---

## 6. Responsividade

Mobile-first; testar em 320, 375, 414, 768, 1024, 1366, 1440 px. Sem scroll
horizontal; cards em coluna única no mobile; toque mínimo 44px; modal grande vira
drawer/tela cheia; filtros em bottom sheet; truncar textos longos; contadores `3/5`
e `7/10` legíveis. Seguir o design system (fundo cinza claro, cards brancos, cantos
arredondados, azul primário, verde/amarelo/vermelho para estados).

---

## 7. Escopo / não fazer

Não mexer em `backend/`/Prisma; não alterar autenticação; não afrouxar RLS além do
necessário; não trocar `id`(uuid) por outra chave; não quebrar fluxo de pacientes,
alertas, convites ou auditoria existentes; **não** fazer commit/push/PR nem criar
branch sem o usuário pedir.

---

## 8. Testes obrigatórios

1. Cirurgião com 0 equipes cria equipe. 2. Com 4, cria a 5ª. 3. Com 5, a 6ª é
bloqueada (`TEAM_LIMIT_REACHED`) e a mensagem/botão refletem isso. 4. Equipe com 9
associados aceita o 10º. 5. Com 10, o 11º é bloqueado (`TEAM_DOCTOR_LIMIT_REACHED`).
6. Associado não cria nem edita equipe. 7. Cirurgião não edita equipe de outro
(`FORBIDDEN`) — **validado no banco, não só na UI**. 8. Admin vê e gerencia todas.
9. Cirurgião remove associado da sua equipe. 10. Não consegue remover a si mesmo
como responsável (`CANNOT_REMOVE_MAIN_SURGEON`). 11. Convite gerado pelo cirurgião
entra na equipe correta com role `ASSOCIATED_DOCTOR`, expira e é uso único.
12. Pacientes/alertas continuam escopados por equipe. 13. Tela funciona no mobile
sem scroll horizontal. 14. `npm run build` passa.

> Validar os limites também via chamada direta às RPCs (simular bypass do front) para
> provar o enforcement server-side.

---

## 9. Entregar antes de finalizar

Listar arquivos/migrations alterados; explicar como os limites 5/10 são garantidos no
banco (RPC + trigger) e por que não dá para burlar pelo front; como `team_number` é
gerado; como a RLS passou a permitir o cirurgião gerenciar só a equipe dele; como o
convite por cirurgião foi habilitado sem abrir além do necessário; decisão sobre
`name`/`archive`; confirmar mobile testado, build passando, nada fora do escopo, e
**nenhum commit/push/PR** — aguardar validação manual do usuário.
