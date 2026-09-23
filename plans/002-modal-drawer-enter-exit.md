# 002 — Consertar animações mortas de Modal/Drawer e adicionar saída

- **Status**: DONE (fase 4)
- **Commit**: 8824ffe
- **Severity**: HIGH
- **Category**: Missed opportunities / Physicality & origin
- **Depends on**: 001
- **Estimated scope**: 6 arquivos, ~70 linhas

## Problem

Os modais e o drawer usam classes do plugin `tailwindcss-animate` (`animate-in`, `fade-in`,
`slide-in-from-right`), mas **o plugin não está instalado** (`apps/web/tailwind.config.cjs:77`
tem `plugins: []` e ele não está em `apps/web/package.json`). Resultado: as classes não geram CSS,
e todo modal/drawer aparece e some de uma vez (teleporta). `duration-250`, `backdrop-blur-xs` e
`animate-fade-in` também não existem no Tailwind v3 — o blur do fundo do Drawer e do modal de QR não é aplicado.

```tsx
/* apps/web/src/components/ui/Modal.tsx:43 — atual */
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
```

```tsx
/* apps/web/src/components/ui/Drawer.tsx:54 e :61 — atual */
className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
className={`relative z-50 w-full ${widthClasses[width]} bg-surface border-l border-border shadow-modal flex flex-col h-full animate-in slide-in-from-right duration-250`}
```

Outros usos mortos:
- `apps/web/src/agents/AgentsPage.tsx:231` — `animate-in fade-in duration-150` no aviso de sucesso.
- `apps/web/src/knowledge/KnowledgePage.tsx:644` — `animate-fade-in` no modal de adicionar/editar.
- `apps/web/src/connections/ConnectionsPage.tsx:922` — `backdrop-blur-xs`.

Além disso, `Modal` e `Drawer` fazem `if (!isOpen) return null;`, então não há como animar a saída.

## Target

Entrada: backdrop em fade; modal em `opacity 0 → 1` + `scale(0.96) → 1` (origem central — modais são isentos
de origem no gatilho); drawer em `translateX(100%) → 0` com a curva de drawer. Saída mais rápida que a entrada (150ms).

```css
/* apps/web/src/styles.css — adicionar no final */
@keyframes overlay-in{from{opacity:0}}
@keyframes overlay-out{to{opacity:0}}
@keyframes modal-in{from{opacity:0;transform:scale(0.96)}}
@keyframes modal-out{to{opacity:0;transform:scale(0.98)}}
@keyframes drawer-in{from{transform:translateX(100%)}}
@keyframes drawer-out{to{transform:translateX(100%)}}
@keyframes notice-in{from{opacity:0;transform:translateY(-4px)}}
.motion-overlay{animation:overlay-in var(--duration-modal) var(--ease-out) both}
.motion-overlay[data-closing]{animation:overlay-out var(--duration-exit) var(--ease-out) both}
.motion-modal{animation:modal-in var(--duration-modal) var(--ease-out) both}
.motion-modal[data-closing]{animation:modal-out var(--duration-exit) var(--ease-out) both}
.motion-drawer{animation:drawer-in var(--duration-drawer) var(--ease-drawer) both}
.motion-drawer[data-closing]{animation:drawer-out var(--duration-exit) var(--ease-out) both}
.motion-notice{animation:notice-in var(--duration-popover) var(--ease-out) both}
@media (prefers-reduced-motion:reduce){
  .motion-modal{animation-name:overlay-in}
  .motion-modal[data-closing]{animation-name:overlay-out}
  .motion-drawer{animation-name:overlay-in}
  .motion-drawer[data-closing]{animation-name:overlay-out}
  .motion-notice{animation-name:overlay-in}
}
```

Keyframes são aceitáveis aqui: abrir/fechar modal é ocasional e não é redisparado em sequência rápida.

Hook de presença (novo arquivo `apps/web/src/components/ui/usePresence.ts`):

```ts
import { useEffect, useState } from 'react';

/** Mantém o elemento montado durante a animação de saída. */
export function usePresence(isOpen: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, exitMs]);
  return { mounted, closing: mounted && !isOpen };
}
```

## Repo conventions to follow

- Componentes UI em `apps/web/src/components/ui/`, exportados por `index.ts` — exporte `usePresence` lá também.
- CSS global em `apps/web/src/styles.css` (exemplo de keyframe existente: `@keyframes skeleton-shimmer` com bloco `prefers-reduced-motion` logo abaixo).

## Steps

1. Crie `apps/web/src/components/ui/usePresence.ts` com o código do Target e adicione `export * from './usePresence';` em `apps/web/src/components/ui/index.ts`.
2. Adicione o bloco CSS do Target ao final de `apps/web/src/styles.css`.
3. `Modal.tsx`: importe `usePresence`; troque `if (!isOpen) return null;` por
   `const { mounted, closing } = usePresence(isOpen); if (!mounted) return null;`.
   No overlay (linha 43) troque `animate-in fade-in duration-200` por `motion-overlay` e adicione `data-closing={closing || undefined}`.
   Na caixa interna (linha 45) adicione a classe `motion-modal` e `data-closing={closing || undefined}`.
4. `Drawer.tsx`: mesmo padrão do passo 3. Backdrop (linha 54): troque `backdrop-blur-xs transition-opacity animate-in fade-in duration-200` por `backdrop-blur-sm motion-overlay` + `data-closing`. `<aside>` (linha 61): troque `animate-in slide-in-from-right duration-250` por `motion-drawer` + `data-closing`. O efeito de `document.body.style.overflow` continua usando `isOpen`.
5. `AgentsPage.tsx:231`: troque `animate-in fade-in duration-150` por `motion-notice`.
6. `KnowledgePage.tsx:644`: troque `animate-fade-in` por `motion-overlay`; na div interna (linha 645) adicione `motion-modal`. (Sem saída animada aqui — renderização condicional local; fora do escopo.)
7. `ConnectionsPage.tsx:922`: troque `backdrop-blur-xs` por `backdrop-blur-sm`.

## Boundaries

- NÃO instale `tailwindcss-animate` nem outra dependência.
- NÃO mude a lógica de Escape/foco nem a estrutura dos modais além das classes/atributos citados.
- NÃO mexa em `PlaygroundModal`, `ExecutionDetailModal` nem `.modal-overlay` (styles.css) neste plano.
- Se as linhas citadas não baterem (drift), PARE e reporte.

## Verification

- **Mechanical**: `pnpm --filter @sdr/web typecheck` e `pnpm --filter @sdr/web build`; `pnpm test` continua verde.
- **Feel check** (`pnpm dev:web`):
  - Abra um agente (Drawer em /agents): o painel desliza da direita e desacelera no fim; fechar com Esc/X/backdrop desliza para fora mais rápido que a entrada.
  - Abra qualquer `Modal`: surge do centro com leve escala, sem "pop" de 0.
  - DevTools → Animations → 10%: o backdrop e o painel começam juntos; nada começa lento.
  - Rendering → `prefers-reduced-motion: reduce`: o drawer só faz fade, sem deslocamento.
- **Done when**: `grep -rn "animate-in\|fade-in\|slide-in-from\|backdrop-blur-xs\|animate-fade-in\|duration-250" apps/web/src` não retorna nada.
