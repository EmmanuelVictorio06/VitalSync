# Prompt — Exibir o Gerente de Equipe nos Integrantes e dar-lhe acesso somente-leitura aos alertas

Copie e cole o bloco abaixo para implementar. Duas features independentes, mas relacionadas ao papel **`TEAM_MANAGER` / `Role.MANAGER`** (Gerente de Equipe).

---

## Contexto (arquitetura atual — respeitar)
- Banco de produção é **Supabase**. Trabalho novo em `supabase/migrations/` e `supabase/functions/` (+ serviços do frontend). **Não** tocar em `backend/` legado.
- Papel Gerente já existe: enum `user_role = 'TEAM_MANAGER'` (`0029`), schema em `0030_team_manager_schema.sql`. Vínculo Gerente↔Cirurgião na tabela `public.team_manager_surgeons` (gerente enxerga as equipes/pacientes do cirurgião ao qual está vinculado).
- De-para de papéis em `frontend/src/lib/roles.ts`: banco `TEAM_MANAGER` → app `Role.MANAGER` (rótulo PT-BR "Gerente de Equipe").
- O serviço `frontend/src/services/teamViewService.ts` já retorna `managers: TeamMemberView[]` (separado de `members`, com `isManager: true`), derivados de `team_manager_surgeons` via `main_surgeon_id` da equipe.
- Em `frontend/src/components/TeamDashboard.tsx`, o componente `DoctorRow` **já** trata `m.isManager` e mostra o rótulo "Gerente".
- Escrita em alertas/atendimentos só via RPCs `SECURITY DEFINER` (`alert_set_in_analysis`, `alert_mark_attended`, `alert_ignore`, `alert_update_observation`), gate por `is_team_member(team_id)` (ver `0024`). O gerente acessa por leitura via `is_team_manager_of(team_id)` (OR nas policies de SELECT em `0030`) — `is_team_member` **não** inclui gerente.
- Rota `/alerts` em `App.tsx` já inclui `Role.MANAGER` no `PermissionGuard`. `AlertsPage.tsx` decide as ações com `permissionService.canAttendAlerts(user)` (`canAttend`).

---

## Feature 1 — Mostrar o Gerente no card "Integrantes da Equipe"
**Objetivo:** tanto o **Cirurgião Responsável** quanto o **Médico Associado** devem ver o Gerente de Equipe listado no card "Integrantes da Equipe" (com o selo "Gerente"), do mesmo jeito que o modal completo já faz.

**Situação atual:** o **card de preview** de "Integrantes da Equipe" em `TeamDashboard.tsx` renderiza apenas `members` (cirurgião + associados) — os `managers` só aparecem no **modal** completo (que combina `[...members, ...managers]`). Por isso o gerente não aparece no card.

**Fazer:**
1. **Frontend (`TeamDashboard.tsx`):** incluir `detail.managers` na lista renderizada pelo card de preview de "Integrantes da Equipe" (ex.: renderizar `[...members, ...managers]`, mantendo o gerente **fora** da contagem "X associado(s)" / "médicos associados", que continua filtrando `!m.isSurgeon && !m.isManager`). Reaproveitar `DoctorRow` (já mostra "Gerente"). Ordenar sugerido: Responsável → Associados → Gerente.
2. **RLS (verificar/ajustar — provável ponto de bloqueio para o ASSOCIADO):** confirmar que um **Médico Associado** consegue ler, via RLS, tanto `team_manager_surgeons` quanto o `profiles` do gerente da sua equipe. Hoje `tms_own_select` (0030) só deixa o próprio gerente ler seus vínculos, e há `0037_surgeon_reads_managers` para o cirurgião — **o associado pode não conseguir**, resultando em `managers: []` para ele. Se for o caso, criar migration **`0038_...`** (próxima numeração livre; não repetir número) adicionando policy de SELECT que permita a **membros ativos da equipe** (`is_team_member(team do cirurgião)`) lerem o vínculo do gerente e o perfil do gerente (espelhar o padrão/escopo de `0036_manager_profiles_scope.sql` e `0037`). Manter aditivo/idempotente.
3. **Validar:** logar como cirurgião **e** como associado da mesma equipe e confirmar que o gerente aparece no card nos dois casos; conferir que a contagem de associados não muda.

## Feature 2 — Gerente vê alertas, mas **não** pode atender (somente-leitura)
**Objetivo:** o Gerente de Equipe, logado, vê a aba/tela de **Alertas** das equipes dos seus cirurgiões, mas **sem** poder atender/mudar status (não é médico). Ações de atendimento ficam **ocultas ou desabilitadas** para ele.

**Situação atual:** `/alerts` já permite `Role.MANAGER`. Falta garantir o modo somente-leitura na UI e reforçar no banco.

**Fazer:**
1. **Frontend — `permissionService.canAttendAlerts(user)`:** garantir que retorne **`false`** para `Role.MANAGER` (mantendo `true` para SURGEON/ASSOCIATE/ADM conforme já é). Como `AlertsPage` já usa `canAttend` para renderizar as ações, isso oculta/desabilita "Em análise", "Marcar como atendido", "Ignorar" e a edição de observação para o gerente. Conferir todos os pontos que usam `canAttend`/`perms.canAttend` para que nenhum botão de escrita apareça ao gerente. Opcional: exibir um aviso discreto ("Visualização somente-leitura") no cabeçalho da lista quando for gerente.
2. **Backend — defesa em profundidade (RLS/RPC):** garantir que as RPCs de escrita (`alert_set_in_analysis`, `alert_mark_attended`, `alert_ignore`, `alert_update_observation`) **rejeitem** explicitamente `TEAM_MANAGER`. Hoje elas usam `is_team_member(team_id)`, que **não** inclui gerente — então provavelmente já bloqueiam; ainda assim, adicionar no início de cada RPC um `if public.is_team_manager() then raise exception 'MANAGER_READ_ONLY'; end if;` (ou equivalente) na mesma migration `0038_...`, para que a proteção não dependa só da UI. **Não** adicionar `is_team_manager_of` a nenhuma policy/def de escrita — apenas leitura (SELECT) do gerente permanece.
3. **Validar:** logar como gerente e confirmar que a lista de alertas carrega (leitura) mas nenhum botão de atendimento aparece; tentar chamar uma RPC de atendimento manualmente (ex.: via `supabase.rpc`) e confirmar que o banco rejeita.

---

## Entregáveis
1. Alteração em `frontend/src/components/TeamDashboard.tsx` (card Integrantes inclui managers).
2. Ajuste em `permissionService.canAttendAlerts` (false para MANAGER) e conferência dos usos de `canAttend` em `AlertsPage.tsx`.
3. Migration **`supabase/migrations/0038_gerente_integrantes_e_alertas_ro.sql`** (aditiva/idempotente): policy de SELECT para associado ler gerente (se necessário) + bloqueio explícito de `TEAM_MANAGER` nas RPCs de escrita de alertas.
4. Passos de validação executados para os três perfis (cirurgião, associado, gerente).

## Confirmar antes de codar
- O **Médico Associado** deve ver o gerente sempre, ou só quando houver gerente vinculado? (assumido: quando houver.)
- Ao gerente na aba de alertas: **ocultar** totalmente as ações de atendimento ou **desabilitá-las** (cinza, sem clique)? (sugestão: ocultar + aviso "somente-leitura".)
