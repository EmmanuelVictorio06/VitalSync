# Prompt — Ajustes de Equipes, Cirurgião e Gerente de Equipe (VitalSync / CuraPath)

> **Como usar:** especificação de implementação, ancorada no **estado real do repositório** (verificado em `supabase/migrations/0028…0032`, `frontend/src/pages/ManagerTeamsPage.tsx`, `frontend/src/services/{teamManagerService,teamViewService,teamService}.ts`, `frontend/src/components/RoleBasedSidebar.tsx`, `frontend/src/App.tsx`). Muita coisa desta feature **já existe** (papel `TEAM_MANAGER`, tabela `team_manager_surgeons`, RPCs `admin_link_team_manager`/`admin_unlink_team_manager`, `is_team_manager_of`). Este prompt trata do **delta** que ainda falta e **corrige** decisões anteriores. Siga as fases em ordem.

---

## 0. Regra de negócio final (o que deve valer ao terminar)

1. **Um Médico Cirurgião tem no máximo UMA equipe.** (Hoje o limite é 5 — mudar para 1.)
2. **Cada equipe tem no máximo 10 médicos associados** (o cirurgião responsável **não** conta). *(Já garantido pelo trigger `enforce_team_doctor_limit` — manter.)*
3. **O Gerente de Equipe está sempre vinculado a pelo menos um Médico Cirurgião.** Pode estar vinculado a **vários** cirurgiões.
4. **Quem faz o vínculo Gerente↔Cirurgião é o Administrador**, na tela **Gerenciar Equipes** (`/teams`).
5. **O perfil de Médico Cirurgião não tem mais a aba "Cadastro de Pacientes".** Quem cadastra paciente é o **Gerente de Equipe** (e o Admin).
6. **O Gerente só cadastra paciente em equipes de cirurgiões aos quais ele está vinculado.**
7. **A tela "Equipes Vinculadas" (`/manager-teams`) mostra as equipes dos cirurgiões vinculados ao gerente logado.** *(Hoje mostra "Nenhuma equipe vinculada" por um bug de query — ver Fase 4.)*

---

## 1. Guardrails (invioláveis)

1. **Mudanças cirúrgicas.** Implemente só o descrito. Se achar algo a mais para corrigir, **registre e pergunte** — não conserte por conta própria.
2. **Camada viva é Supabase.** Ignore `backend/`, `lib/api.ts`, `lib/admin-api.ts`, `lib/teams-api.ts` (legado/mock). Não invista neles.
3. **Migrations só por adição.** Nunca edite migration aplicada (`0001…0032`). Toda mudança de schema é **nova** migration sequencial começando em **`0033`**. Use `create or replace`, `if not exists`. **Não** repita um número já usado (um `0010` duplicado já quebrou `db push`).
4. **Permissão vale nos dois lados.** UI esconde; **RLS/RPC/Edge Function decide**. Nenhum item aqui é "só front".
5. **Não afrouxe RLS existente.** Ao mexer numa policy, faça `OR`/ajuste pontual — nunca remova a condição de admin/cirurgião/associado por engano.
6. **Fonte única de papéis** é `frontend/src/lib/roles.ts` + `@vitalsync/shared`. Não duplicar de-para.
7. **Fonte única de limites clínicos** é `packages/shared/src/clinical/thresholds.ts`. Não inventar valores.
8. **PT-BR** em toda UI e mensagem de erro, no tom já usado (ver `translateError` em `teamService.ts`).
9. **Não rode migration/seed/deploy** (`supabase db push`, `functions deploy`) sem autorização. Entregue os `.sql`/código e diga o comando; quem roda é o dono.
10. **Sem commit/push/PR/branch** sem o dono pedir.
11. **Verificação obrigatória ao final de cada fase** (build + teste manual). Se falhar, **pare e relate**.
12. **Não quebrar o que já funciona:** login por perfil, link público do paciente (gate de CPF, envio de medição/foto), alertas e notificações devem continuar idênticos.

---

## 2. Ordem de execução

| Fase | Conteúdo | Depende de |
|---|---|---|
| 1 | Limite do cirurgião: de 5 equipes → **1 equipe** (banco + front) | — |
| 2 | Admin vincula/desvincula Gerente↔Cirurgião na tela **Gerenciar Equipes** | — |
| 3 | Cirurgião perde a aba "Cadastro de Pacientes" (menu) | — |
| 4 | **"Equipes Vinculadas"** passa a listar as equipes dos cirurgiões vinculados | — |
| 5 | Gerente só cadastra paciente em equipes vinculadas (front + backend) | 4 |
| 6 | Verificação final por perfil | 1-5 |

---

## FASE 1 — Cirurgião tem no máximo UMA equipe

### 1.1 Banco (nova migration `0033_one_team_per_surgeon.sql`)
**Estado atual (verificado):** `supabase/migrations/0028_surgeon_teams.sql` define
`count_active_teams_by_surgeon(p_surgeon uuid)` e, dentro de `surgeon_create_team(...)`,
`if public.count_active_teams_by_surgeon(v_uid) >= 5 then raise exception 'TEAM_LIMIT_REACHED'`.

**Alvo:** trocar o limite de `5` para `1`, **sem editar a migration 0028** — recrie a função com `create or replace`:
```sql
-- 0033_one_team_per_surgeon.sql
create or replace function public.surgeon_create_team(/* mesma assinatura da 0028 */)
returns /* mesmo tipo */
language plpgsql security definer set search_path = public as $$
begin
  -- ... corpo idêntico ao de 0028, trocando SOMENTE o teto:
  if public.count_active_teams_by_surgeon(v_uid) >= 1 then
    raise exception 'TEAM_LIMIT_REACHED';
  end if;
  -- ... resto igual (gera team_number, insere em medical_teams) ...
end;
$$;
```
> **Copie o corpo exato da 0028** (não reescreva de memória) e altere só o `>= 5` → `>= 1`. Mantenha o tratamento de corrida do `team_number` e os grants.

**Também bloquear a criação pelo Admin.** O Admin cria equipe direto (não via `surgeon_create_team`) — hoje `teamService.create({ team_number, main_surgeon_id })` insere em `medical_teams` sob a policy `teams_admin`. Garanta o limite no banco para o caminho do Admin também, via **trigger `before insert on medical_teams`**:
```sql
create or replace function public.enforce_one_team_per_surgeon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.main_surgeon_id is not null
     and new.status = 'ACTIVE'
     and public.count_active_teams_by_surgeon(new.main_surgeon_id) >= 1 then
    raise exception 'TEAM_LIMIT_REACHED';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_one_team_per_surgeon on public.medical_teams;
create trigger trg_one_team_per_surgeon
  before insert on public.medical_teams
  for each row execute function public.enforce_one_team_per_surgeon();
```
> Cubra também a **reativação** (UPDATE de `status` INACTIVE→ACTIVE) e a **troca de responsável** (UPDATE de `main_surgeon_id`) se essas ações puderem burlar o teto — adicione o mesmo `check` no ramo de UPDATE do trigger. Rode antes `select main_surgeon_id, count(*) from medical_teams where status='ACTIVE' group by 1 having count(*) > 1;` para confirmar que **nenhum cirurgião já tem 2+ equipes ativas** (se tiver, decida com o dono antes de aplicar).

### 1.2 Frontend — constante de limite
**Arquivo:** o módulo único de limites (ex.: `TEAM_LIMITS = { maxTeamsPerSurgeon, maxAssociatedDoctorsPerTeam }` — o mesmo já usado em `MyTeamPage.tsx`). Trocar `maxTeamsPerSurgeon: 5` → `1`. Não deixar número mágico espalhado.

### 1.3 Frontend — UI do Admin ("Gerenciar Equipes") e do Cirurgião
- **Modal "Nova Equipe" (`/teams`):** ao escolher o Cirurgião Principal, **não listar** (ou desabilitar com aviso) cirurgiões que **já são responsáveis por uma equipe ativa**. Mensagem: "Este cirurgião já possui uma equipe."
- **`MyTeamPage` (cirurgião):** botão "Nova equipe" **desabilitado** quando ele já tem 1 equipe, com tooltip "Cada cirurgião pode ter apenas uma equipe."
- Mapear o erro `TEAM_LIMIT_REACHED` para PT-BR: "Cada cirurgião pode ter apenas uma equipe."

**Aceite Fase 1:**
- Admin não consegue criar 2ª equipe para o mesmo cirurgião (bloqueio no banco, testado direto na RPC/insert, não só na UI).
- Cirurgião com 1 equipe vê "Nova equipe" desabilitado.
- Cirurgião com 0 equipe cria normalmente.
- `npm run build` passa.

---

## FASE 2 — Admin vincula Gerente↔Cirurgião na tela "Gerenciar Equipes"

**Estado atual (verificado):** as funções existem no serviço mas **não estão ligadas a nenhuma UI** —
`teamManagerService.linkManagerToSurgeon` (RPC `admin_link_team_manager`),
`unlinkManagerFromSurgeon` (RPC `admin_unlink_team_manager`) e `getLinksForManager`
só são referenciadas dentro do próprio serviço; nenhuma tela chama. Confirme com
`grep -rn "linkManagerToSurgeon\|getLinksForManager" frontend/src --include=*.tsx`.

**Alvo:** expor o vínculo na tela **Gerenciar Equipes** (`frontend/src/pages/TeamsPage.tsx` + `frontend/src/components/teams.tsx`). No **drawer "Detalhes da Equipe nº XX"** (o mesmo que hoje tem "Cirurgião Principal", "Médicos Associados" e "Pacientes vinculados"), adicionar uma seção:

> **Gerentes de Equipe** — vinculados ao Cirurgião Principal desta equipe.
> - Lista dos gerentes já vinculados ao `main_surgeon_id` (com opção **Desvincular**).
> - Combobox "Buscar gerente por nome ou tag…" (papel `TEAM_MANAGER`, `status='ACTIVE'`) + botão **Vincular**.

**Serviço:** reusar `teamManagerService.linkManagerToSurgeon(managerId, surgeonId)` / `unlinkManagerFromSurgeon` / `getLinksForManager`. Como o vínculo é **manager↔surgeon** (não manager↔team) e o cirurgião tem exatamente 1 equipe (Fase 1), vincular ao cirurgião equivale a dar acesso àquela equipe — deixe isso explícito no rótulo ("Gerentes vinculados ao Cirurgião Principal desta equipe").
- Para **listar** os gerentes já vinculados a um cirurgião: se `getLinksForManager` só busca por gerente, adicionar um método `getManagersOfSurgeon(surgeonId)` que consulta `team_manager_surgeons` por `surgeon_id` + `is_active` com join no `profiles` do gerente. As RPCs `admin_link/unlink_team_manager` já validam papéis e `is_admin()` no banco — não reimplementar validação no TS.
- Combobox de gerentes disponíveis: novo método (ex.: `profileService.getTeamManagers()` → `listByRole('TEAM_MANAGER')`, ativos), excluindo os já vinculados àquele cirurgião.

**Backend:** nenhuma migration nova esperada (RPCs já existem e já validam papéis + `is_admin()`). Se `admin_link_team_manager` **não** rejeitar chamador não-admin, aí sim corrija na migration `0033`/nova — **confirme lendo a definição** (`supabase/migrations/0030_team_manager_schema.sql` e/ou `0029`) antes.

**Aceite Fase 2:**
- Admin abre "Detalhes da Equipe", vincula um gerente ao cirurgião, e o gerente passa a ver a equipe em "Equipes Vinculadas" (Fase 4).
- Admin desvincula e o acesso do gerente àquela equipe some.
- Chamada direta à RPC por um não-admin é rejeitada (`FORBIDDEN`), provando enforcement no banco.

---

## FASE 3 — Cirurgião perde a aba "Cadastro de Pacientes"

**Estado atual (verificado):**
- `frontend/src/App.tsx` — rota `/patients/new` **já** restrita a `[Role.ADM, Role.MANAGER]` (linha ~70). ✅ Backend/rota OK.
- `frontend/src/components/RoleBasedSidebar.tsx` — **ainda** existe o item `{ to: '/patients/new', label: 'Cadastro de Pacientes' }` dentro do bloco `hasRole(Role.SURGEON)` (linha ~83). ❌ Precisa sair.

**Alvo:** remover **apenas** a entrada `/patients/new` do bloco `if (hasRole(Role.SURGEON))`. Não mexer nos blocos de `Role.ADM` (l.69) nem `Role.MANAGER` (l.99), que devem manter "Cadastro de Pacientes".

**Aceite Fase 3:**
- Cirurgião logado **não** vê "Cadastro de Pacientes" no menu.
- Se digitar `/patients/new` na URL, o `PermissionGuard` já o redireciona (comportamento atual) — confirmar mensagem/redirect claros.
- Admin e Gerente continuam com o item no menu e a tela funcional.

---

## FASE 4 — "Equipes Vinculadas" lista as equipes dos cirurgiões vinculados

**Causa raiz do bug (verificada):** `frontend/src/pages/ManagerTeamsPage.tsx` monta a lista com
`teamViewService.getMyMainTeams()`. Essa função faz:
```ts
.from('medical_teams').select('id').eq('main_surgeon_id', uid)  // uid = usuário logado
```
Para um Gerente, `uid` é o **próprio gerente**, que nunca é `main_surgeon_id` de equipe alguma → retorna `[]` → tela mostra "Nenhuma equipe vinculada" (é o print reportado). A RLS já **permite** o gerente ler essas equipes (`is_team_manager_of`), mas a query filtra pelo dono errado.

**Alvo:** criar em `teamViewService` um método específico do gerente, ex.:
```ts
/** Equipes dos cirurgiões vinculados ao gerente logado. */
async getManagerTeams(): Promise<TeamDetail[]> {
  // surgeon_id ativos do gerente logado
  const { data: links, error: e1 } = await supabase
    .from('team_manager_surgeons')
    .select('surgeon_id')
    .eq('is_active', true);          // RLS já limita ao gerente logado
  if (e1) throw new Error(e1.message);
  const surgeonIds = (links ?? []).map(l => l.surgeon_id);
  if (surgeonIds.length === 0) return [];
  const { data: teams, error: e2 } = await supabase
    .from('medical_teams')
    .select('id')
    .in('main_surgeon_id', surgeonIds)
    .order('team_number');
  if (e2) throw new Error(e2.message);
  const ids = (teams ?? []).map(t => t.id);
  return Promise.all(ids.map(id => this.getTeamDetail(id)));
}
```
> Alternativa mais enxuta: como a RLS `teams_select` já expõe ao gerente **exatamente** as equipes dos cirurgiões vinculados (via `is_team_manager_of`), um `select('id') from medical_teams` **sem filtro de dono** já retornaria só essas equipes. Escolha uma das duas e comente por que — **não** filtre por `main_surgeon_id = auth.uid()`.

**Trocar em `ManagerTeamsPage.tsx`:** usar `teamViewService.getManagerTeams()` no lugar de `getMyMainTeams()`. Manter `teamManagerService.getMyLinks()` para o subtítulo ("Cirurgiões sob sua gestão: …") e, de preferência, **agrupar as equipes por cirurgião** no `TeamDashboard` (ou exibir o nome do cirurgião em cada card), já que o gerente pode ter vários.

**Aceite Fase 4:**
- Gerente vinculado a 2 cirurgiões vê as equipes de ambos (uma por cirurgião, dado o limite da Fase 1), agrupadas/identificadas por cirurgião.
- Gerente sem vínculo vê o estado vazio atual ("Nenhuma equipe vinculada").
- Nenhuma equipe de cirurgião **não** vinculado aparece (validar também que a RLS bloqueia no banco).

---

## FASE 5 — Gerente só cadastra paciente em equipes vinculadas

### 5.1 Frontend — seletor de equipe no cadastro
**Arquivo:** `frontend/src/pages/PatientRegisterPage.tsx`.
**Alvo:** quando o usuário é `Role.MANAGER`, o seletor de equipe lista **só** as equipes retornadas por `teamViewService.getManagerTeams()` (Fase 4) — idealmente agrupadas por cirurgião ("Dra. Ana Souza — Equipe nº 01"). Admin continua vendo todas.

### 5.2 Backend — enforcement (o que impede burlar o front)
**Arquivos:** `supabase/functions/create-patient/index.ts` e a policy `patients_insert`.
**Alvo:** inserção de paciente exige `is_admin() OR is_team_manager_of(team_id)` — o Cirurgião **não** cadastra paciente.
- **Confirme o estado atual** da policy `patients_insert` (buscar em `supabase/migrations/*`): se ainda for `is_admin() OR is_main_surgeon_of(team_id)`, recriar via migration `0033`/nova:
```sql
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (public.is_admin() or public.is_team_manager_of(team_id));
```
- **Confirme** também a autorização dentro de `create-patient/index.ts`: deve aceitar `ADMIN` e `TEAM_MANAGER` vinculado à equipe do `team_id`, e **negar** `MEDICAL_SURGEON`. Se já estiver assim (a Fase 5 do prompt anterior pode ter feito), apenas valide e registre; se não, ajuste.

**Aceite Fase 5:**
- Gerente cadastra paciente numa equipe de cirurgião **vinculado** → sucesso.
- Gerente tenta cadastrar em equipe de cirurgião **não vinculado** (inclusive chamando a Edge Function/insert direto) → `403`/erro de RLS.
- Cirurgião chamando `create-patient` → `403`, mesmo sendo responsável pela equipe.
- Admin cadastra em qualquer equipe → sucesso.

---

## FASE 6 — Verificação final

**Banco (rodar como consulta, sem alterar dados):**
- [ ] `select main_surgeon_id, count(*) from medical_teams where status='ACTIVE' group by 1 having count(*) > 1;` → **0 linhas** (nenhum cirurgião com 2+ equipes).
- [ ] Tentar criar 2ª equipe para um cirurgião via `surgeon_create_team` e via insert admin → ambos falham `TEAM_LIMIT_REACHED`.
- [ ] `admin_link_team_manager` chamado por não-admin → `FORBIDDEN`.
- [ ] Inserir paciente como cirurgião (RPC/insert direto) → bloqueado por `patients_insert`.

**App (smoke por perfil):**
- [ ] **Admin:** vê "Gerenciar Equipes", cria 1 equipe por cirurgião, vincula/desvincula gerente no drawer, cadastra paciente.
- [ ] **Cirurgião:** **sem** "Cadastro de Pacientes" no menu; botão "Nova equipe" desabilitado se já tem 1; vê pacientes/alertas da sua equipe.
- [ ] **Gerente:** "Equipes Vinculadas" mostra as equipes dos cirurgiões vinculados; cadastra paciente só nessas equipes.
- [ ] **Associado / Suporte:** inalterados.

**Fluxo do paciente (não pode mudar):** link público, gate de CPF, envio de medição + foto, alertas — idênticos.

**Responsividade:** telas alteradas em 320/375/414/768/1024/1366/1440px, sem scroll horizontal, toque ≥44px, seguindo o padrão de `MyTeamPage.tsx`/`teams.tsx`.

**Build:** `npm run build` (shared + backend + frontend, o que a CI roda) sem erro de tipo.

---

## 7. O que NÃO fazer

- Não editar migrations aplicadas (`0001…0032`); tudo novo a partir de `0033`.
- Não mexer em `backend/`/Prisma nem nos mocks `lib/*-api.ts`.
- Não duplicar o de-para de papéis fora de `frontend/src/lib/roles.ts`.
- Não filtrar as equipes do gerente por `main_surgeon_id = auth.uid()` (é a causa do bug atual).
- Não remover as permissões de `is_admin`/`is_main_surgeon_of`/`is_team_member` das policies existentes — só ajustar o que a spec pede.
- Não deixar o limite (1 equipe / 10 associados) só no front — tem de estar no banco.
- Não rodar migration/deploy nem criar branch/commit/PR sem autorização.

## 8. Entregar antes de finalizar

Por fase: (a) arquivos novos/alterados, (b) descrição curta da mudança, (c) checklist de aceite preenchido, (d) comandos exatos de migration a rodar (sem executá-los), (e) testes feitos e resultado. **Pare e relate** se algum critério de aceite falhar.

### Decisões a confirmar com o dono antes de codar
- [ ] O vínculo é **Gerente↔Cirurgião** (o gerente enxerga a única equipe do cirurgião) — confirmar que não se deseja um vínculo direto Gerente↔Equipe.
- [ ] Já existem cirurgiões com 2+ equipes ativas hoje? Se sim, como consolidar antes de aplicar o teto de 1.
- [ ] Ao trocar o Cirurgião Principal de uma equipe (drawer do admin), o teto de 1 equipe deve valer para o novo cirurgião (bloquear se ele já tiver equipe)? (Recomendado: sim.)
