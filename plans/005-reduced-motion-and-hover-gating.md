# 005 — Respeitar `prefers-reduced-motion` e restringir hover a dispositivos com mouse

- **Status**: DONE (fase 4)
- **Commit**: 8824ffe
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 arquivos, ~15 linhas

## Problem

Só o skeleton respeita movimento reduzido:

```css
/* apps/web/src/styles.css:111 — único caso */
@media (prefers-reduced-motion:reduce){.skeleton-shimmer{animation:none;background-image:none}}
```

Há animações infinitas sem essa proteção: `animate-pulse` (7 usos, ex.: `builder/FlowNode.tsx:110`,
`components/layout/AppHeader.tsx:80`, `builder/Builder.tsx:645`), `.debug-live-dot` (`debug-pulse 1.6s infinite`,
styles.css:201) e o `runtime-error-pulse` (tratado no plano 003).

E o Tailwind v3 não restringe `hover:` a dispositivos com hover: no celular/tablet, tocar num card deixa o
`hover:scale-110`/`hover:border-brand` preso (ex.: `main.tsx:148`, `agents/AgentCard.tsx:43`).

## Target

```js
/* apps/web/tailwind.config.cjs — no topo do objeto exportado */
  future: { hoverOnlyWhenSupported: true },
```

```css
/* apps/web/src/styles.css — adicionar no final */
@media (prefers-reduced-motion:reduce){
  .animate-pulse,.animate-bounce,.debug-live-dot{animation:none}
  .animate-spin,.debug-spin{animation-duration:1.5s}
  *,*::before,*::after{scroll-behavior:auto!important}
}
@media (hover:hover) and (pointer:fine){
  /* mover para cá as regras :hover com transform que existirem após o plano 004 */
}
```

Spinners continuam girando (informam carregamento — movimento reduzido é "menos", não "zero"), só mais devagar.
Pulses decorativos param; o estado continua visível pela cor.

## Steps

1. Em `apps/web/tailwind.config.cjs`, adicione `future: { hoverOnlyWhenSupported: true },` como primeira chave do objeto exportado.
2. Adicione o bloco `prefers-reduced-motion` do Target ao final de `apps/web/src/styles.css`.
3. Procure em `styles.css` regras `:hover{transform:...}` que tenham sobrado depois do plano 004 (`grep -n ":hover{transform" apps/web/src/styles.css`) e mova-as para dentro de `@media (hover:hover) and (pointer:fine){...}`. Se não sobrar nenhuma, não crie o bloco vazio.

## Boundaries

- NÃO remova os spinners (`animate-spin`).
- NÃO altere as classes nos componentes.

## Verification

- **Mechanical**: build de `@sdr/web`; no CSS gerado, `hover:` aparece dentro de `@media (hover: hover)`.
- **Feel check**:
  - DevTools → Rendering → `prefers-reduced-motion: reduce`: o ponto "ao vivo" do painel de debug do Inbox, o status da instância no header e o selo "Início" param de pulsar; spinners giram mais devagar.
  - DevTools com emulação de toque (ou celular real): tocar num card da home não deixa o ícone ampliado preso.
- **Done when**: as duas checagens passam.
