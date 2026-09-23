# Auditoria de design — SDR Flow (apps/web)

- **Commit auditado**: 8824ffe
- **Skills usadas**: `emil-design-eng` (formato Before/After/Why, acabamento de componentes) e `apple-design` (tipografia, materiais, feedback, familiaridade, simplicidade), com a parte de celular do `mobile-native`.
- **Método**: leitura do código + o app rodando no Chromium (1440×900 nos temas claro e escuro, e 390×844 no celular), com login e API simulados. As telas aparecem vazias (sem dados), então os estados vazios também foram avaliados.
- **Complementa**: os planos de animação `plans/001`–`005`.

Capturas nesta pasta: `dark-dashboard.png`, `light-flows.png`, `dark-agents.png`, `dark-settings.png`, `dark-inbox.png`, `mobile-inbox.png`.

---

## 1. Críticos: bugs sistêmicos de CSS que mudam o visual do app inteiro

| Before | After | Why |
| --- | --- | --- |
| `bg-brand/10`, `border-border/60`, `bg-surface-elevated/40`, `divide-border/40`… (**168 usos** em `.tsx`) com cores definidas como `'var(--accent-primary)'` em `tailwind.config.cjs` | Cores com canais: `--accent-primary-rgb: 46 232 107;` e `brand: 'rgb(var(--accent-primary-rgb) / <alpha-value>)'` (o mesmo para `border`, `surface`, `content`, `success`, `warning`, `danger`, `info`) | O Tailwind v3 não consegue aplicar transparência (`/10`, `/60` etc.) em `var()`, então **essas classes não geram CSS nenhum** (confirmado compilando: 0 regras). Os fundos esverdeados dos ícones, avatares e alertas somem. As bordas caem no padrão do Tailwind, `#e5e7eb`, e viram **linhas quase brancas no modo escuro**: acima de "Modo Claro" na sidebar e entre os itens da lista do Inbox (`mobile-inbox.png`) |
| `bg-surface-muted`, `bg-surface-muted/50` (13 usos) | `bg-surface-subtle` (a cor que existe), ou criar o token `surface.muted` | A classe não existe no tema. O fundo fica transparente, e o controle Todos/IA/Humano do Inbox perde o fundo e fica só com a borda clara |
| `var(--color-border)`, `var(--color-bg-surface)`, `var(--color-brand)` em `PlaygroundModal.tsx:140,174,321,336,416,438`, `SchemaForm.tsx:458,507`, `PromptsView.tsx`, `VariablesView.tsx` | `var(--border-default)`, `var(--bg-surface)`, `var(--accent-primary)` | Essas variáveis **não estão definidas** em `styles.css`. Os balões do Playground ficam transparentes, as bordas usam a cor do texto e os ícones perdem a cor de destaque |
| Global `input,select,textarea{width:100%}` em `styles.css:112` competindo com o Tailwind | Remover a largura global; usar `w-full` só onde for necessário | Na página de Agentes, o campo de busca encolhe até sobrar só o ícone e o `select` ocupa a linha toda (`dark-agents.png`). É o CSS antigo vazando por cima dos componentes novos |
| `font-family: Inter, 'Segoe UI', sans-serif` sem carregar a Inter (só `@fontsource/sora/700` em `main.tsx:12`) | Instalar `@fontsource-variable/inter` e importar em `main.tsx`, **ou** assumir `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | A fonte declarada nunca é baixada. Cada máquina mostra uma fonte diferente: Arial/Liberation no Windows e no Linux, Helvetica no Mac. É visível nas capturas. A skill recomenda a fonte do sistema a menos que haja motivo para outra |

## 2. Alta: contraste e legibilidade

| Before | After | Why |
| --- | --- | --- |
| `--text-muted: #666666` (escuro) → 3,2:1 sobre `#141414` e 2,9:1 sobre `#1e1e1e` | `--text-muted: #8a8a8a` → 5,3:1 e 4,8:1 | Abaixo de 4,5:1 falha no WCAG AA. E o texto "muted" é justamente o de 9–11px (legendas dos KPIs, datas, contadores) |
| `--text-muted: #94a3b8` (claro) → 2,6:1 sobre branco | `--text-muted: #64748b` → 4,8:1 | Mesmo problema no modo claro |
| `--accent-primary: #10b981` usado **como texto** no modo claro (nav ativa, títulos em caixa alta, links, "Usar Modelo SDR") → 2,5:1 | Separar `--accent-text: #047857` (5,5:1) de `--accent-primary` (que fica para fundos e botões) | O verde claro funciona como preenchimento, mas é ilegível como texto sobre branco |
| `Não vinculada` em `#fbbf24` sobre branco (inspector do Builder, `light-flows.png`) → 1,7:1 | `text-warning`, com `--color-warning: #b45309` no tema claro (5,0:1) | A cor de alerta fixa foi pensada para o escuro. No claro, praticamente some |
| 16 tamanhos de fonte diferentes: `text-[10px]` ×58, `text-[11px]` ×58, `9px` ×18, `8px` ×3, `10.5px`, `body 13px`… | Escala única: 11 / 12 / 13 / 15 / 18 / 24 / 30px como tokens (`text-2xs`…`text-3xl`), mínimo de **11px** | A hierarquia vira ruído com tamanhos tão próximos. 8–9px é ilegível em tela comum. A skill manda montar a hierarquia com peso + tamanho + entrelinha como um conjunto, não com mais um tamanho |
| Nenhum ajuste de espaçamento entre letras por tamanho (títulos de 22–30px com o mesmo espaçamento do texto) | Títulos `≥ 22px`: `letter-spacing: -0.02em; line-height: 1.15`. Caixa alta de 9–10px: `+0.06em` | O espaçamento entre letras depende do tamanho: títulos grandes pedem espaçamento negativo e textos pequenos em caixa alta, positivo |

## 3. Alta: tema claro incompleto

| Before | After | Why |
| --- | --- | --- |
| `.react-flow__minimap{background:#141414!important;border:1px solid #242424!important}` (`styles.css:126`) | `background: var(--bg-surface)!important; border-color: var(--border-default)!important` | No modo claro o minimapa fica **um bloco preto** no canto do canvas (`light-flows.png`) |
| `.canvas-hint{background:rgba(20,20,20,0.85)}`, `.flow-node-card` com gradiente `#191919`, `debug-*` com cores fixas | Usar `color-mix(in srgb, var(--bg-surface) 88%, transparent)` e os tokens do tema | Partes do CSS antigo só foram pensadas para o escuro |
| `#2ee86b` fixo **31×** em `.tsx` (FlowNode, AgentsPage, Builder…) | `text-brand` / `bg-brand` / `border-brand` | No modo claro o verde da marca vira `#10b981`, mas esses 31 pontos continuam no verde neon do escuro. O resultado são dois verdes na mesma tela |
| Paleta crua do Tailwind misturada aos tokens: `emerald-500` ×20, `amber-500/400/300` ×24, `red-500`, `slate-950`, `zinc-900`, `purple-600` | Mapear para `success` / `warning` / `danger` / `brand` | Cores fora do tema não mudam com ele e criam tons "quase iguais" (três verdes diferentes no Builder) |
| `<meta name="theme-color" content="#0a0a0a">` fixo | Atualizar a meta no clique do tema (`main.tsx:95-102`) ou usar uma por `prefers-color-scheme` | Barra do navegador preta com o app em modo claro |

## 4. Média: consistência e familiaridade

| Before | After | Why |
| --- | --- | --- |
| **4 estilos de abas**: Builder (sublinhado + caixa com borda na aba ativa), Inbox (segmentado com borda branca grossa), Configurações (botões verdes cheios), `Tabs` do design system (linha/pílulas) | Usar só o `components/ui/Tabs` (`line` para navegação de página, `pills` para filtros) | A skill manda que coisas que parecem iguais se comportem igual. Hoje cada página ensina um controle novo |
| Mesmo destino com 4 nomes: sidebar "Indicadores (KPIs)", breadcrumb "Painel de Indicadores", título em caixa alta "INDICADORES DE DESEMPENHO", H1 "Painel Gerencial SDR" (`dark-dashboard.png`) | Um nome só por página (ex.: "Indicadores") no menu, no breadcrumb e no H1. Título em caixa alta só se acrescentar informação | Rótulos específicos e **consistentes** criam previsibilidade. São 45 textos em caixa alta, e os títulos acima do H1 repetem o próprio H1 |
| `PAPEL: OWNER` com a cor de **alerta** (âmbar) em Configurações (`dark-settings.png`) | Selo `default`/`outline`. Âmbar só para avisos reais | Cor semântica usada como decoração faz os alertas de verdade perderem força |
| Toggle "☀ Modo Claro [Dark]" | "Tema" + um interruptor com ícone, ou o texto "Mudar para claro" sem o selo `Dark` | O texto descreve a ação e o selo descreve o estado atual. Lidos juntos, se contradizem ("Modo Claro: Dark") |
| Configurações: "Membros da Organização" em peso normal. Outras páginas usam `font-semibold` nos títulos de seção | `text-base font-semibold` em todo `h2` de seção (via `CardTitle` ou um componente `SectionHeader`) | A hierarquia muda de página para página |
| `$0.000`, `$0.0000` e `0.0k tokens` no Dashboard (`DashboardPage.tsx:315,318,331,476`) | `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })` → `US$ 0,00`. Tokens com `compactDisplay` → `0 mil` | O app está em pt-BR, mas os números estão em formato americano, com 3–4 casas decimais que o usuário não precisa |

## 5. Média: Builder (a tela mais usada)

| Before | After | Why |
| --- | --- | --- |
| `<ReactFlow fitView maxZoom={2}>` (`Builder.tsx:937-939`): com 1–2 nós, o canvas amplia em **2×** (`light-flows.png`) | `fitViewOptions={{ maxZoom: 1, padding: 0.3 }}` (manter `maxZoom={2}` só para o zoom manual) | O primeiro contato com o editor mostra um nó gigante e desfocado. Parece bug |
| 4 faixas empilhadas antes do canvas: header do app (56) + cabeçalho do editor (82) + abas (42) + barra de ferramentas (43) ≈ **223px** de 900 | Juntar abas + barra de ferramentas numa linha só, e mover "Produção Livre / Trava de teste" para perto do botão Publicar | Simplicidade: o canvas é o conteúdo, e hoje ele perde um quarto da altura para os controles |
| Nó com borda + anel + sombra de brilho + faixa colorida + etiqueta + portas com borda (`FlowNode.tsx`) | Manter faixa + etiqueta. Portas sem borda (só o fundo `bg-surface-elevated`). Brilho só quando selecionado | Muitas camadas de destaque ao mesmo tempo, e o selecionado não se diferencia do normal |

## 6. Média: estados vazios e carregamento

| Before | After | Why |
| --- | --- | --- |
| Dashboard vazio: dois gráficos de ~340px de altura com uma linha cinza no meio ("Sem dados de funil disponíveis.") | Estado vazio compacto (≈160px) com ícone, frase e ação ("Conectar WhatsApp" / "Publicar um fluxo"), como já é feito em **Agentes** (`dark-agents.png`, o melhor exemplo do app) | A tela vazia deve dizer o que fazer em seguida, não mostrar molduras enormes vazias |
| Conexões e Configurações: estado vazio como texto solto dentro de uma borda | Reaproveitar o mesmo componente `EmptyState` | Consistência |

## 7. Celular (`mobile-native`)

| Before | After | Why |
| --- | --- | --- |
| Sidebar fixa `w-56` (224px) sempre visível (`AppSidebar.tsx:64`) → ocupa **57%** da tela de 390px (`mobile-inbox.png`) | Abaixo de `md`, esconder a sidebar atrás de um botão de menu (drawer) ou virar uma barra de abas embaixo | No celular o Inbox fica cortado e inutilizável |
| Campos com fonte de 11–13px | `font-size: 16px` em `input, select, textarea` quando `(pointer: coarse)` | O iOS dá zoom na página ao tocar no campo |
| `.app-shell{min-width:620px}` abaixo de 680px (`styles.css:153`) | Remover e ajustar o layout | Cria rolagem horizontal da página inteira |
| `.modal-overlay{height:100vh}` (`styles.css:216`) | `height: 100dvh` | No celular, `100vh` inclui a barra do navegador |

## O que já está bom (manter)

- A estrutura do cabeçalho das páginas se repete (título em caixa alta → H1 → descrição → ações à direita). Só precisa unificar os nomes.
- O estado vazio de **Agentes**: ícone, título, frase e ação principal.
- Tokens de cor de fundo e borda bem montados no modo escuro (`--bg-canvas` → `--bg-surface` → `--bg-elevated`): três níveis claros de profundidade.
- Esqueletos de carregamento que respeitam `prefers-reduced-motion`, e botão principal com retorno ao clicar.
- `100dvh` no layout do app e `-webkit-tap-highlight-color` já tratados.

## Ordem sugerida

1. **Seção 1** (cores com canais + variáveis indefinidas + CSS global + fonte): corrige sozinha boa parte do que se vê de errado, e é pré-requisito do resto.
2. **Seções 2 e 3** (contraste + tema claro): em sua maioria são trocas de token.
3. **Seção 5** (`fitViewOptions`: uma linha, retorno imediato no Builder).
4. **Seções 4, 6 e 7**.

---

## Status da implantação

| Fase | Escopo | Commit | Status |
| --- | --- | --- | --- |
| 1 · Fundações | Cores com canais RGB (`bg-brand/10` etc. voltaram a gerar CSS), borda padrão do tema, tokens e variáveis que faltavam, fonte Inter carregada, `select` sem esmagar a busca | `8097aa8` | Feito |
| 2 · Contraste e tipografia | Textos cinza e verde ≥ 4,5:1 nos dois temas, `text-brand-fg` para verde usado como texto, piso de 11px (`text-2xs`), ajuste dos títulos | `3432e92` | Feito |
| 3 · Tema claro | Cores fixas e paleta crua → tokens, minimapa/canvas pelo tema, balões do Inbox legíveis, texto das categorias dos nós, `theme-color` acompanha o tema | `5394f8c` | Feito |
| 4 · Animação | Planos 001–005 (ver `plans/README.md`) | `e0d48ab` | Feito |
| 5 · Consistência e Builder | Um nome por página, abas unificadas sem a "caixa" do botão global, selo de papel neutro, toggle "Tema", `h2` semibold, US$ em pt-BR, `EmptyState`, zoom automático limitado a 100% | `5cfd67a` | Feito |
| 6 · Celular | Sidebar vira gaveta abaixo de `md` (botão ☰, fecha ao navegar/Esc), sem rolagem horizontal, campos com 16px em telas de toque, `100dvh` no overlay | (este commit) | Feito |

### Ainda em aberto (fora desta rodada)

- **Builder**: juntar as faixas de abas e ferramentas (≈223px de controles antes do canvas). É uma mudança de layout maior, que merece protótipo antes.
- **Inbox no celular**: a lista e a conversa continuam lado a lado. O ideal é lista → conversa em telas separadas (mestre/detalhe).
- **Gráficos do Dashboard** (Recharts) ainda usam `#2ee86b`/`#38bdf8` fixos, porque atributos SVG não aceitam `var()`. Dá para ler a cor com `getComputedStyle` quando o tema mudar.
- Faltam títulos em caixa alta repetidos acima do H1 e revisar o CSS antigo (`styles.css`) restante para migrar a Tailwind.
