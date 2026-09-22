# 004 — Trocar `transition-all` por propriedades explícitas e tirar o hover-lift do canvas

- **Status**: TODO
- **Commit**: 8824ffe
- **Severity**: HIGH
- **Category**: Performance / Purpose & frequency
- **Depends on**: 001 (para `ease-out`)
- **Estimated scope**: 12 arquivos, trocas de classe de uma linha

## Problem

`transition-all` aparece em 21 lugares (+1 `transition: all` em CSS). Ele anima qualquer propriedade que mude —
inclusive `font-weight`, `padding`, `width` e `border-width`, que disparam layout — e é a principal causa de
"tremidinha" ao trocar de aba e ao selecionar nós. O pior caso é o card do nó no canvas do React Flow, que
tem dezenas de instâncias e muda `box-shadow` + `ring` a cada seleção/hover:

```tsx
/* apps/web/src/builder/FlowNode.tsx:53 — atual */
className={`flow-node-card relative w-[244px] bg-surface rounded-2xl border transition-all duration-150 select-none shadow-elevated ${
```

No canvas, os nós e os itens da biblioteca (arrastáveis, usados dezenas de vezes por dia) ainda se mexem no hover:

```css
/* apps/web/src/styles.css:193 — atual */  .flow-node-card:hover{transform:translateY(-1px)}
/* apps/web/src/styles.css:188 — atual */  .node-library button:hover{transform:translateX(2px)}
```

O item da biblioteca desliza 2px exatamente quando o usuário vai agarrá-lo; o nó "flutua" sob o cursor ao ser arrastado.

A barra de cota anima `width` (layout) em 300ms:

```tsx
/* apps/web/src/agents/AgentsPage.tsx:281-284 — atual */
<div className="h-full bg-brand transition-all duration-300" style={{ width: `${Math.min(100, (quotaUsed / quotaMax) * 100)}%` }} />
```

## Target

Regra de substituição (Tailwind v3):

| Onde muda | Substituir `transition-all` por |
| --- | --- |
| Só cor/fundo/borda | `transition-colors` |
| Cor + sombra/ring | `transition-[color,background-color,border-color,box-shadow]` |
| Botão com `active:scale` | `transition-[color,background-color,border-color,box-shadow,transform]` |

Sempre mantenha a duração existente (ou `duration-150` se não houver) e acrescente `ease-out` (curva forte do plano 001).

## Repo conventions to follow

- Exemplo já correto no repo: `components/ui/Modal.tsx:59` usa `transition-colors` no botão de fechar.

## Steps

1. `components/ui/Button.tsx:24` — `transition-all duration-150` → `transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out`.
2. `components/ui/Input.tsx:33` — `transition-all duration-150` → `transition-[color,background-color,border-color,box-shadow] duration-150 ease-out`.
3. `components/ui/Tabs.tsx:35` e `:68` — `transition-all duration-150` → `transition-colors duration-150 ease-out`.
4. `components/layout/AppSidebar.tsx:55` — `transition-all duration-150` → `transition-colors duration-150 ease-out`.
5. `components/layout/AppHeader.tsx:78` — `transition-all` → `transition-[background-color,box-shadow] duration-150 ease-out`.
6. `agents/AgentDrawer.tsx:218` → `transition-colors duration-150 ease-out`; `agents/AgentDrawer.tsx:279` → `transition-colors duration-150 ease-out`.
7. `agents/AgentCard.tsx:38` — `transition-all duration-200` → `transition-[border-color,box-shadow] duration-200 ease-out`.
8. `main.tsx:145` — `transition-all duration-200` → `transition-[border-color,box-shadow] duration-200 ease-out`.
9. `connections/ConnectionsPage.tsx:454` e `:470` → `transition-colors duration-150 ease-out`.
10. `builder/Builder.tsx:561`, `:574`, `:590` — `transition-all duration-150` → `transition-colors duration-150 ease-out`. `:697` e `:854` — `transition-all` → `transition-colors duration-150 ease-out`.
11. `knowledge/KnowledgePage.tsx:692` e `inbox/InboxPage.tsx:865` — `transition-all` → `transition-colors duration-150 ease-out`.
12. `builder/FlowNode.tsx:53` — `transition-all duration-150` → `transition-[border-color,box-shadow] duration-150 ease-out`.
13. `styles.css:193` — remova `.flow-node-card:hover{transform:translateY(-1px)}` (mantenha o resto da linha).
14. `styles.css:188` — remova `.node-library button:hover{transform:translateX(2px)}` (mantenha o resto da linha).
15. `styles.css:251` (`.tab-btn`) — `transition: all 0.15s ease;` → `transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;`.
16. `agents/AgentsPage.tsx:281-284` — barra de cota: troque para
    `className="h-full w-full origin-left bg-brand transition-transform duration-300 ease-out"` e
    `style={{ transform: \`scaleX(${Math.min(1, quotaUsed / quotaMax)})\` }}` (o container já tem `overflow-hidden`).

## Boundaries

- NÃO mude cores, durações (exceto adicionar `ease-out`), nem estrutura.
- NÃO toque nos `hover:!scale-125` dos handles do React Flow (FlowNode.tsx:88, :163) — são alvos pequenos e o scale ajuda a mirar.
- Se algum `transition-all` citado não existir mais, pule e registre; não procure substitutos por conta própria.

## Verification

- **Mechanical**: `grep -rn "transition-all\|transition: all" apps/web/src` → vazio. Typecheck + build de `@sdr/web`.
- **Feel check**:
  - Troque de aba no Builder/Tabs: o texto não "engorda" animadamente; só a cor muda.
  - No canvas com 20+ nós, selecione e arraste nós: seleção instantânea, sem nó flutuando no hover.
  - Pegue um item da biblioteca: ele não se desloca sob o cursor.
  - DevTools → Performance ao arrastar: sem "Layout" disparado por transições.
- **Done when**: grep vazio e as quatro checagens acima ok.
