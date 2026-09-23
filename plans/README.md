# Planos de melhoria de animação — SDR Flow (web)

Gerados pela skill `improve-animations` (emilkowalski/skills) sobre o commit `8824ffe`.
Cada plano é autocontido e pode ser executado por qualquer agente.

| # | Plano | Severidade | Status |
| --- | --- | --- | --- |
| 001 | [Tokens de easing e duração](001-motion-tokens.md) | MEDIUM | DONE |
| 002 | [Animações mortas de Modal/Drawer + saída](002-modal-drawer-enter-exit.md) | HIGH | DONE |
| 003 | [Nó com erro piscando no canvas](003-runtime-error-node-motion.md) | HIGH | DONE |
| 004 | [`transition-all` → propriedades explícitas; hover-lift no canvas](004-replace-transition-all.md) | HIGH | DONE |
| 005 | [Reduced motion + hover só com mouse](005-reduced-motion-and-hover-gating.md) | MEDIUM | DONE |

## Ordem recomendada

1. **001** primeiro — 002, 003 e 004 usam `var(--ease-out)` / a classe `ease-out`.
2. **002**, **003** e **004** são independentes entre si depois do 001.
3. **005** por último — o passo 3 dele depende de quais hovers sobraram depois do 004.

## Auditoria de design

Além dos planos de animação, há uma auditoria de design (tipografia, cor/contraste, tema claro,
consistência, estados vazios, celular) em [design-audit/README.md](design-audit/README.md).
