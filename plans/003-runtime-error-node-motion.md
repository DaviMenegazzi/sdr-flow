# 003 — Tirar o pisca-pisca do nó com erro no canvas

- **Status**: DONE (fase 4)
- **Commit**: 8824ffe
- **Severity**: HIGH
- **Category**: Purpose & frequency / Accessibility
- **Estimated scope**: 2 arquivos, ~10 linhas

## Problem

Quando um nó falha em execução, três animações infinitas rodam ao mesmo tempo:

```tsx
/* apps/web/src/builder/FlowNode.tsx:59 — atual: o CARD INTEIRO pulsa opacidade 1 → 0.5 */
          ? 'border-danger ring-2 ring-danger/40 animate-pulse'
```

```tsx
/* apps/web/src/builder/FlowNode.tsx:77 — atual: o badge fica pulando para sempre */
<div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-md z-10 animate-bounce">
```

```css
/* apps/web/src/styles.css:130 — legado, mesmo efeito para .flow-node.runtime-error */
.flow-node.runtime-error{...;animation:runtime-error-pulse 1.6s ease-in-out infinite}
```

`animate-pulse` no card inteiro deixa o **texto do erro** com 50% de opacidade metade do tempo — justamente
quando o usuário precisa lê-lo. O bounce não tem propósito além de chamar atenção, e o erro já tem borda,
anel vermelho, badge e banner. Nenhuma delas respeita `prefers-reduced-motion`.

## Target

Estado estático e legível; um único sinal de atenção, curto e finito, que roda uma vez quando o erro aparece:

```tsx
/* FlowNode.tsx:59 — alvo */
          ? 'border-danger ring-2 ring-danger/40'
```

```tsx
/* FlowNode.tsx:77 — alvo */
<div className="node-error-badge absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-md z-10">
```

```css
/* styles.css — adicionar no final */
@keyframes node-error-attention{0%{box-shadow:0 0 0 0 rgba(220,38,38,.55)}100%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}
.node-error-badge{animation:node-error-attention 900ms var(--ease-out) 2}
@media (prefers-reduced-motion:reduce){.node-error-badge{animation:none}}
```

E na regra legada `.flow-node.runtime-error` (styles.css:130) remova `;animation:runtime-error-pulse 1.6s ease-in-out infinite`
(mantenha a borda e o box-shadow estáticos).

## Repo conventions to follow

- Animações de estado ficam em `apps/web/src/styles.css` (ex.: `@keyframes debug-pulse` em styles.css:201).
- Curva `var(--ease-out)` vem do plano 001; se ainda não existir, use `cubic-bezier(0.23, 1, 0.32, 1)`.

## Steps

1. `FlowNode.tsx:59`: remova ` animate-pulse`.
2. `FlowNode.tsx:77`: remova `animate-bounce` e adicione a classe `node-error-badge`.
3. `styles.css:130`: remova a declaração `animation:runtime-error-pulse 1.6s ease-in-out infinite` da regra `.flow-node.runtime-error` (pode deixar o `@keyframes runtime-error-pulse` ou removê-lo se não houver outro uso — confira com grep).
4. Adicione o CSS do Target ao final de `styles.css`.

## Boundaries

- NÃO mexa no `animate-pulse` do selo "Início" (FlowNode.tsx:110) — ver plano 005.
- NÃO altere cores, textos nem a estrutura do nó.

## Verification

- **Mechanical**: typecheck + build de `@sdr/web`.
- **Feel check**: no Builder, rode um teste que falhe num nó:
  - O card fica vermelho e o texto do erro está 100% legível o tempo todo.
  - O badge emite 2 ondas curtas e para. Nada fica se mexendo indefinidamente.
  - Com `prefers-reduced-motion: reduce`, nenhuma onda.
- **Done when**: `grep -n "animate-pulse\|animate-bounce" apps/web/src/builder/FlowNode.tsx` só mostra a linha do selo "Início".
