# 001 — Criar tokens de easing e duração do app

- **Status**: DONE (fase 4)
- **Commit**: 8824ffe
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Easing & duration
- **Estimated scope**: 2 arquivos, ~15 linhas

## Problem

O app não tem nenhum token de movimento. Todas as transições usam o padrão do Tailwind
(`cubic-bezier(0.4, 0, 0.2, 1)`, um ease-in-out fraco) ou `ease` puro, e as durações
estão soltas no código (`duration-150`, `duration-200`, `duration-300`, `.15s`).

```js
/* apps/web/tailwind.config.cjs:69-77 — atual: nenhum transitionTimingFunction */
      boxShadow: { ... },
    },
  },
  plugins: [],
```

```css
/* apps/web/src/styles.css:1-50 — :root, .light define cores/sombras, nenhum --ease-* */
```

Os planos 002–005 dependem destes tokens.

## Target

```css
/* apps/web/src/styles.css — dentro do bloco `:root, .light { ... }` (antes de `color-scheme: light;`) */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --duration-press: 140ms;
  --duration-popover: 180ms;
  --duration-modal: 220ms;
  --duration-drawer: 320ms;
  --duration-exit: 150ms;
```

```js
/* apps/web/tailwind.config.cjs — dentro de theme.extend */
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out-strong': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
```

Isso gera as classes `ease-out` (sobrescrevendo o `ease-out` padrão do Tailwind pela curva forte),
`ease-in-out-strong` e `ease-drawer`.

## Repo conventions to follow

- Tokens de design ficam como CSS custom properties em `apps/web/src/styles.css` no bloco `:root, .light`
  (ex.: `--shadow-elevated`) e são expostos ao Tailwind em `tailwind.config.cjs` via `var(--...)`
  (exemplo: `boxShadow.elevated: 'var(--shadow-elevated)'`).
- Tokens de movimento não mudam entre temas: declare só em `:root, .light` (o `.dark` herda de `:root`
  porque `<html>` sempre casa com `:root`).

## Steps

1. Em `apps/web/src/styles.css`, no bloco `:root, .light { ... }`, adicione as 8 linhas do Target logo antes de `color-scheme: light;`.
2. Em `apps/web/tailwind.config.cjs`, dentro de `theme.extend`, depois de `boxShadow: {...},`, adicione o objeto `transitionTimingFunction` do Target.

## Boundaries

- NÃO troque nenhum uso existente nesta etapa — só crie os tokens.
- NÃO adicione dependências.
- Se o bloco `:root, .light` não existir como descrito, PARE e reporte.

## Verification

- **Mechanical**: `pnpm --filter @sdr/web typecheck` e `pnpm --filter @sdr/web build` passam.
- **Feel check**: nenhum — mudança invisível até os planos 002–005.
- **Done when**: `getComputedStyle(document.documentElement).getPropertyValue('--ease-out')` retorna a curva nos temas claro e escuro, e o CSS gerado contém `.ease-out{transition-timing-function:var(--ease-out)}`.
