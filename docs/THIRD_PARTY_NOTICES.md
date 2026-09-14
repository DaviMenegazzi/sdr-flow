# Proveniência

## AutoGen Studio

Copyright (c) Microsoft Corporation. MIT License, reproduzida em `LICENSE`.

O tema claro/escuro e seus tokens derivam de
`auto-gen/python/packages/autogen-studio/frontend/src/styles/global.css`.
O modelo de builder (canvas React Flow, biblioteca, painel lateral, histórico Zustand e serialização)
foi adaptado de `src/components/views/teambuilder/builder/`.
`apps/web/src/builder/store.ts` reimplementa esse histórico para o domínio de fluxos,
com snapshots profundos e cursor limitado ao histórico disponível.

As dependências de Gatsby, AgentChat, teams/providers e o backend Python não foram copiadas.
Os demais componentes da aplicação original ainda aguardam migração.

## SDR Engine

Origem: repositório local `../sdr-engine`, package.json declara MIT.
Foram portados `src/models/enums.ts`, `src/utils/phone-utils.ts`,
`src/services/state-machine.ts` e as suítes `phone-utils`, `state-machine` e
`state-machine-adversarial`, preservando os casos existentes.
Alterações iniciais: caminhos de imports e acesso seguro a arrays no modo TypeScript estrito.
O modelo SDR é uma tradução estrutural das principais etapas do orchestrator; não executa seus serviços.
