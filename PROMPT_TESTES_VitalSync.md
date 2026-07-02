# Prompt de Testes — VitalSync/CURAPATH (regressão completa)

**Objetivo:** deixar o sistema **inteiro** validado — testes automatizados onde é barato e confiável (motor clínico, utilitários puros, regras de negócio críticas) + checklist manual de QA por perfil onde depende de UI/RLS/integração real com o Supabase.
**Como usar:** siga as fases em ordem. Cada uma tem estado atual comprovado, o que fazer, e critério de aceite. **Não pule etapas.**

---

## 0. Estado real do projeto (verificado agora, não presumido)

1. **Testes automatizados: zero hoje.** `frontend/package.json` já tem Vitest configurado (`"test": "vitest run"`, `"test:watch": "vitest"`, `vitest@^4.1.9`, `@vitest/ui`), mas **não existe nenhum arquivo `*.test.ts`/`*.test.tsx` em nenhum lugar do repositório** (frontend, `packages/shared`, `backend`). Não há `vitest.config.ts` próprio (usa defaults dentro de `vite.config.ts`), não há `@testing-library/*`, não há MSW, não há mock do cliente Supabase.
2. **CI não roda testes.** `.github/workflows/ci.yml` só faz `npm ci` + `npx prisma generate` + `npm run build` (tsc + vite). Não existe step de `npm test`. Isso é uma lacuna real a fechar (Fase C).
3. **O motor clínico (`packages/shared/src/clinical/thresholds.ts` + `status.ts`) é 100% puro** (sem I/O, sem framework) e está descoberto — é o candidato de maior valor/menor custo para testes automatizados, porque decide status GREEN/YELLOW/RED que vira alerta clínico real.
4. **A maior parte dos achados da auditoria de 28/06 (`AUDITORIA_VitalSync_2026-06-28.md`) já foi corrigida** em migrations posteriores (`0019`…`0032`) — inclusive a feature "Gerente de Equipe" (`0029`…`0032`) já está implementada no banco e no frontend (`Role.MANAGER`, `teamManagerService.ts`, rotas em `App.tsx`, menu em `RoleBasedSidebar.tsx`). Isso muda o que testar: em vez de "encontrar bugs conhecidos", o foco agora é **confirmar que as correções seguram** e cobrir a feature nova. Ver tabela abaixo.
5. **Itens que a verificação atual aponta como ainda abertos** (tratar como bugs conhecidos, não como "não verificado"):
   - **M-05** — `frontend/src/components/patient-measurement/validation.ts` ainda tem `INPUT_RANGES` local (ex.: SpO2 70–100, temperatura 34–42) **diferente** de `packages/shared/src/clinical/thresholds.ts` (SpO2 93–100, temperatura 34–43). O wizard valida com a faixa errada.
   - **M-10** — `supabase/functions/process-vital-record/index.ts` continua no repositório, não é chamada por ninguém, mas duplica (e diverge d)o cálculo de status. Risco latente se for religada por engano.
   - **M-17** — `PatientMeasurementWizard.tsx` faz upload da foto **antes** de chamar `submitByToken`; se a RPC falhar depois, a foto fica órfã no Storage.
   - **C-06 (residual)** — a Edge Function `admin-create-user`/RPC `admin_create_user` corrigida existe e é o caminho usado pela UI, mas as RPCs antigas de inserção manual (`0004_admin_create_doctor.sql`) não foram removidas do banco.
   Estes quatro **não são objeto de correção neste prompt** (é um prompt de testes, não de correção) — mas cada um vira um teste que hoje **deve falhar/alertar**, documentando o comportamento incorreto até que outra rodada corrija. Não finja que eles passam.
6. **Homologação já existe e deve ser usada para testar sem incomodar ninguém de verdade:** `docs/HOMOLOGACAO.md` — modo liga/desliga em **Configurações → Homologação**, whitelist de números WhatsApp, flag `is_test`, botão "Limpar dados de teste". **Todo teste manual de alerta/notificação deve rodar com homologação LIGADA** e o número de teste na whitelist (ou de propósito fora dela, para testar o bloqueio `SKIPPED_TEST_MODE`).
7. **Seed disponível:** `supabase/seed.sql` cria 3 contas (`admin@vitalsync.com`, `cirurgiao@vitalsync.com`, `medico@vitalsync.com`, senha `senha123`), 3 equipes, 4 pacientes com status GREEN/YELLOW/RED variados. **Não cria um usuário `TEAM_MANAGER`** — será preciso criar um manualmente via painel Admin para testar a feature nova (Fase F).

---

## 1. Guardrails

1. **Nunca teste contra o banco de produção.** Use Supabase local (`supabase start`, API em `54321`, DB em `54322`, conforme `supabase/config.toml`) ou um projeto de homologação dedicado.
2. **Homologação sempre ligada durante testes de alerta/WhatsApp.** Nunca teste com o modo desligado apontando para números reais.
3. **Não rode `supabase db push`/deploy contra produção** como parte deste prompt. Se precisar aplicar migrations para montar o ambiente de teste, é `supabase db reset` ou `db push` **no projeto local/homologação**, nunca no de produção.
4. **Teste automatizado não pode depender de rede/Supabase real.** Tudo que for de integração com o banco é teste **manual** (Fase D/E/F) ou, se for automatizar, precisa de um mock explícito do cliente (Fase B.4) — não vale "funciona na minha máquina porque bati no Supabase de verdade".
5. **Não marque um teste como "passou" se ele só cobre o caminho feliz.** Cada regra de negócio testada precisa de pelo menos um caso que **deveria falhar** (valor fora da faixa, papel sem permissão, equipe sem responsável).
6. **Relate falhas, não esconda.** Se M-05/M-10/M-17/C-06 (item 0.5) aparecerem como esperado, documente no relatório final — não vire uma correção não pedida (isso é escopo de outro prompt).
7. **PT-BR** nos nomes de `describe`/`it` e nas mensagens do checklist, no mesmo tom do projeto.

---

## 2. Ordem de execução

| Fase | Conteúdo |
|---|---|
| A | Preparar ambiente de teste (Supabase local + seed + homologação) |
| B | Testes automatizados do motor clínico e utilitários puros (Vitest) |
| C | Adicionar `npm test` ao CI |
| D | Checklist manual de QA por perfil (login, menus, permissões) |
| E | Checklist manual de fluxos críticos (paciente, alertas, fotos, equipes) |
| F | Checklist manual específico da feature "Gerente de Equipe" |
| G | Regressão dos itens ainda abertos (M-05, M-10, M-17, C-06 residual) |
| H | Mobile/responsividade |
| I | Relatório final e critério de "projeto totalmente funcional" |

---

## FASE A — Ambiente de teste

**Passos:**
1. `supabase start` (ou `npm run db:up` se for usar só o Postgres do backend legado — **não é o mesmo banco**; para testar o app real, use o Supabase local).
2. Aplicar todas as migrations: `supabase db reset` (roda `0001`…`0032` do zero) **ou** `supabase db push` se o projeto local já existir.
3. Rodar `supabase/seed.sql` (cria as 3 contas + equipes + pacientes de exemplo).
4. Criar manualmente, via painel **Gerenciar Usuários** (login como `admin@vitalsync.com`), pelo menos:
   - 1 conta `TEAM_MANAGER` ("Gerente de Equipe") — não vem no seed;
   - 1 conta `MEDICAL_SURGEON` extra (para testar "cirurgião responsável em uma equipe, associado em outra" — precisa de 2 cirurgiões existentes, o seed só tem 1 por equipe).
5. Ligar o modo de homologação (Admin → Configurações → Homologação) e colocar **um número de teste seu** na whitelist.
6. `cd frontend && npm run dev` (ou `npm run dev:frontend` na raiz) apontando para o Supabase local (`.env.local` com `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` do projeto local).

**Critério de aceite:** login funciona para as 3 contas do seed + as 2 novas criadas; `isSupabaseConfigured` não acusa erro de configuração.

---

## FASE B — Testes automatizados (Vitest)

Todos os arquivos ficam ao lado do código testado, sufixo `.test.ts`, seguindo a convenção já citada no `CLAUDE.md` (`components/attendances/utils.test.ts` é o único exemplo citado, mesmo não existindo ainda no repo — siga esse padrão de local).

### B.1 — `packages/shared/src/clinical/status.ts` (prioridade máxima)
**Arquivo novo:** `packages/shared/src/clinical/status.test.ts`.
Casos obrigatórios (valores exatos de `docs/PONTOS_PENDENTES.md`, que é a fonte já confirmada — não invente limiares):

```ts
import { describe, it, expect } from 'vitest';
import { evaluateRange, evaluateDiuresis, evaluateSteps, worstStatus, evaluateVitalSigns, shouldAlert } from './status';
import { ALERT_THRESHOLDS } from './thresholds';
import { ClinicalStatus, VitalKind } from '../types';

describe('evaluateRange — temperatura', () => {
  it('< 37.8 é GREEN', () => expect(evaluateRange(37.5, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.GREEN));
  it('37.8–38.4 é YELLOW', () => expect(evaluateRange(38.0, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.YELLOW));
  it('>= 38.5 é RED', () => expect(evaluateRange(38.5, ALERT_THRESHOLDS.temperature)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — SpO2', () => {
  it('> 94 é GREEN', () => expect(evaluateRange(96, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.GREEN));
  it('92.1–94 é YELLOW', () => expect(evaluateRange(93, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.YELLOW));
  it('<= 92 é RED', () => expect(evaluateRange(90, ALERT_THRESHOLDS.spo2)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — frequência cardíaca', () => {
  it('<= 110 é GREEN', () => expect(evaluateRange(100, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.GREEN));
  it('111–119 é YELLOW', () => expect(evaluateRange(115, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.YELLOW));
  it('>= 120 é RED', () => expect(evaluateRange(125, ALERT_THRESHOLDS.heartRate)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — dor (0-10)', () => {
  it('0-6 é GREEN', () => expect(evaluateRange(6, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.GREEN));
  it('7-8 é YELLOW', () => expect(evaluateRange(8, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.YELLOW));
  it('9-10 é RED', () => expect(evaluateRange(9, ALERT_THRESHOLDS.pain)).toBe(ClinicalStatus.RED));
});

describe('evaluateRange — dispneia (0-10)', () => {
  it('0 é GREEN', () => expect(evaluateRange(0, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.GREEN));
  it('1-5 é YELLOW', () => expect(evaluateRange(3, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.YELLOW));
  it('6-10 é RED', () => expect(evaluateRange(7, ALERT_THRESHOLDS.dyspnea)).toBe(ClinicalStatus.RED));
});

describe('evaluateDiuresis', () => {
  it('contagem >= 4 é GREEN', () => expect(evaluateDiuresis(true, 4)).toBe(ClinicalStatus.GREEN));
  it('contagem 2-3 é YELLOW', () => expect(evaluateDiuresis(true, 2)).toBe(ClinicalStatus.YELLOW));
  it('contagem < 2 é RED', () => expect(evaluateDiuresis(true, 1)).toBe(ClinicalStatus.RED));
  it('sem contagem, urinou normalmente = GREEN (M-01: não pode virar YELLOW)', () =>
    expect(evaluateDiuresis(true, null)).toBe(ClinicalStatus.GREEN));
  it('sem contagem, não urinou normalmente = YELLOW', () =>
    expect(evaluateDiuresis(false, null)).toBe(ClinicalStatus.YELLOW));
});

describe('evaluateSteps', () => {
  it('sem dia anterior é GREEN', () => expect(evaluateSteps(100, null)).toBe(ClinicalStatus.GREEN));
  it('redução >= 25% é YELLOW', () => expect(evaluateSteps(750, 1000)).toBe(ClinicalStatus.YELLOW));
  it('redução >= 50% é RED', () => expect(evaluateSteps(400, 1000)).toBe(ClinicalStatus.RED));
});

describe('worstStatus', () => {
  it('retorna o pior entre vários', () =>
    expect(worstStatus([ClinicalStatus.GREEN, ClinicalStatus.RED, ClinicalStatus.YELLOW])).toBe(ClinicalStatus.RED));
  it('lista vazia é GREEN', () => expect(worstStatus([])).toBe(ClinicalStatus.GREEN));
});

describe('evaluateVitalSigns — pressão arterial NUNCA decide o overall (M-06 pendente)', () => {
  it('PA em faixa "RED" do threshold provisório não eleva o overall se o resto for GREEN', () => {
    const result = evaluateVitalSigns({
      temperature: 36.5, spo2: 98, systolic: 130 /* cairia em RED no threshold provisório */,
      heartRate: 80, pain: 0, dyspnea: 0, urinatedNormally: true, urinationCount: 4,
      hadVomit: false, hadBleeding: false,
    } as any);
    expect(result.overall).toBe(ClinicalStatus.GREEN);
    // BLOOD_PRESSURE aparece em byVital (para gráfico) mas não em `triggers`.
    expect(result.triggers.some((t) => t.kind === VitalKind.BLOOD_PRESSURE)).toBe(false);
  });
});

describe('evaluateVitalSigns — vômito e sangramento disparam RED', () => {
  it('vômito = true gera overall RED mesmo com resto GREEN', () => {
    const result = evaluateVitalSigns({
      temperature: 36.5, spo2: 98, systolic: 110, heartRate: 80, pain: 0, dyspnea: 0,
      urinatedNormally: true, urinationCount: 4, hadVomit: true, hadBleeding: false,
    } as any);
    expect(result.overall).toBe(ClinicalStatus.RED);
  });
});

describe('shouldAlert', () => {
  it('GREEN não alerta', () => expect(shouldAlert(ClinicalStatus.GREEN)).toBe(false));
  it('YELLOW e RED alertam', () => {
    expect(shouldAlert(ClinicalStatus.YELLOW)).toBe(true);
    expect(shouldAlert(ClinicalStatus.RED)).toBe(true);
  });
});
```
> Ajuste os nomes de campo de `VitalSignInput` conforme o tipo real em `packages/shared/src/types.ts` (confira antes de rodar — os exemplos acima assumem os nomes usados em `evaluateVitalSigns`, `input.systolic`, `input.hadVomit` etc., vistos em `status.ts`).

### B.2 — `frontend/src/lib/roles.ts` (de-para de papéis, fonte única)
**Arquivo novo:** `frontend/src/lib/roles.test.ts`.
- `dbRoleToAppRole('ADMIN')` → `Role.ADM`; `'MEDICAL_SURGEON'` → `Role.SURGEON`; `'ASSOCIATED_DOCTOR'` → `Role.ASSOCIATE`; `'SUPPORT'` → `Role.SUPPORT`; `'TEAM_MANAGER'` → `Role.MANAGER`.
- `APP_ROLE_LABEL_PT` tem uma entrada para cada valor de `Role` (teste que itera `Object.values(Role)` e garante `APP_ROLE_LABEL_PT[r]` não é `undefined`) — pega de graça uma futura role nova esquecida no de-para.

### B.3 — `frontend/src/lib/teamLimits.ts`
**Arquivo novo:** `frontend/src/lib/teamLimits.test.ts`.
- `TEAM_LIMITS.maxTeamsPerSurgeon === 5`; `TEAM_LIMITS.maxAssociatedDoctorsPerTeam === 10` (trava contra mudança silenciosa de constante que devia estar sincronizada com `0028_surgeon_teams.sql`/`0030_team_manager_schema.sql`).

### B.4 — Datas (`packages/shared/src/utils.ts`)
**Arquivo novo:** `packages/shared/src/utils.test.ts`.
- `monitoringDay` retorna `1..10` dentro da janela e `null` fora (teste com data de alta simulada via `vi.setSystemTime` ou parâmetro explícito, conforme a assinatura real da função — leia `utils.ts` antes de escrever, não presuma parâmetros).
- `daysSinceDischarge`/`startOfToday` usam o fuso `CLINIC_TIMEZONE` — teste que a virada de dia não depende do fuso da máquina que roda o teste (rode com `TZ=UTC` e `TZ=America/Sao_Paulo` localmente e confirme resultado igual, se a função for testável sem mockar `Date` global).

### B.5 — Mock mínimo do Supabase (se decidir testar services)
**Não existe hoje nenhum mock.** Se for automatizar algo de `frontend/src/services/*.ts` (ex.: `teamService.getAvailableAssociatedDoctors`/`teamManagerService`), crie um mock local simples (objeto com `.from().select().eq()...` encadeável retornando dados fixos) em vez de instalar MSW — o projeto não usa MSW hoje e adicionar uma dependência nova não foi pedido. Escopo mínimo: validar que `getEligibleAssociates`/equivalente (se existir em `teamManagerService.ts` ou `teamService.ts`) realmente exclui o `main_surgeon_id` da própria equipe e quem já é membro — **leia o código real antes de escrever o mock**, pois a implementação pode ter nome de função diferente do que foi especificado (confirme em `frontend/src/services/teamManagerService.ts`, que já existe no repo).

**Pré-requisito confirmado:** `packages/shared/package.json` hoje **não tem** `vitest` nem script `test` (só `build`/`dev`/`prepare` com `tsc`). Antes de rodar B.1/B.4, adicione:
```json
"scripts": { "test": "vitest run" },
"devDependencies": { "vitest": "^4.1.9" }
```
(mesma versão já usada em `frontend/package.json`, para não divergir). Rode `npm install` na raiz depois de editar.

**Critério de aceite da Fase B:** `npm run test --workspace @vitalsync/frontend` **e** `npm run test --workspace @vitalsync/shared` (após o ajuste acima) passam, cobrindo pelo menos B.1–B.3 sem pular nenhum caso.

---

## FASE C — CI passa a rodar os testes

**Arquivo:** `.github/workflows/ci.yml`.
**Alvo:** adicionar um step após `Build monorepo`:
```yaml
      - name: Testes automatizados (shared + frontend)
        run: |
          npm run test --workspace @vitalsync/shared
          npm run test --workspace @vitalsync/frontend
```
Depende do ajuste da Fase B (adicionar `test`/`vitest` em `packages/shared/package.json`) já ter sido feito antes.
**Critério de aceite:** um PR com um teste quebrado propositalmente falha o CI; revertendo o teste, o CI passa.

---

## FASE D — Checklist manual de QA por perfil (login/menu/permissão)

Repita para cada perfil, usando as contas da Fase A:

| Perfil | Login | Menu esperado | Rota bloqueada (deve negar) |
|---|---|---|---|
| Admin | `admin@vitalsync.com` | Dashboard, Gerenciar Usuários, Convites, Gerenciar Equipes, Cadastro de Pacientes, Pacientes, Alertas, Perfil | — (acesso total) |
| Gerente de Equipe | conta nova criada na Fase A | Dashboard, Cadastro de Pacientes, Pacientes, Equipes vinculadas, Perfil (conferir exatamente o que `RoleBasedSidebar.tsx` monta hoje para `Role.MANAGER` — leia antes de marcar certo/errado) | `/admin/users`, `/teams`, `/admin/*` |
| Médico Cirurgião (`MEDICAL_SURGEON`) responsável | `cirurgiao@vitalsync.com` | Dashboard, Pacientes, Alertas, Minhas Equipes, Meus Atendimentos, Perfil — **sem** "Cadastro de Pacientes" (mudou de dono para o Gerente/Admin) | `/patients/new` deve **negar** mesmo sendo responsável pela equipe |
| Médico Associado | `medico@vitalsync.com` | Dashboard, Pacientes, Alertas, Minhas Equipes (leitura), Meus Atendimentos, Perfil | `/patients/new`, `/teams`, `/admin/*` |
| Suporte | conta de suporte (criar se não houver no seed) | Pacientes, Convidar Profissional, Perfil — **sem Dashboard** | `/dashboard` deve redirecionar sem tela vazia |

**Critério de aceite:** nenhuma URL digitada manualmente abre uma tela para quem não devia; nenhum menu mostra opção que o backend recusa (isso já foi item M-02 da auditoria — reconfirme que continua alinhado).

---

## FASE E — Fluxos críticos (paciente, alertas, fotos, equipes)

1. **Link público do paciente:** abrir `/r/:token` (ou `/registro-sinais/:token`) de um paciente do seed **sem estar logado** → formulário abre; enviar medição estável → sem alerta; enviar medição com febre alta (≥38.5) → alerta RED criado, aparece em Alertas com `type='Temperatura'`.
2. **Notificação (homologação ligada, whitelist com seu número):** medição YELLOW/RED → `notification_logs` ganha linha `PENDING`/`SENT` para o número na whitelist e `SKIPPED_TEST_MODE` para os demais.
3. **Atendimento:** marcar alerta como atendido exige observação (tentar salvar vazio deve falhar); alerta some dos "recentes" e aparece em "Meus Atendimentos".
4. **Cadastro de paciente:** logado como Gerente de Equipe (vinculado a um cirurgião), cadastrar paciente na equipe desse cirurgião → sucesso; tentar cadastrar numa equipe de outro cirurgião não vinculado → deve **negar** (RLS `patients_insert` via `is_team_manager_of`).
5. **Fotos:** enviar medição com foto de curativo (paciente com dreno = sim, também foto do dreno) → foto aparece na tela de acompanhamento para o cirurgião/associado da equipe e para o Gerente vinculado; logar como médico de **outra** equipe (ou Gerente **não** vinculado) e confirmar que a foto **não** aparece / signed URL falha.
6. **Equipes — filtro de associado corrigido:** como cirurgião responsável da Equipe A, abrir "adicionar associado" e confirmar que um `MEDICAL_SURGEON` que é responsável pela Equipe B aparece na lista (e que, ao abrir a Equipe B, esse mesmo médico não aparece como opção de associado dela própria). Confirmar que usuários inativos, `ADMIN`, `TEAM_MANAGER`, `SUPPORT` e quem já é membro **não aparecem**.
7. **Substituir Cirurgião Principal:** como Admin, trocar o responsável de uma equipe para outro `MEDICAL_SURGEON` ativo → sucesso, e a equipe nunca aparece sem responsável em nenhum momento; tentar definir um `ASSOCIATED_DOCTOR` como responsável → deve falhar com `INVALID_SURGEON_ROLE`.
8. **Convite de médico:** gerar convite de associado para uma equipe (como cirurgião responsável) → o profissional que aceita o convite entra **automaticamente** na equipe certa, sem tela de seleção manual.
9. **Notificação ao adicionar membro:** adicionar um associado a uma equipe → confirmar (via SQL ou UI, se houver) que `notification_logs` ganhou linhas com `template_name='membro_adicionado_equipe'` para o médico adicionado, o responsável da equipe, e o(s) Gerente(s) vinculados a esse responsável.

---

## FASE F — Feature "Gerente de Equipe" (validação específica)

1. **Criação/vínculo pelo Admin:** Admin cria um Gerente e vincula a 2 cirurgiões diferentes (`admin_link_team_manager`) → o Gerente, ao logar, vê exatamente as equipes desses 2 cirurgiões (`get_surgeons_of_manager`) e nenhuma outra.
2. **Vínculo inválido:** tentar vincular um Gerente a um perfil que não é `MEDICAL_SURGEON` (ex.: um `ASSOCIATED_DOCTOR`) → deve falhar com `INVALID_SURGEON_ROLE` (trigger `validate_team_manager_surgeon`).
3. **Desvínculo:** Admin desvincula (`admin_unlink_team_manager`) → o Gerente deixa de ver as equipes daquele cirurgião imediatamente (na próxima consulta, sem precisar deslogar).
4. **Cirurgião responsável em uma equipe, associado em outra:** confirmar que o mesmo `MEDICAL_SURGEON` aparece no dashboard/telas certas em cada papel — como responsável na Equipe A (gerencia, vê tudo) e como associado na Equipe B (permissões de associado, não de responsável).
5. **`team_members` não aceita `MAIN_SURGEON`:** tentar inserir diretamente (via SQL, para teste de regressão de RLS/constraint) uma linha `role_in_team='MAIN_SURGEON'` → falha por `team_members_role_associate_only` (constraint da `0031`).
6. **Equipe nunca sem responsável:** confirmar que `medical_teams.main_surgeon_id` é `NOT NULL` no schema atual (`0031`, item 7) — tentar criar equipe sem responsável deve falhar antes mesmo de chegar à RLS.
7. **Dashboard do Gerente:** confirmar que os números batem com as equipes vinculadas (não vaza dado de equipes de cirurgiões não vinculados).

---

## FASE G — Regressão dos itens ainda abertos (documentar, não esconder)

| ID | O que testar | Resultado esperado hoje (bug conhecido) |
|---|---|---|
| M-05 | No wizard de medição do paciente, tentar enviar SpO2 = 80 (fora da faixa do `thresholds.ts` mas dentro do `INPUT_RANGES` local de `validation.ts`) | O wizard **aceita** um valor que o motor clínico oficial rejeitaria — comportamento divergente, reportar como pendente, não "consertar" aqui. |
| M-10 | `grep` confirma que `process-vital-record` não é importada/chamada por nenhum código do frontend nem por Database Webhook ativo | Função órfã existe mas inofensiva **enquanto não for religada**; reportar como risco latente. |
| M-17 | Simular falha de rede/erro na chamada de `submitByToken` **depois** do upload da foto (ex.: derrubar a conexão momentaneamente ou usar um token inválido de propósito após o upload) | Foto fica no Storage sem registro em `vital_sign_records`/`measurement_photos` — confirmar que isso realmente acontece e documentar. |
| C-06 | Confirmar que a UI (`Gerenciar Usuários`) só chama a Edge Function/`admin_create_user` novo, nunca `admin_create_doctor` (RPC antiga da `0004`) | UI não usa mais a RPC antiga, mas ela **ainda existe** no banco — reportar que a limpeza não foi feita. |

**Critério de aceite da fase:** o relatório final lista esses 4 itens explicitamente como "confirmado ainda aberto" — não é permitido marcá-los como resolvidos sem uma correção de verdade (fora do escopo deste prompt).

---

## FASE H — Mobile / responsividade

Testar em 320, 375, 414, 768, 1024, 1366, 1440px nas telas alteradas ou críticas: Dashboard, Monitoramento, Alertas, Acompanhamento do paciente (fotos/gráficos), Equipes (`MyTeamPage`/`TeamsPage`), tela nova do Gerente, Cadastro de Paciente.
**Critério de aceite:** sem scroll horizontal, botões ≥44px, tabelas viram cards, bottom-nav não cobre conteúdo, modais/drawers não estouram.

---

## FASE I — Relatório final e critério de "projeto totalmente funcional"

Entregar:
1. Resultado do `npm run test` (Fase B) e do CI (Fase C) — logs ou prints.
2. Checklist das Fases D/E/F/H preenchido (✅/❌ por item, com nota de quem testou e quando).
3. Confirmação explícita dos 4 itens da Fase G (ainda abertos, com evidência).
4. `npm run build` (raiz) sem erros.
5. Uma lista curta de "achados novos" (bugs encontrados durante este processo que não estavam mapeados em nenhum documento anterior), se houver — não corrigir aqui, só registrar.

**"Totalmente funcional" significa, neste prompt:** todas as Fases B–F e H com ✅, Fase G documentada (mesmo que com bugs conhecidos, desde que não escondidos), CI verde, build verde. Não significa "zero bugs conhecidos" — os 4 itens da Fase G continuam pendentes de correção em outro momento.

---

## 3. O que NÃO fazer

- Não rodar testes de alerta/WhatsApp com homologação desligada apontando pra números reais.
- Não instalar MSW ou outra dependência de teste nova sem necessidade comprovada — o mock manual da Fase B.5 resolve o caso de uso atual.
- Não marcar M-05/M-10/M-17/C-06 como corrigidos neste prompt — é escopo de outra rodada.
- Não editar migrations aplicadas para "forçar" um teste passar.
- Não testar contra o banco de produção.
- Não pular a Fase F achando que "já foi testado quando foi implementado" — a implementação foi feita numa sessão anterior; esta é a primeira verificação independente dela.
