# Auditoria — Modo Escuro e Logo (VitalSync)

Data: 2026-08-25 · Escopo: SOMENTE dois eixos — (A) modo escuro e (B) aplicação da marca/logo. Nenhuma correção foi aplicada; este documento é só diagnóstico.

## 0. Bloqueio de ambiente encontrado no início — leia antes da matriz de cobertura

Antes de auditar, tentei subir o app com `npm run dev:frontend`. Dois problemas de ambiente limitaram a cobertura **ao vivo**:

1. **Sem backend local disponível.** Não há Docker rodando nem Supabase CLI instalado nesta máquina, então não foi possível seguir `docs/SETUP_LOCAL.md` (`supabase start` + `db reset`) para ter usuários de teste dos 6 papéis. `frontend/.env.local` aponta para um projeto Supabase **remoto** (`uswwdfcqrkvegbrynout.supabase.co`) cuja natureza (homologação vs. dados reais do piloto) e credenciais são desconhecidas — por segurança, **não tentei login** com credenciais adivinhadas, nem tentei token de paciente ou de convite adivinhado. Consequência: **todas as telas internas (login-gated) e as duas rotas públicas com token (`/registro-sinais/:token`, `/convite/:token`) foram auditadas SÓ por leitura de código**, não ao vivo. Isso está marcado explicitamente na Matriz de Cobertura (seção 4) — nenhuma delas está sendo reportada como "verificada" sem essa ressalva.
2. **`resize_window` da automação de navegador não teve efeito.** A janela do Chrome desta sessão ficou presa em ~1920×945 (tela cheia) — todas as tentativas de redimensionar para 375/390/400/768/1440 (inclusive em aba nova) reportaram sucesso, mas `window.innerWidth` nunca mudou. Ou seja, **a matriz de larguras 375/768/1440/1920 não pôde ser verificada ao vivo em nenhuma largura além da efetiva (~1920, "desktop largo")** — inclusive o menu mobile (hambúrguer) do `Layout.tsx` e da `HomePage.tsx`, que só aparece via CSS abaixo do breakpoint `lg` (1024px), nunca ficou visível para interação. Larguras menores foram avaliadas **só pelas classes responsivas no código** (`sm:`/`md:`/`lg:` do Tailwind), não visualmente.

O que **foi** possível verificar ao vivo, com interação real: `/` (HomePage) e `/login` (LoginPage) — as duas únicas rotas sem exigência de sessão nem de token — no tema escuro (foco da tarefa), com toggle claro→escuro→claro sem recarregar, F5 em escuro (teste de FOUC), digitação em campo, olho de senha, navegação por âncora, console do navegador. Sempre na largura efetiva (~1920px).

Todas as outras 25 telas do inventário foram auditadas por **leitura de código-fonte** (o arquivo `.tsx` de cada página/componente, os tokens de `global.css`, os usos de `VitalSyncMark`/`VitalSyncLogo`) — suficiente para achados de token ausente, cor hardcoded e tamanho de logo, mas **não** substitui inspeção visual para coisas como espaçamento, sobreposição real de elementos ou timing de animação.

---

## 1. Resumo executivo

- **Telas no inventário:** 27 (confirmado com `grep -n "path=" frontend/src/App.tsx`; ver seção 4).
- **Verificadas ao vivo:** 2 (`/`, `/login`), única largura efetiva (~1920px), tema escuro + transição + reload.
- **Auditadas só por código:** 25.
- **Total de achados:** 8 (5 modo escuro, 2 logo, 1 acha-se nos dois eixos ao mesmo tempo — contado uma vez em cada tabela onde se aplica).
- **Distribuição por severidade:** 0 CRÍTICO · 2 ALTO · 4 MÉDIO · 2 BAIXO.

**Os 5 problemas mais graves, em ordem:**

1. **[ALTO — logo]** O símbolo de "período" (Sol/Lua) no fluxo do paciente reaproveita os mesmos ícones `Sun`/`Moon` do `ThemeToggle`, empilhados no mesmo card, nas duas telas mais críticas do app (`VitalsRegisterPage.tsx` → `PeriodChoice`, e `PatientMeasurementWizard.tsx` → `PatientMeasurementHeader`). Não é a marca em si, mas é ambiguidade de ícone num fluxo sem suporte por perto — achado ALTO por estar na tela do paciente.
2. **[ALTO — modo escuro]** `stroke="#94a3b8"` hardcoded (não `var(--muted-foreground)`) nos eixos de **todos** os gráficos recharts do app (`charts.tsx` ×3 componentes, `dashboard.tsx` ×1) — contradiz o comentário do próprio arquivo ("Tokens (não hex fixo)... assim os gráficos acompanham o tema"). Hoje "funciona" só por coincidência (o hex escolhido é idêntico ao `--muted-foreground` do `.dark`), mas é uma bomба-relógio: qualquer ajuste futuro no token escuro dessincroniza os eixos sem ninguém perceber via grep de classes Tailwind.
3. **[MÉDIO — modo escuro]** `fill="#93c5fd"` hardcoded na barra diastólica do gráfico de pressão arterial (`charts.tsx:175`) — mesmo problema de princípio, sem token equivalente definido.
4. **[MÉDIO — logo]** `VitalSyncMark` em `HomePage.tsx:731` (mock de celular "Registro simples pelo celular") renderiza exatamente em 32×32px — o piso absoluto permitido pelo próprio componente. Não é um bug (está dentro da regra), mas é o único ponto do app na borda exata do limite "nunca abaixo de 32px"; não foi possível confirmar visualmente a legibilidade porque a área está dentro da seção "Mobile first" da landing, capturada em tema claro por coincidência de scroll — vale revisão visual dedicada.
5. **[MÉDIO — fora de escopo, registrado como observação]** Em toda visita/reload à `HomePage.tsx`, a seção do herói (e outras seções abaixo da dobra) carrega **totalmente vazia/transparente** por ~1–2s antes do `scroll-reveal` (IntersectionObserver) aplicar `is-visible` — reproduzido de forma consistente em 3 tentativas (carga inicial, reload em escuro, clique em âncora "Contato"). Isso não é um bug de tema nem de logo (o vazio acontece igual nos dois temas), então documento só como pendência na seção 6, mas está entre os primeiros 5 problemas por impacto percebido: por ~1–2s a landing parece quebrada.

Nenhum achado CRÍTICO foi confirmado ao vivo nem inferido do código nos dois eixos auditados — o sistema de tokens (`:root`/`.dark`), o `ThemeContext`, o script anti-FOUC e o componente `VitalSyncLogo` estão bem construídos e cobrem consistentemente os componentes compartilhados (`ui.tsx`, `Layout.tsx`, `Toast.tsx`, `StatusBadge`, `ModalOverlay`).

---

## 2. Achados de modo escuro

| # | Severidade | Tela / rota | Arquivo:linha | Largura | Papel | O que acontece | O que deveria acontecer | Como reproduzir |
|---|---|---|---|---|---|---|---|---|
| E1 | ALTO | Todas as telas com gráfico de linha/barra (`/dashboard`, `/patients/:id`) | `frontend/src/components/charts.tsx:111-112,163-164,194-195`; `frontend/src/components/dashboard.tsx:100-101` | não verificado ao vivo (código) | ADM/SURGEON/ASSOCIATE/MANAGER/NURSE | `stroke="#94a3b8"` fixo nos eixos X/Y de `VitalLineChart`, `BloodPressureChart`, `StepsBarChart` e do gráfico de barras do dashboard — contradiz o comentário do próprio arquivo, que declara "Tokens (não hex fixo)". Hoje o hex escolhido coincide exatamente com `--muted-foreground` do `.dark` (`#94a3b8`), então visualmente não quebra o escuro **por acaso**. | Usar `stroke="var(--muted-foreground)"`, como já é feito em `TOOLTIP_STYLE`/`labelStyle`/`itemStyle` no mesmo arquivo. | Ler `charts.tsx` linhas 111-112, 163-164, 194-195 e `dashboard.tsx` linhas 100-101; comparar com `--muted-foreground` em `global.css:69,112`. Confirmado por leitura de código, não visualmente (o resultado visual atual coincide com o token). |
| E2 | MÉDIO | `/patients/:id` (gráfico "Pressão arterial") | `frontend/src/components/charts.tsx:175` | não verificado ao vivo (código) | ADM/SURGEON/ASSOCIATE/MANAGER/NURSE | `fill="#93c5fd"` fixo na barra diastólica (base do stack). Não existe token equivalente declarado em `global.css` para essa cor — é a única cor de gráfico no arquivo sem par em `:root`/`.dark`. | Ou declarar um token dedicado (`--chart-diastolic` ou similar) com par claro/escuro, ou justificar explicitamente por que este tom fixo é aceitável nos dois temas (comentário no código). | Ler `charts.tsx:175`; comparar com o restante do arquivo, que usa `STATUS_COLOR`/`PRIMARY` (tokens) para todas as outras cores de gráfico. |
| E3 | MÉDIO | `HomePage.tsx` (`/`) — herói e demais seções | `frontend/src/pages/HomePage.tsx` (uso de `.scroll-reveal`, ver `global.css:232-247`) | ~1920px (única testada) | público (sem login) | Ao carregar ou recarregar a página (em qualquer tema), o conteúdo abaixo do cabeçalho fica **totalmente invisível** por ~1-2s antes do `IntersectionObserver` do scroll-reveal marcar `is-visible`. Reproduzido 3× ao vivo (carga inicial em 1920px, F5 em escuro, clique em âncora "Contato" que rola a página). | Ou revelar o conteúdo já visível no primeiro paint (sem depender do observer disparar), ou reduzir a janela de invisibilidade. | Abrir `http://localhost:5174/` e tirar screenshot imediatamente após o load — a seção do herói aparece como um retângulo vazio da cor de fundo até o observer disparar. **Fora do escopo dos dois eixos pedidos (não é bug de tema nem de logo — acontece igual em claro e escuro) — registrado aqui só porque afeta diretamente a percepção da auditoria; ver também seção 6.** |
| E4 | BAIXO | Toda tela — comparação `:root` × `.dark` | `frontend/src/styles/global.css:51-133` | n/a | n/a | Nenhum token de cor ausente: todos os 27 tokens de cor declarados em `:root` (linhas 57-92) têm par redefinido em `.dark` (linhas 100-132), token a token. `--radius` não é redefinido em `.dark`, mas é dimensão, não cor — correto não redefinir. | (nada a corrigir — item positivo, listado para deixar registrado que a comparação foi feita linha a linha) | Diff manual de `global.css:51-93` (`:root`) contra `global.css:100-133` (`.dark`). |
| E5 | BAIXO | `.dark .vitalsync-home` (landing) | `frontend/src/styles/global.css:203-230` | ~1920px (testado ao vivo) | público | Redefine só os tokens de base (`--background`, `--primary`, `--secondary`, `--surface`, etc.); os gradientes derivados (`--home-flow-*`, `.home-section-*`, `.home-footer`) **não** são redeclarados no escuro — e, testado ao vivo rolando a página inteira em escuro (hero, "Como funciona", "Benefícios", "Recursos", "Segurança", CTA final, rodapé), todos os gradientes recalcularam corretamente porque usam `color-mix()` em cima dos tokens de base, que herdam por cascata no DOM. | (nada a corrigir — comportamento correto e documentado no comentário do próprio CSS, confirmado ao vivo) | Alternar claro↔escuro com a `HomePage` aberta e rolar a página inteira — feito ao vivo nesta auditoria, sem cor clara "furando" o escuro em nenhuma seção. |

**Achados adicionais confirmados corretos ao vivo** (não são "achados" no sentido de bug, mas documentam o que foi de fato verificado, conforme exigido pela tarefa):
- Transição claro→escuro→claro→escuro na `HomePage` sem reload: instantânea, sem cor presa, logo trocando de variante junto (branca no escuro, azul no claro).
- F5 em `/` e em `/login` com tema escuro ativo: **sem flash branco** (FOUC) em nenhuma das duas rotas — o script inline de `index.html:12-27` aplica a classe `dark` antes do primeiro paint.
- Console do navegador após reload/toggle: nenhum erro ou warning novo; só os 2 warnings pré-existentes do React Router (`v7_startTransition`, `v7_relativeSplatPath`) e ruído padrão do Vite/DevTools, sem relação com tema.
- `/login`: placeholder do e-mail e da senha legíveis e visualmente distintos do texto digitado (testado digitando `teste@vitalsync.com`); olho de mostrar/ocultar senha alterna o ícone corretamente; painel azul e painel escuro com contraste adequado nos dois lados.
- `ModalOverlay`/drawer mobile do `Layout.tsx` usa `bg-foreground/50` — coberto pela regra `.dark .bg-foreground\/50` (`global.css:145-147`) que força o véu a ficar escuro mesmo com `--foreground` claro no tema escuro. Verificado por leitura de código (não foi possível abrir um modal real sem login).
- `CustomSelect`, `ModalOverlay`, `Toast`, `StatusBadge`, `statusBorder`, botões (`VARIANT_CLS`) em `ui.tsx`: 100% token-based (`bg-card`, `border-border`, `text-muted-foreground`, `bg-stable/warning/alert`) — nenhuma cor hardcoded encontrada em `ui.tsx` além do botão de marca do WhatsApp (ver seção 5).
- Nenhuma classe Tailwind de paleta crua (`bg-green-*`, `bg-red-*`, `bg-yellow-*` etc.) em todo `frontend/src` — busca abrangente, zero ocorrências. Todas as cores clínicas passam pelos tokens semânticos (`stable`/`warning`/`alert`).

---

## 3. Achados de logo

| # | Severidade | Tela / rota | Arquivo:linha | Arquivo de logo usado | Tamanho renderizado | Problema | Como reproduzir |
|---|---|---|---|---|---|---|---|
| L1 | ALTO | `/registro-sinais/:token`, `/r/:token` (fluxo do paciente) | `frontend/src/pages/VitalsRegisterPage.tsx:187,195` (botões "Manhã"/"Noite" com `Sun`/`Moon`) + `frontend/src/components/patient-measurement/PatientMeasurementHeader.tsx:37` (badge de período) + `ThemeToggle` renderizado no mesmo card (`VitalsRegisterPage.tsx:148`, `PatientMeasurementWizard.tsx:149`) | n/a (ícones `lucide-react`, não a marca) | n/a | Os mesmos ícones `Sun`/`Moon` usados pelo `ThemeToggle` (alternar claro/escuro) são reaproveitados para indicar "período do dia" (manhã/noite) — em 3 pontos: os dois botões grandes de escolha de período (com texto ao lado, risco baixo), e o badge dentro do card de medição (também com texto). O `ThemeToggle` fica posicionado bem acima, no canto superior direito do mesmo card, sem rótulo visível (só `aria-label`/`title`). Não é a marca VitalSync em si (fora do escopo B estrito), mas é reaproveito de iconografia de tema num contexto onde a tarefa pediu atenção específica ("não confundir o badge de período com o botão de tema") — por isso relatado aqui. | Confirmado só por leitura de código (sem token de paciente para abrir a tela ao vivo). Ler `VitalsRegisterPage.tsx:143-198` e `PatientMeasurementWizard.tsx:144-152`. |
| L2 | MÉDIO | `/` (HomePage, seção "Mobile first") | `frontend/src/pages/HomePage.tsx:731` | `/logo-simbolo-branco.svg` ou `/logo-simbolo.svg` (conforme tema, resolvido por `VitalSyncMark`) | 32×32px (`width={32} height={32}`, `className="h-8 w-8"`) — confirmado via DOM (`getBoundingClientRect`) na sessão ao vivo | Único uso do símbolo no app exatamente no piso mínimo absoluto (32px) permitido pelo comentário do próprio componente (`VitalSyncLogo.tsx:19-24`: "NUNCA renderizar abaixo de 32px... Alvo padrão... 40px"). Está dentro da regra (não é "abaixo de"), mas é a instância com menor margem de segurança do app — o comentário do componente já reconhece que abaixo de ~32px os traços colapsam numa mancha, então 32px exato merece confirmação visual dedicada (zoom) em vez de só medição de bounding box. | Abrir `/`, rolar até a seção "Mobile first" ("Registro simples pelo celular"), inspecionar o ícone dentro do mock de celular. Confirmado ao vivo (1920px, tema escuro) que os 4 braços da cruz e o nó central continuam distinguíveis a essa largura de tela — mas o card renderiza em tamanho fixo (`w-[280px]`) independente da largura da viewport, então o resultado deve se repetir em qualquer largura; não testado em 375px por causa do bloqueio de `resize_window` (seção 0). |
| L3 | BAIXO | Todas as telas com `VitalSyncMark`/`VitalSyncLogo` | `frontend/src/components/VitalSyncLogo.tsx:40` | ambos arquivos | n/a | Positivo, não é bug: a troca de variante (azul↔branca) é automática e centralizada — `temaEfetivo === 'escuro'` força a variante branca mesmo quando o call site passa `tone="default"` (ex.: `Layout.tsx`, `HomePage.tsx`). Não há nenhum ponto no código onde a marca fique azul sobre fundo escuro nem branca sobre fundo claro, porque não existe um segundo lugar que decida isso — só este componente. | Confirmado por leitura de código (`VitalSyncLogo.tsx:36-40`) e ao vivo na `HomePage`/`LoginPage` alternando tema — listado aqui como achado "BAIXO" só para deixar registrado que a verificação foi feita, não porque haja problema. |
| L4 | BAIXO | Todas | `frontend/src/components/VitalSyncLogo.tsx:94-97`; `frontend/index.html:29-30`; `frontend/public/*` | — | — | Nenhum arquivo de logo referenciado no código está ausente de `frontend/public/`: `logo-simbolo.svg`, `logo-simbolo-branco.svg` (ambos usados por `VitalSyncLogo.tsx`), `favicon.svg`, `apple-touch-icon.png` (ambos referenciados em `index.html`) — todos presentes. O nome "VitalSync" é sempre `<span>`/texto real (`VitalSyncLogo.tsx:94-97`; `PatientMeasurementHeader.tsx:734`; footer da `HomePage`), nunca dentro de uma tag `<img>`/`<svg>` — confirmado por leitura de código em todos os 4 usos de `VitalSyncMark`/`VitalSyncLogo` encontrados no grep. `VitalSyncMark` já nasce com `alt=""` + `aria-hidden="true"` (linha 44-45), então não há risco de leitor de tela anunciar "VitalSync" duas vezes nos pontos onde o texto acompanha o símbolo. | Grep `logo-simbolo|favicon|apple-touch-icon` em `frontend/src` + `frontend/index.html`, cruzado com `ls frontend/public` (seção 5) — nenhuma referência quebrada. |

**Não verificado nem ao vivo nem com confiança total por código:**
- Favicon na aba do navegador (B9) e atalho iOS (B10) — não é possível confirmar renderização real do favicon via automação de página (é UI do navegador, fora do DOM). Só confirmei que `index.html` referencia `/favicon.svg` e `/apple-touch-icon.png` e que ambos os arquivos existem em `frontend/public/`.
- B7 (alinhamento com o texto ao lado, sem sobreposição, "atenção especial ao mobile") — não verificável sem largura mobile real (bloqueio da seção 0).
- Teste manual de seleção/cópia de texto "VitalSync" com o mouse (B1) — não executado interativamente; a garantia vem de leitura de código (é sempre `<span>` texto), que é uma evidência forte mas não idêntica a um teste de seleção real no navegador.

---

## 4. Matriz de cobertura

Larguras: como a única largura efetivamente alcançável nesta sessão foi ~1920px (bloqueio da seção 0), a coluna "Larguras" abaixo usa **"1920 apenas"** para o que foi visto ao vivo, e **"código"** para o que foi avaliado só lendo classes responsivas (`sm:`/`md:`/`lg:`) sem confirmação visual.

| # | Tela / rota | 375 | 768 | 1440 | 1920 | Papéis verificados | Motivo do que falta |
|---|---|---|---|---|---|---|---|
| 1 | `/` HomePage | código | código | código | **ao vivo** (claro+escuro, toggle, F5, console) | público | Larguras <1920 não alcançáveis (`resize_window` sem efeito, seção 0) |
| 2 | `/login` LoginPage | código | código | código | **ao vivo** (escuro, digitação, olho de senha) | público | idem |
| 3 | `/registro-sinais/:token`, `/r/:token` | código | código | código | código | nenhum (sem token de paciente) | Sem token de paciente válido — não tentado adivinhar (risco de acessar dado real) |
| 4 | `/convite/:token` | código | código | código | código | nenhum | Sem token de convite válido |
| 5 | `/dashboard` | código | código | código | código | nenhum | Sem credenciais de login (seção 0) |
| 6 | `/monitoring` | código | código | código | código | nenhum | idem |
| 7 | `/patients/new` | código | código | código | código | nenhum | idem |
| 8 | `/patients/:id` | código | código | código | código | nenhum | idem |
| 9 | `/patients/:id/registrar-medicao` | código | código | código | código | nenhum | idem |
| 10 | `/alerts` | código | código | código | código | nenhum | idem |
| 11 | `/my-care` | código | código | código | código | nenhum | idem |
| 12 | `/manager-teams` | código | código | código | código | nenhum | idem |
| 13 | `/my-team` | código | código | código | código | nenhum | idem |
| 14 | `/my-teams` | código | código | código | código | nenhum | idem |
| 15 | `/teams` | código | código | código | código | nenhum | idem |
| 16 | `/admin/teams/:teamId` | código | código | código | código | nenhum | idem |
| 17 | `/invites` | código | código | código | código | nenhum | idem |
| 18 | `/admin/users` | código | código | código | código | nenhum | idem |
| 19 | `/admin/hospitals` | código | código | código | código | nenhum | idem |
| 20 | `/admin/surgery-types` | código | código | código | código | nenhum | idem |
| 21 | `/admin/exports` | código | código | código | código | nenhum | idem |
| 22 | `/admin/adherence` | código | código | código | código | nenhum | idem |
| 23 | `/admin/settings` | código | código | código | código | nenhum | idem — tela mais densa, avaliada só estruturalmente (não abri o arquivo linha a linha nesta sessão além dos greps globais) |
| 24 | `/profile` (+ `AvatarCropModal`) | código | código | código | código | nenhum | idem |
| 25 | `PlaceholderPage.tsx` | não avaliado | não avaliado | não avaliado | não avaliado | — | Não confirmei se há rota viva apontando para ele; não investigado (fora do orçamento desta rodada) |
| 26 | rota `*` (inexistente) | não avaliado | não avaliado | não avaliado | não avaliado | — | Não testado nem por código (comportamento de redirecionamento não lido no `App.tsx`) |
| 27 | `Layout.tsx` (topbar/sidebar/menu mobile) + `Toast.tsx` | código (menu mobile: só a existência da classe `lg:hidden`, nunca visto renderizado) | código | código | parcial — chrome não visível sem login | nenhum | Sem sessão ativa, o `Layout` nunca renderiza; lido só como componente isolado |

**Papéis (ADM/SURGEON/ASSOCIATE/MANAGER/NURSE/SUPPORT):** nenhum verificado ao vivo em nenhuma tela — zero credenciais disponíveis nesta sessão. Toda diferenciação de papel mencionada nos achados (ex.: quem vê `/dashboard`) é inferida do roteamento em `App.tsx`/`PermissionGuard`, não observada visualmente.

**Estados que não puderam ser exercitados nem uma vez:** carregando, vazio, erro de carregamento, sem permissão, sessão expirada, paciente sem foto/sem medição, alerta já atendido/travado, homologação ligada — todos exigem dado real ou sessão autenticada, indisponíveis nesta sessão.

---

## 5. Achados de código

### Greps pedidos pela tarefa

```
grep -rn "bg-white|text-white|bg-black|#fff|#ffffff|#e2e8f0" frontend/src
```
28 ocorrências. Classificação:
- **Legítimas (cor semântica de token, não hardcoded solto):** `global.css:61,62,65,73,74,75,78,82,84,92,108,116,121,130,132` — são as definições dos próprios tokens `:root`/`.dark` (ex.: `--surface: #ffffff`), não usos soltos.
- **Legítimas (marca de terceiro, WhatsApp):** `ui.tsx:143`, `alerts.tsx:716`, `attendances/AttendanceDetailsDrawer.tsx:193`, `NurseDashboard.tsx:329` — `bg-[#25D366] text-white`, cor oficial do WhatsApp, correta manter fixa nos dois temas.
- **Legítima (canvas, não é UI de página):** `AvatarCropModal.tsx:54` — `ctx.fillStyle = '#ffffff'` é o preenchimento do canvas de recorte de imagem (fundo da imagem cortada), não uma cor de interface.
- **Legítima (véu escuro sobre foto, e opacidade sobre glass no login):** `photo.tsx:93,527,575,621` (`bg-black/5`, `bg-black/40`, `text-white/80`, `text-white`) — overlay escuro sobre foto de ferida/dreno (zoom/pan) e legenda branca sobre esse overlay preto; comportamento correto e igual nos dois temas (a foto em si não muda com o tema). `LoginPage.tsx:115` e `VitalSyncLogo.tsx:84` (`bg-white/10`) — vidro fosco (glassmorphism) sobre a faixa azul sólida do login, correto ficar fixo (a faixa é sempre azul, tenha tema claro ou escuro).
- **Legítima (thumb de switch/toggle):** `admin.tsx:79` — `bg-white` é o círculo deslizante do toggle, convenção universal de UI mantida fixa; a trilha ao redor (`bg-primary`/`bg-muted-foreground/30`) é que segue o tema.
- **Sobra:** nenhuma. Todas as 28 ocorrências são justificáveis.

```
grep -rn "bg-amber-|border-amber-|text-amber-|bg-slate-|text-slate-|bg-gray-|text-gray-" frontend/src
```
0 ocorrências. Nada a classificar.

```
grep -rn "color-scheme" frontend/src frontend/index.html
```
- `global.css:57` (`color-scheme: light` em `:root`) e `global.css:101` (`color-scheme: dark` em `.dark`) — **legítimas**, é exatamente o padrão recomendado para que os internos nativos do navegador (`::placeholder`, scrollbar, autofill) acompanhem o tema manual do app em vez de só o SO. Comentário no próprio CSS (linhas 51-56) explica a motivação.
- Demais ocorrências (`global.css:8,402`, `ThemeContext.tsx:17`, `index.html:19`) são comentário/nome de media query, não declarações de propriedade — não se aplicam à classificação.

```
grep -rn "VitalSyncMark|VitalSyncLogo" frontend/src
```
20 ocorrências — ver detalhamento completo na seção "Achados de logo" (tabela) e no corpo do relatório. Resumo dos 7 call-sites reais (excluindo declaração/tipos): `Layout.tsx:116` (36px), `HomePage.tsx:233,731,812` (36/32/36px), `PatientMeasurementHeader.tsx:26` (40px), `LoginPage.tsx:97,135` (`VitalSyncLogo` completo, tamanhos `md`=40px/`sm`=36px via o subcomponente). Todos ≥32px — nenhuma violação da regra do componente.

```
grep -rn "logo-simbolo|favicon|apple-touch-icon" frontend/src frontend/index.html
```
Já coberto no achado L4 (seção 3) — todos os arquivos referenciados existem em `frontend/public/`.

```
ls frontend/public
```
`apple-touch-icon.png`, `favicon.svg`, `logo-simbolo.svg`, `logo-simbolo-1024.png`, `logo-simbolo-2048.png`, `logo-simbolo-256.png`, `logo-simbolo-512.png`, `logo-simbolo-branco.svg`, `logo-simbolo-branco-1024.png`, `logo-simbolo-branco-2048.png`, `logo-simbolo-branco-512.png`. Nota: os arquivos raster (`-1024.png`, `-2048.png`, `-256.png`, `-512.png`) **não aparecem referenciados em nenhum lugar do código-fonte** (`frontend/src` nem `index.html`) — não é um achado de bug (não quebram nada), mas é código/asset morto em potencial; registrado como pendência na seção 6 em vez de achado, porque não sei se são usados por algum processo externo (ex.: manifest PWA futuro, redes sociais/OG image) que eu não tenha visto.

### Verificações adicionais (além do pedido, para fechar os checklists A e B)

```
grep -rn "(fill|stroke)=\"#[0-9a-fA-F]{3,6}\"" frontend/src
```
9 ocorrências, todas em `charts.tsx` (7) e `dashboard.tsx` (2) — **sobra**, já detalhada nos achados E1/E2.

```
grep -rn "bg-green-|bg-red-|bg-yellow-|text-green-|text-red-|text-yellow-|border-green-|border-red-|border-yellow-" frontend/src
```
0 ocorrências — confirma que toda cor clínica passa pelos tokens semânticos (`stable`/`warning`/`alert`), não pela paleta crua do Tailwind.

```
grep -rn "style=\{\{[^}]*#[0-9a-fA-F]{3,6}" frontend/src
```
0 ocorrências — nenhum estilo inline com hex solto em todo o app.

### Comparação `:root` × `.dark`, token a token

Feita manualmente (`global.css:51-133`). Todos os 27 tokens de cor de `:root` têm par em `.dark`. Nenhum gap encontrado. Detalhe registrado como achado E4 (positivo).

---

## 6. Pendências e dúvidas

1. **Vazio inicial do scroll-reveal na `HomePage`** (achado E3) — não sei se é "bug" (delay do `IntersectionObserver`/`requestAnimationFrame` grande demais) ou comportamento aceito pelo time (trade-off de performance/estética). Reproduzido de forma consistente, mas está fora do escopo dos dois eixos pedidos — só registrado aqui e na tabela de achados por transparência.
2. **PNGs de logo não referenciados** (`logo-simbolo-1024.png`, `-2048.png`, `-256.png`, `-512.png`, `logo-simbolo-branco-1024.png`, `-2048.png`, `-512.png`) — não encontrei uso deles no código. Podem ser para um uso futuro (app icon, OG image, manifest) que não faz parte do escopo desta auditoria; não tenho como confirmar sem contexto do time.
3. **Reaproveitamento de ícone Sol/Lua para "período do dia"** (achado L1) — a tarefa pediu explicitamente para verificar se isso confunde com o `ThemeToggle`; meu julgamento de código é que o risco é baixo→médio porque os dois botões de período têm texto grande ao lado ("Manhã (ao acordar)"/"Noite (antes de dormir)") e o badge no header também tem texto — mas não pude confirmar visualmente com um paciente/usuário real, e a tarefa tratou isso como preocupação relevante o bastante para mencionar explicitamente. Fica como avaliação **não confirmada ao vivo**, e a decisão de severidade (classifiquei ALTO por ser a tela mais crítica, mas poderia ser MÉDIO dado que há texto acompanhando) fica para o time decidir.
4. **`/admin/settings`** — a tarefa descreve como "a tela mais densa" e pede auditoria seção por seção; nesta rodada só rodei os greps globais sobre ela (que não acusaram nada), mas não abri `SettingsPage.tsx` linha a linha por orçamento de tempo. Se o time quiser garantia adicional especificamente nessa tela (que inclui a UI de regras clínicas editáveis, mencionada no `CLAUDE.md` como área sensível), recomendo uma rodada dedicada a ela, idealmente com sessão de ADM real.
5. **`PlaceholderPage.tsx`** e a rota coringa (`*`) — não investigados nem por código nesta rodada (item 25 e 26 da matriz). Não sei se `PlaceholderPage` é código morto ou está montada em alguma rota não documentada no inventário da tarefa.
6. **Ambiente remoto desconhecido** — recomendo fortemente que, antes de qualquer teste ao vivo futuro (inclusive uma re-auditoria com credenciais), alguém do time confirme se `uswwdfcqrkvegbrynout.supabase.co` é um projeto de homologação ou se tem dados reais de pacientes do estudo piloto. Não tentei nenhuma ação além de carregar as duas páginas públicas.
7. **Ferramenta de redimensionamento de janela sem efeito** — reportado na seção 0 como limitação desta sessão de automação, não do produto. Uma nova rodada de auditoria (desta vez ou de qualquer tarefa futura que precise de larguras diferentes) deve verificar se esse problema persiste antes de assumir que a app não é responsiva — os `sm:`/`md:`/`lg:` no código sugerem que a intenção de responsividade existe e é extensa, só não pude confirmá-la visualmente.
