# Prompt de Implementação — Gerente de Equipe & Refatoração de Papéis/Equipes (VitalSync)

**Origem:** este documento reescreve o rascunho enviado, corrigindo nomes de tabelas/colunas/enums/arquivos contra o **estado real** do repositório (verificado em `supabase/migrations/0001…0028`, `frontend/src/**`, `packages/shared/**`). Onde o rascunho presumia algo que não existe, isso está marcado como **[CORRIGIDO]** com a explicação.
**Como usar:** especificação de implementação. Siga as fases em ordem, sem pular etapas. Cada item tem arquivos reais, estado atual comprovado, alvo, passos, critérios de aceite e teste.

---

## 0. Correções em relação ao rascunho original (leia antes de começar)

1. **Não existe tabela `patient_team`.** `patients.team_id` já é FK direta e obrigatória (`not null references medical_teams(id)`) — um paciente sempre pertence a exatamente uma equipe. Não há nada a "consertar" nesse vínculo; ele já funciona.
2. **`measurement_photos` não tem coluna `team_id`.** A tabela (migration `0014_measurement_photos.sql`) tem `id, patient_id, vital_record_id, photo_type, storage_path, file_name, mime_type, file_size, created_at`. A equipe é derivada via `patients.team_id`, e a policy de leitura do Storage (`patient_photos_read`) já faz esse join e já restringe por `is_team_member()`. **Não há bug documentado de foto vazando entre equipes** — o item 16 do rascunho parte de uma suposição não verificada. O que falta de fato é: o **Gerente de Equipe** (papel novo) não é "team member" nem "main surgeon", então as policies que usam `is_team_member()`/`is_main_surgeon_of()` **não vão liberar acesso a ele automaticamente** — isso é trabalho real (seção 8 abaixo), mas é "estender permissão para um papel novo", não "corrigir um vínculo quebrado".
3. **Papel "Cirurgião Principal" hoje é um valor do enum global `user_role`: `MAIN_SURGEON`** (não é algo calculado por equipe). Ele decide, ao mesmo tempo, (a) o tipo de médico e (b) quem pode ser `medical_teams.main_surgeon_id`. Não existe hoje nenhum caminho para o mesmo médico ser "responsável" numa equipe e "associado" em outra — a tela de adicionar associado (`getAssociatedDoctors()`) filtra estritamente `profiles.role = 'ASSOCIATED_DOCTOR'`, então um `MAIN_SURGEON` nunca aparece como opção de associado em lugar nenhum hoje. Os itens 9–14 do rascunho pedem exatamente para abrir essa possibilidade — isso é uma mudança real, mas **não exige criar duas tabelas de "tipo" e "papel"**: a forma mais segura, sem migração de dados, é **renomear o valor do enum** `MAIN_SURGEON` → `MEDICAL_SURGEON` (`ALTER TYPE ... RENAME VALUE`, suportado desde o Postgres 10, não move nenhuma linha) e então liberar a query de associados para incluir médicos desse tipo. Ver Fase 3.
4. **`medical_teams.main_surgeon_id` já é nullable no schema**, mas hoje nenhuma equipe fica sem responsável na prática porque: (a) `surgeon_create_team()` sempre grava o próprio cirurgião; (b) `create()` do Admin (`teamService.create`) exige `main_surgeon_id` no TypeScript; (c) o trigger `protect_team_main_surgeon` (`0028_surgeon_teams.sql`) bloqueia qualquer `UPDATE` que troque `main_surgeon_id` para quem não é admin; (d) o trigger `protect_main_surgeon_membership` impede remover o responsável via `team_members`. **O admin, porém, já consegue trocar `main_surgeon_id` livremente** hoje pela tela de Gerenciar Equipes (`frontend/src/pages/TeamsPage.tsx`, em torno da l.657, monta `patch.main_surgeon_id = surgeonId` e chama `updateTeam`). Ou seja: a ação "Substituir Cirurgião Principal" (item 9 do rascunho) **já existe tecnicamente**, só falta (i) blindar contra ficar `null` no meio do caminho e (ii) dar a ela uma UI/rota própria com confirmação e (opcionalmente) auditoria — não é construir do zero.
5. **`team_members.role_in_team` já é um enum (`role_in_team`) só com dois valores: `MAIN_SURGEON` e `ASSOCIATED_DOCTOR`** — e hoje nenhum código insere `MAIN_SURGEON` ali (o responsável vive só em `medical_teams.main_surgeon_id`; `team_members` guarda só associados). Isso é exatamente o achado **M-12** da auditoria de 28/06: a brecha existe no schema (nada impede tecnicamente um insert com `role_in_team='MAIN_SURGEON'`), mesmo que a UI não faça isso hoje. Fechar essa brecha com uma constraint é parte desta feature (Fase 4), não invenção.
6. **Convite (`professional_invites`) já carrega `team_id` + `role` e já vincula automaticamente** no aceite (`accept-invite/index.ts`, ~l.82-95): se `role='MAIN_SURGEON'`, seta `medical_teams.main_surgeon_id`; se `role='ASSOCIATED_DOCTOR'`, faz upsert em `team_members`. **Não existe tela de seleção manual de equipe pós-convite** — o item 6/15 do rascunho já está implementado para médicos. O que não existe é convite para **Gerente de Equipe** (ver por quê no item 7 abaixo).
7. **Tensão a resolver, não ignorar:** o rascunho pede, ao mesmo tempo, que (a) *só o Administrador* crie/vincule Gerente de Equipe (item 1) e (b) o fluxo de convite normal também ofereça "Gerente de Equipe" como tipo (item 18). A tabela `professional_invites` tem `team_id uuid` (uma equipe só) e `role text check (role in ('MAIN_SURGEON','ASSOCIATED_DOCTOR'))` — não cabe naturalmente um Gerente vinculado a **vários** cirurgiões. **Decisão adotada nesta especificação:** Gerente de Equipe **não** passa pelo convite público (`professional_invites`/`accept-invite`); é criado e vinculado só pelo Admin, via Edge Function dedicada (mesma família de `admin-create-user`, que já existe e já usa `auth.admin.createUser` corretamente). Isso cumpre o item 1 à risca e evita reformar a tabela de convites para um caso que não se encaixa nela.
8. **Notificação ao adicionar membro (item 17) não existe hoje.** Existe `notify_team_of_alert(p_alert uuid)` (`0018_homologation.sql`), que grava linhas em `notification_logs` para o responsável + associados ativos de uma equipe, a partir de um `clinical_alerts.id`. É um bom modelo a copiar, mas **precisa de uma função nova** (não reaproveitar a mesma, que espera um alerta clínico existente) — ver Fase 6.
9. **Numeração de migration:** a última aplicada é `0028_surgeon_teams.sql`. As novas migrations desta feature começam em **`0029`**.

---

## 1. Regras invioláveis (guardrails)

1. **Mudanças cirúrgicas.** Implemente exatamente o descrito. Se encontrar algo a mais (ex.: outro lugar que reimplementa o de-para de papéis), **registre e pergunte**, não conserte por conta própria.
2. **Migrations só por adição, idempotentes.** Nunca edite uma migration já aplicada (`0001`…`0028`). Toda mudança de schema é uma **nova** migration numerada sequencialmente a partir de `0029`. Use `if not exists`, `create or replace`, `do $$ … exception when … $$`. Não apague dados.
3. **Não rode migration/seed/deploy** nem `supabase db push` sem autorização explícita. Entregue os `.sql` e diga o comando; quem roda é o dono do projeto.
4. **Renomear enum, não duplicar coluna.** Para separar "tipo de médico" de "papel na equipe" (item 10-13 do pedido original), use `ALTER TYPE public.user_role RENAME VALUE 'MAIN_SURGEON' TO 'MEDICAL_SURGEON'` (ver Fase 3.1). Não crie uma segunda tabela de "tipo profissional" nem duplique `profiles.role`.
5. **Toda checagem de permissão vale nos dois lados.** UI esconde; **RLS/RPC/Edge Function decide** de verdade. Nenhum item desta spec é "só front".
6. **Não afrouxe RLS existente.** Ao adicionar `is_team_manager_of()`, faça `OR` com as condições já existentes — nunca substitua uma condição de admin/cirurgião/associado por engano.
7. **PT-BR** nas mensagens ao usuário, no tom já usado no projeto (ex.: mensagens de `translateError` em `teamService.ts`).
8. **Git:** uma branch por fase (ex.: `feat/team-manager-role`). Sem commit/push/PR sem autorização.
9. **Verificação obrigatória ao final de cada fase** (build + teste manual descrito). Se falhar, **pare e relate**.
10. **Não quebrar o que já funciona:** login, convite de médico existente (`MAIN_SURGEON`/`ASSOCIATED_DOCTOR`), envio de medição/foto do paciente, alertas e notificação de alerta clínico devem continuar idênticos depois desta feature.

---

## 2. Ordem de execução

| Fase | Conteúdo | Depende de |
|---|---|---|
| 1 | Novo papel `TEAM_MANAGER` (enum + tabela de vínculo `team_manager_surgeons`) | — |
| 2 | Helpers de RLS (`is_team_manager_of`, `get_surgeons_of_manager`) + policies base | Fase 1 |
| 3 | Renomear `MAIN_SURGEON`→`MEDICAL_SURGEON` e liberar seleção de associados (item 7/9/11 do pedido) | Fase 1 |
| 4 | Fechar brechas: equipe sempre com 1 responsável, nunca 2 (M-11/M-12) + ação "Substituir Cirurgião Principal" | Fase 3 |
| 5 | Cadastro de paciente muda de dono: sai do Cirurgião, entra Gerente + Admin | Fases 1-2 |
| 6 | Notificação ao adicionar membro na equipe | Fases 1-2 |
| 7 | Fotos do paciente — liberar leitura para o Gerente vinculado | Fase 2 |
| 8 | Frontend: rotas, menus, telas do Gerente, seletor de médicos melhorado | Fases 1-6 |
| 9 | Dashboard por perfil | Fases 1, 5 |
| 10 | Criação/edição do Gerente pelo Admin (Edge Function dedicada) | Fase 1 |

---

## FASE 1 — Papel `TEAM_MANAGER` e vínculo com cirurgiões

### 1.1 Enum de papel
**Arquivo:** nova migration `0029_team_manager.sql`.
**Estado atual:** `create type public.user_role as enum ('ADMIN','MAIN_SURGEON','ASSOCIATED_DOCTOR')` (`0001_init.sql` l.24-26) + `alter type ... add value 'SUPPORT'` (`0015_support_role_enum.sql`).
**Passo:**
```sql
alter type public.user_role add value if not exists 'TEAM_MANAGER';
```
> Nota Postgres: `ALTER TYPE ... ADD VALUE` não pode rodar dentro do mesmo bloco de transação que depois **usa** o novo valor. Se o restante da migration referenciar `'TEAM_MANAGER'` em DML/DDL, rode este `ALTER TYPE` como statement isolado (primeiro arquivo/primeiro `COMMIT`) antes do resto.

### 1.2 Vocabulário do frontend
**Arquivos:** `packages/shared/src/types.ts` (`Role`), `frontend/src/lib/roles.ts` (`DB_ROLE_TO_APP_ROLE`, `APP_ROLE_LABEL_PT`), `frontend/src/auth/AuthContext.tsx` (usa `dbRoleToAppRole`).
**Passos:**
- `Role.MANAGER = 'MANAGER'` em `packages/shared/src/types.ts`.
- `DB_ROLE_TO_APP_ROLE.TEAM_MANAGER = Role.MANAGER` em `roles.ts`.
- `APP_ROLE_LABEL_PT[Role.MANAGER] = 'Gerente de Equipe'` em `roles.ts`.
- **Não** crie um quinto de-para paralelo — use só este arquivo central (já é a fonte única desde a última limpeza; não reintroduza o problema **D-04** da auditoria).

### 1.3 Tabela de vínculo `team_manager_surgeons`
**Arquivo:** mesma migration `0029`.
```sql
create table if not exists public.team_manager_surgeons (
  id              uuid primary key default gen_random_uuid(),
  team_manager_id uuid not null references public.profiles(id) on delete cascade,
  surgeon_id      uuid not null references public.profiles(id) on delete cascade,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Só um vínculo ATIVO por par (gerente, cirurgião) — evita duplicidade.
create unique index if not exists team_manager_surgeons_active_uk
  on public.team_manager_surgeons (team_manager_id, surgeon_id)
  where is_active;
```
**Validações a fazer via trigger `before insert or update`** (não confiar só no frontend):
- `team_manager_id` deve referenciar um `profiles.role = 'TEAM_MANAGER'`.
- `surgeon_id` deve referenciar um `profiles.role = 'MEDICAL_SURGEON'` (após Fase 3; até lá, `'MAIN_SURGEON'`) com `status = 'ACTIVE'`.
- Mensagens de erro padronizadas: `INVALID_MANAGER_ROLE`, `INVALID_SURGEON_ROLE` (seguir o padrão de `translateError` em `teamService.ts`).

**Critérios de aceite:**
- `insert` com `team_manager_id` de um perfil `ADMIN` falha com `INVALID_MANAGER_ROLE`.
- Dois inserts ativos para o mesmo par (gerente, cirurgião) → o segundo falha por índice único.
- Um Gerente sem nenhum vínculo ativo → função `get_surgeons_of_manager` (Fase 2) retorna vazio, e a UI mostra estado vazio (não erro).

---

## FASE 2 — Helpers de RLS para o Gerente de Equipe

### 2.1 Funções SQL
**Arquivo:** migration `0029` (mesma da Fase 1) ou `0030`, à escolha, mas **antes** de qualquer policy que as use.
```sql
-- Cirurgiões (surgeon_id) vinculados ativamente a um gerente.
create or replace function public.get_surgeons_of_manager(p_manager uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select surgeon_id from public.team_manager_surgeons
  where team_manager_id = p_manager and is_active;
$$;

-- O usuário logado é gerente vinculado ao responsável da equipe p_team?
create or replace function public.is_team_manager_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.medical_teams t
    join public.team_manager_surgeons tms
      on tms.surgeon_id = t.main_surgeon_id and tms.is_active
    where t.id = p_team and tms.team_manager_id = auth.uid()
  );
$$;

create or replace function public.is_team_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'TEAM_MANAGER');
$$;
```
Estas espelham o padrão já usado por `is_team_member(p_team)` e `is_main_surgeon_of(p_team)` (`0001_init.sql` l.179-192) e por `is_support()` — **reaproveite o mesmo estilo**, não invente uma abordagem diferente.

### 2.2 Policies a estender (OR, nunca substituir)
Para cada tabela abaixo, adicione `or public.is_team_manager_of(team_id)` (ou o caminho equivalente via `patients.team_id`) na condição de leitura já existente — **sem remover** as condições de admin/cirurgião/associado:

| Tabela | Policy atual (não remover a condição) | O que adicionar |
|---|---|---|
| `medical_teams` | leitura já ampla o suficiente para membros (`is_team_member`) | `is_team_manager_of(id)` para SELECT |
| `team_members` | `members_select` (`is_admin() or is_team_member(team_id)`) | `or is_team_manager_of(team_id)` |
| `patients` | `patients_select` (`is_admin() or is_team_member(team_id)`) | `or is_team_manager_of(team_id)` |
| `patients` (INSERT) | `patients_insert` (`is_admin() or is_main_surgeon_of(team_id)`) | ver Fase 5 — aqui a condição **muda**, não só soma |
| `clinical_alerts` | `alerts_select` (`0001_init.sql` l.292-294: `is_admin() or is_team_member(team_id)`) | `or is_team_manager_of(team_id)`, **se** o gerente deve ver alertas (item 3 do pedido diz "se permitido" — decidir com o dono antes de liberar; default seguro: manter fechado até confirmação) |
| Storage `patient-photos` (`patient_photos_read`) | `is_admin() or is_team_member(team_id via patients)` | `or is_team_manager_of(team_id via patients)` — ver Fase 7 para o SQL exato |

**Critério de aceite da fase:** um usuário `TEAM_MANAGER` sem vínculo algum não lê nada além do próprio perfil; um `TEAM_MANAGER` vinculado ao cirurgião responsável de uma equipe passa a ler `medical_teams`, `team_members` e `patients` daquela equipe, mas **nenhuma outra**.

---

## FASE 3 — Separar tipo médico do papel na equipe (itens 7, 9-14 do pedido)

### 3.1 Renomear o valor do enum
**Arquivo:** migration `0029`/`0030`.
```sql
alter type public.user_role rename value 'MAIN_SURGEON' to 'MEDICAL_SURGEON';
```
Isso **não move nenhuma linha** — todo profile que já era `MAIN_SURGEON` passa a se chamar `MEDICAL_SURGEON` automaticamente (é o mesmo valor interno do enum, só o rótulo textual muda). Precisa então atualizar todo lugar que compara com a string literal `'MAIN_SURGEON'` a nível de **profiles.role** (não confundir com `team_members.role_in_team`, que continua tendo `MAIN_SURGEON` como valor válido — são enums diferentes, `user_role` × `role_in_team`; não renomeie o segundo).

**Buscar e ajustar** (grep por `'MAIN_SURGEON'` fora de `role_in_team`/`team_members`):
- `frontend/src/lib/roles.ts` (`DB_ROLE_TO_APP_ROLE.MAIN_SURGEON` → `.MEDICAL_SURGEON`; mantenha `Role.SURGEON` como chave do frontend para não quebrar toda a árvore de componentes — só o rótulo `APP_ROLE_LABEL_PT[Role.SURGEON]` deveria, a rigor, mudar de "Cirurgião Principal" para algo como "Médico Cirurgião" quando referido fora do contexto de uma equipe específica; avalie com o dono se isso quebra textos existentes antes de mudar o rótulo).
- `supabase/migrations/0028_surgeon_teams.sql` — **não edite a migration aplicada**; a nova migration (`0029`/`0030`) recria as funções/policies que comparam `role = 'MAIN_SURGEON'` (ex.: `surgeon_create_team()`) com `create or replace function` usando `'MEDICAL_SURGEON'`.
- `supabase/migrations/0017_professional_invites.sql` — `check (role in ('MAIN_SURGEON','ASSOCIATED_DOCTOR'))`: este `role` é o papel do **convite** (equivalente a `role_in_team`), então **mantenha** os valores como estão (não é `profiles.role`). Confirme isso lendo a coluna antes de mexer.
- `profileService.getMainSurgeons()` (`listByRole('MAIN_SURGEON')`) → `listByRole('MEDICAL_SURGEON')`.
- Qualquer outro grep de `'MAIN_SURGEON'` que compare contra `profiles.role` (não contra `team_members.role_in_team` nem `professional_invites.role`, que são conceitos diferentes e ficam como estão).

### 3.2 Liberar seleção de associados para incluir Médico Cirurgião
**Arquivo:** `frontend/src/services/teamService.ts` (`getAvailableAssociatedDoctors`) e `profileService.ts` (`getAssociatedDoctors`).
**Estado atual:** `getAssociatedDoctors()` faz `listByRole('ASSOCIATED_DOCTOR')` — só retorna quem já é `ASSOCIATED_DOCTOR` globalmente. Um `MEDICAL_SURGEON` nunca aparece nessa lista.
**Alvo:** nova função `getEligibleAssociates(teamId: string)` que:
- busca `profiles` com `role in ('ASSOCIATED_DOCTOR','MEDICAL_SURGEON')` e `status='ACTIVE'`;
- exclui quem já é `main_surgeon_id` **daquela** equipe (ele já é o principal ali, não faz sentido virar associado da própria equipe);
- exclui quem já está em `team_members` daquela equipe (evita duplicidade — já existe hoje via `available.filter(a => !memberIds.has(a.id))` em `MyTeamPage.tsx` l.140-142, mantenha essa parte).
**Uso:** substitua a chamada a `getAvailableAssociatedDoctors()` em `MyTeamPage.tsx` (linha ~117/142) por `getEligibleAssociates(team.summary.id)`.
**Critério de aceite:** um médico `MEDICAL_SURGEON` que é responsável pela Equipe A aparece na lista de "adicionar associado" da Equipe B (onde não é responsável), mas **não** aparece na lista de associados da própria Equipe A.

### 3.3 Backend valida o mesmo
**Arquivo:** policy `members_admin` (`0001_init.sql` l.265-268) já usa `is_main_surgeon_of(team_id)` para permitir insert em `team_members` — isso não muda. O que precisa de trigger novo é impedir que um `ASSOCIATED_DOCTOR` (papel global, item 12 do pedido) seja inserido como responsável em qualquer lugar — ver Fase 4.2.

---

## FASE 4 — Equipe sempre com exatamente 1 Cirurgião Principal (M-11/M-12)

### 4.1 Nunca sem responsável / nunca dois responsáveis
**Já garantido estruturalmente:** `medical_teams.main_surgeon_id` é uma **coluna única** (não uma linha em `team_members`), então tecnicamente já é impossível ter "dois" responsáveis na mesma equipe — só pode haver um valor na coluna. O que falta:
- **Nunca ficar `null`:** hoje é nullable e só protegido por trigger contra troca por não-admin. Adicione validação explícita na Edge Function/RPC de troca (Fase 4.3) que rejeite `new_surgeon_id is null`. Avalie com o dono se vale adicionar `not null` na coluna via `alter table ... alter column main_surgeon_id set not null` — **só faça isso depois de confirmar que não há linha existente com `main_surgeon_id is null`** (`select count(*) from medical_teams where main_surgeon_id is null`), pois isso quebraria a migration se houver dado legado.

### 4.2 Fechar a brecha do `team_members.role_in_team = 'MAIN_SURGEON'` (M-12)
**Arquivo:** migration `0029`/`0030`.
```sql
alter table public.team_members
  add constraint team_members_role_associate_only
  check (role_in_team = 'ASSOCIATED_DOCTOR');
```
> Antes de aplicar, rode `select count(*) from team_members where role_in_team <> 'ASSOCIATED_DOCTOR';` — precisa retornar `0`. Se houver alguma linha legada com `MAIN_SURGEON`, decida com o dono se apaga (dado morto) ou preserva antes de travar a constraint.
**Critério de aceite:** `insert into team_members (..., role_in_team) values (..., 'MAIN_SURGEON')` falha com violação de `check`.

### 4.3 Ação "Substituir Cirurgião Principal"
**Arquivo:** nova RPC `admin_replace_main_surgeon(p_team uuid, p_new_surgeon uuid)`.
**Estado atual:** o Admin já troca `main_surgeon_id` por um `update` direto via `teamService.updateTeam` (`TeamsPage.tsx` ~l.657) — funciona, mas sem validação de "novo responsável precisa ser `MEDICAL_SURGEON` ativo" nem registro de auditoria.
**Passos:**
```sql
create or replace function public.admin_replace_main_surgeon(p_team uuid, p_new_surgeon uuid)
returns public.medical_teams
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role; v_team public.medical_teams;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_new_surgeon is null then raise exception 'SURGEON_REQUIRED'; end if;
  select role into v_role from public.profiles where id = p_new_surgeon and status = 'ACTIVE';
  if v_role is distinct from 'MEDICAL_SURGEON' then raise exception 'INVALID_SURGEON_ROLE'; end if;

  update public.medical_teams set main_surgeon_id = p_new_surgeon
  where id = p_team returning * into v_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Se o novo responsável já era associado nesta equipe, remove a duplicidade.
  delete from public.team_members where team_id = p_team and doctor_id = p_new_surgeon;

  -- Auditoria, se a tabela existir no projeto (ver supabase/functions/*/audit ou
  -- infra/audit no backend/); caso não exista auditoria genérica, registre ao menos
  -- um log em notification_logs ou equivalente, e sinalize ao dono a ausência.
  return v_team;
end;
$$;
grant execute on function public.admin_replace_main_surgeon(uuid, uuid) to authenticated;
```
Substitua, no frontend, a troca livre de `main_surgeon_id` (dentro de `TeamsPage.tsx`) por uma chamada a essa RPC com um passo de confirmação explícito ("Substituir Cirurgião Principal da Equipe nº X?").
**Teste:** tentar `p_new_surgeon` de um `ASSOCIATED_DOCTOR` → falha `INVALID_SURGEON_ROLE`; trocar com sucesso → equipe nunca aparece sem responsável em nenhum instante (mesma transação).

---

## FASE 5 — Cadastro de paciente muda de dono

### 5.1 Backend
**Arquivos:** `supabase/functions/create-patient/index.ts` (autorização atual em l.37-53) e policy `patients_insert` (`0001_init.sql` l.273-275, hoje `is_admin() or is_main_surgeon_of(team_id)`).
**Alvo:** `is_admin() or is_team_manager_of(team_id)` — **remove** `is_main_surgeon_of(team_id)` desta policy e desta Edge Function.
```sql
drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients for insert to authenticated
  with check (public.is_admin() or public.is_team_manager_of(team_id));
```
Na Edge Function, troque o bloco:
```typescript
let allowed = role === 'ADMIN';
if (!allowed && role === 'TEAM_MANAGER') {
  const { data: managed } = await admin.rpc('is_team_manager_of_team', { p_team: teamId }); // ou reescreva a checagem inline com team_manager_surgeons + medical_teams
  allowed = !!managed;
}
```
> Se preferir não expor a função `is_team_manager_of` (que usa `auth.uid()`) para chamada via `service_role` na Edge Function, reescreva a checagem inline consultando `team_manager_surgeons` + `medical_teams.main_surgeon_id` com o `caller.id`, no mesmo espírito do bloco atual.
**Critério de aceite:** uma chamada de um `MEDICAL_SURGEON` (ex-`MAIN_SURGEON`) para `create-patient` passa a devolver `403`, mesmo sendo responsável pela equipe.

### 5.2 Frontend
**Arquivos:** `frontend/src/App.tsx` (rota `/patients/new`, hoje `roles={[Role.ADM, Role.SURGEON]}`), `RoleBasedSidebar.tsx` (item "Cadastro de Pacientes" no menu do Cirurgião, l.83).
**Passos:**
- Rota `/patients/new`: `roles={[Role.ADM, Role.MANAGER]}`.
- `RoleBasedSidebar.tsx`: remover a entrada `{ to: '/patients/new', ... }` do bloco `hasRole(Role.SURGEON)` (l.79-92); adicionar um bloco novo `hasRole(Role.MANAGER)` com `Cadastro de Pacientes`, `Pacientes` (`/monitoring`), `Equipes vinculadas` (nova rota, Fase 8), `Dashboard`, `Meu Perfil`.
- `PermissionGuard` já redireciona quem tenta acessar uma rota sem o papel exigido (mesmo padrão hoje usado para o Suporte em `/dashboard`) — confirme que a mensagem exibida é clara; se `PermissionGuard` hoje só redireciona sem toast, adicione o texto pedido ("Você não tem permissão para cadastrar pacientes...") no destino do redirect, seguindo o padrão de mensagens já usado no projeto (`translateError`, `EmptyState`).
**Critério de aceite:** um Cirurgião logado não vê mais "Cadastro de Pacientes" no menu e, ao digitar `/patients/new` na URL, é redirecionado com mensagem — sem quebrar as demais rotas dele (`/monitoring`, `/alerts`, `/my-team` continuam iguais).

### 5.3 Formulário do Gerente
**Arquivo:** `frontend/src/pages/PatientRegisterPage.tsx`.
**Alvo:** quando o usuário logado é `Role.MANAGER`, o seletor de equipe deve listar **só** equipes cujo `main_surgeon_id` esteja em `get_surgeons_of_manager(auth.uid())`, agrupadas por cirurgião (ex.: "Dr. João — Equipe nº 01"). Implemente via nova função `teamManagerService.getTeamsForManager()` que chama uma RPC `get_teams_for_manager()` (retorna `medical_teams` cujo `main_surgeon_id in (select get_surgeons_of_manager(auth.uid()))`), e não uma listagem geral filtrada só no cliente (RLS de `medical_teams` já limitaria por `is_team_manager_of`, então a query direta ao Supabase já vem certa — não precisa de RPC extra se o `select * from medical_teams` já respeitar a policy da Fase 2).

---

## FASE 6 — Notificação ao adicionar médico à equipe

**Arquivo:** migration `0029`/`0030`. Modelo a seguir: `notify_team_of_alert` (`0018_homologation.sql` l.182+), mas para um evento diferente (entrada de membro, não alerta clínico).
```sql
create or replace function public.notify_team_membership_added(p_team uuid, p_doctor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team public.medical_teams;
  v_doctor public.profiles;
  r record;
begin
  select * into v_team from public.medical_teams where id = p_team;
  select * into v_doctor from public.profiles where id = p_doctor;
  if v_team is null or v_doctor is null then return; end if;

  -- Destinatários: o próprio médico adicionado + o responsável da equipe +
  -- gerente(s) vinculados ao responsável.
  for r in
    select id, name, whatsapp from public.profiles where id = p_doctor
    union
    select prof.id, prof.name, prof.whatsapp
      from public.profiles prof where prof.id = v_team.main_surgeon_id
    union
    select prof.id, prof.name, prof.whatsapp
      from public.team_manager_surgeons tms
      join public.profiles prof on prof.id = tms.team_manager_id
      where tms.surgeon_id = v_team.main_surgeon_id and tms.is_active
  loop
    insert into public.notification_logs
      (patient_id, alert_id, recipient_profile_id, recipient_name, recipient_phone,
       channel, status, message, template_name, environment, is_test, error_message, sent_at)
    values
      (null, null, r.id, r.name, r.whatsapp, 'internal', 'PENDING',
       case
         when r.id = p_doctor then format('Você foi adicionado à Equipe nº %s.', v_team.team_number)
         when r.id = v_team.main_surgeon_id then format('%s foi adicionado à sua equipe.', v_doctor.name)
         else 'Um médico foi adicionado a uma equipe sob sua gestão.'
       end,
       'membro_adicionado_equipe', 'production', false, null, null);
  end loop;
end;
$$;
```
> **Atenção:** `notification_logs.patient_id` e `.alert_id` são hoje `not null`? Confira o schema exato (`0008_alerts.sql`/`0018_homologation.sql`) antes de inserir `null` — se forem obrigatórios, ou (a) torne-os nullable nesta migration (`alter column ... drop not null`, com cuidado de não quebrar queries que assumem not-null), ou (b) crie uma tabela separada `team_notifications` para este tipo de evento em vez de forçar no `notification_logs` de alertas clínicos. **Decida isso olhando o schema real antes de aplicar** — não presuma.
**Disparo:** trigger `after insert on team_members` (quando `role_in_team='ASSOCIATED_DOCTOR' and status='ACTIVE'`) chamando `notify_team_membership_added(NEW.team_id, NEW.doctor_id)`.
**Critério de aceite:** adicionar um associado gera 2-3 linhas novas (médico, responsável, gerente se houver) com `template_name='membro_adicionado_equipe'`; não quebra a criação de time nem o fluxo de alerta clínico existente.

---

## FASE 7 — Fotos do paciente: liberar leitura para o Gerente

**Arquivo:** migration `0029`/`0030`, ajuste da policy `patient_photos_read` (`0014_measurement_photos.sql` l.118-129).
**Estado atual (real, não o presumido no rascunho):**
```sql
create policy patient_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-photos'
    and (
      public.is_admin()
      or public.is_team_member(
        (select p.team_id from public.patients p
          where p.id = nullif((storage.foldername(name))[1], '')::uuid)
      )
    )
  );
```
**Alvo:**
```sql
drop policy if exists patient_photos_read on storage.objects;
create policy patient_photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-photos'
    and (
      public.is_admin()
      or public.is_team_member(
        (select p.team_id from public.patients p
          where p.id = nullif((storage.foldername(name))[1], '')::uuid)
      )
      or public.is_team_manager_of(
        (select p.team_id from public.patients p
          where p.id = nullif((storage.foldername(name))[1], '')::uuid)
      )
    )
  );
```
Não crie coluna `team_id` em `measurement_photos` (desnecessário — o caminho de Storage já é `{patientId}/...` e o join por `patients.team_id` já funciona hoje). Se for necessário também expor a **listagem** (`measurement_photos` como tabela, não só o Storage) para o Gerente, replique a mesma lógica na policy de SELECT dessa tabela (verifique se ela tem policy própria ou se depende de RLS de `vital_sign_records`/`patients` antes de escrever a nova policy).
**Critério de aceite:** um Gerente vinculado ao cirurgião responsável consegue abrir a foto do curativo/dreno de um paciente da equipe; um Gerente **sem** vínculo com aquele cirurgião recebe falha de RLS ao tentar gerar/usar a signed URL.

---

## FASE 8 — Frontend: telas do Gerente e seletor de médicos melhorado

### 8.1 Componentes/páginas novas
Seguindo os nomes já sugeridos (compatíveis com o padrão de nomenclatura do projeto, ex.: `MyTeamPage`, `MyTeamsPage`):
- `TeamManagerDashboardPage` (ou reaproveitar `DashboardPage` com um branch de dados — decidir olhando o tamanho de `dashboardService.ts` antes de criar arquivo novo).
- `TeamManagerTeamsPage` (lista as equipes dos cirurgiões vinculados — somente leitura de equipe, ação de cadastrar paciente).
- Reaproveitar `PatientRegisterPage` (Fase 5.3) em vez de criar `TeamManagerPatientCreatePage` — o formulário é o mesmo, só muda a fonte da lista de equipes.
- `TeamDoctorSelector` (combobox com busca por nome/e-mail/CRM/WhatsApp + filtro por tipo, ver 8.2) substituindo o `ProfessionalCombobox` simples hoje usado em `MyTeamPage.tsx` l.261-267.

### 8.2 Seletor de Médico Associado — filtro corrigido
**Arquivo:** `frontend/src/components/teams.tsx` / `MyTeamPage.tsx` (`ManageTeamDrawer`).
**Hoje:** `available = associates.filter(a => !memberIds.has(a.id))`, onde `associates` vem de `getAvailableAssociatedDoctors()` (só `role='ASSOCIATED_DOCTOR'`).
**Alvo (após Fase 3.2):** usar `getEligibleAssociates(teamId)`, que já teria os filtros certos (tipo médico, ativo, não é o principal da equipe, não já membro). Adicionar na UI:
- campo de busca (nome, e-mail, CRM, WhatsApp — `professional_tag` também, já usado no `ProfessionalCombobox`);
- filtro por tipo: Médico Cirurgião / Médico Associado / Todos (client-side sobre a lista já filtrada no backend);
- badge indicando o tipo de cada card (usa `APP_ROLE_LABEL_PT` da Fase 1.2, não crie um label novo);
- contador "Médicos associados: N/10" (já existe, `teamAssociates.length}/{TEAM_LIMITS.maxAssociatedDoctorsPerTeam}` em `MyTeamPage.tsx` l.226 — mantenha).
**Não listar** (reforçar no `getEligibleAssociates`, não só no componente): inativos, `ADMIN`, `TEAM_MANAGER`, `SUPPORT`, o `main_surgeon_id` da equipe atual, quem já é membro.

### 8.3 Menus (`RoleBasedSidebar.tsx`)
Adicionar bloco `hasRole(Role.MANAGER)`:
```
Dashboard, Cadastro de Pacientes, Pacientes em Monitoramento, Equipes vinculadas, Meu Perfil
```
Sem seção `admin` (vazio, igual ao padrão do Médico Associado/Suporte hoje).

---

## FASE 9 — Dashboard por perfil

**Arquivo:** `frontend/src/services/dashboardService.ts` (estrutura atual não detalhada aqui — leia o arquivo antes de estender; não recrie do zero).
**Adição:** branch para `Role.MANAGER` — escopo por `get_surgeons_of_manager(auth.uid())` → equipes desses cirurgiões → pacientes/alertas dessas equipes. Reaproveite o padrão de escopo já usado para `Role.SURGEON` hoje (que filtra por `is_main_surgeon_of`); troque só a fonte do conjunto de `team_id`s.
**Critério de aceite:** Admin continua vendo dados globais (nada muda para ele); Gerente vê só as equipes dos cirurgiões vinculados; Cirurgião (agora `MEDICAL_SURGEON`) continua vendo as equipes onde é responsável; se o mesmo médico for associado em outra equipe, essa equipe entra no escopo dele como associado (comportamento que já deveria existir, mas confirme testando, já que antes da Fase 3 isso nunca acontecia na prática).

---

## FASE 10 — Criação do Gerente pelo Admin

**Arquivo:** nova Edge Function `admin-create-team-manager` (ou estender `admin-create-user` já existente, que faz `auth.admin.createUser` corretamente — **prefira estender**, não duplicar lógica de criação de conta).
**Passos:**
- Validar `is_admin()` do chamador (JWT).
- Criar a conta via `auth.admin.createUser` (mesmo caminho já usado, evitando reintroduzir o problema **C-06** da auditoria — inserção manual em `auth.users` — que já foi corrigido para os demais perfis).
- Criar `profiles` com `role='TEAM_MANAGER'`.
- Opcionalmente, no mesmo payload, já inserir 1+ linhas em `team_manager_surgeons` (vínculo inicial) — ou deixar para uma tela separada "Vincular Gerente a Cirurgião" que chama uma RPC `admin_link_team_manager(p_manager uuid, p_surgeon uuid)` com a mesma validação de papéis da Fase 1.3.
**Critério de aceite:** Admin cria um Gerente, vincula a 2 cirurgiões, o Gerente loga e vê exatamente as equipes desses 2 cirurgiões — nada mais.

---

## 3. Validação final (após todas as fases autorizadas)

**Banco:**
- [ ] `select unnest(enum_range(null::public.user_role));` → inclui `TEAM_MANAGER` e `MEDICAL_SURGEON` (não mais `MAIN_SURGEON`).
- [ ] `select count(*) from team_members where role_in_team <> 'ASSOCIATED_DOCTOR';` → 0.
- [ ] `select count(*) from medical_teams where main_surgeon_id is null;` → 0.
- [ ] Nenhuma policy antiga foi removida sem substituição equivalente (`is_team_member`, `is_main_surgeon_of` continuam funcionando para quem já usava).

**App (smoke por perfil):** Admin, Gerente de Equipe, Médico Cirurgião (como responsável e como associado em outra equipe), Médico Associado, Suporte — login, menu correto, ações principais sem erro.

**Fluxo do paciente (não deve mudar):** link público, gate de CPF, envio de medição, foto de curativo/dreno — idêntico a antes da feature.

**Fotos:** Gerente vinculado vê foto de paciente da equipe do seu cirurgião; Gerente não vinculado não vê; comportamento de cirurgião/associado/admin permanece igual.

**Notificação:** adicionar médico a uma equipe gera linhas em `notification_logs` (ou tabela dedicada, conforme decisão da Fase 6) para os destinatários certos.

**Mobile (320/375/414/768/1024/1366/1440px):** telas novas/alteradas sem scroll lateral, botões ≥44px, tabelas viram cards — seguir o padrão já usado em `MyTeamPage.tsx`/`teams.tsx`.

**Build:** `npm run build` (shared + frontend) sem erros de tipo.

---

## 4. O que NÃO fazer

- Não criar tabela `patient_team` (não existe necessidade — `patients.team_id` já resolve).
- Não adicionar coluna `team_id` em `measurement_photos` (a derivação via `patients.team_id` já é usada e já funciona).
- Não duplicar o de-para de papéis fora de `frontend/src/lib/roles.ts` (não reintroduzir D-04).
- Não editar migrations já aplicadas (`0001`…`0028`); toda mudança é migration nova a partir de `0029`.
- Não fazer o Gerente de Equipe passar pelo fluxo público de `professional_invites`/`accept-invite` (não encaixa no modelo de convite atual — 1 convite = 1 equipe = 1 papel).
- Não remover a permissão de `is_main_surgeon_of`/`is_team_member` de nenhuma policy existente — só **adicionar** `is_team_manager_of` em paralelo.
- Não liberar leitura de alertas clínicos ao Gerente sem confirmação explícita do dono (o pedido original deixou isso como "se permitido").
- Não rodar migration/deploy sem autorização.

## 5. Entregáveis por fase

Para cada fase: (a) arquivos novos/alterados, (b) descrição curta da mudança, (c) checklist de aceite preenchido, (d) comandos exatos de migration a serem rodados pelo dono (sem executá-los), (e) testes realizados e resultado. **Pare e relate** se algum critério de aceite falhar.

### Checklist de decisões a confirmar com o dono antes de implementar
- [ ] Rótulo final de `Role.SURGEON` no frontend após a Fase 3 (mantém "Cirurgião Principal" só no contexto de uma equipe, ou muda o rótulo global para "Médico Cirurgião" em todo lugar?).
- [ ] Gerente de Equipe pode ver alertas clínicos das equipes vinculadas? (rascunho original deixou em aberto).
- [ ] `notification_logs.patient_id`/`.alert_id` aceitam `null`? Se não, criar tabela dedicada para notificação de vínculo de equipe em vez de forçar no schema de alertas.
- [ ] Vale tornar `medical_teams.main_surgeon_id` `NOT NULL` de fato (depende de não haver linha legada nula hoje).
