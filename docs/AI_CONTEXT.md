# Contexto para IAs — SDR Flow

Este arquivo é a porta de entrada para qualquer IA que vá analisar, corrigir ou ampliar o SDR Flow. Ele resume o contexto operacional; não substitui os documentos de arquitetura.

## Ordem obrigatória de leitura

Antes de propor ou alterar escopo, leia nesta ordem:

1. `docs/PLAN.md` — arquitetura alvo e decisões de produto.
2. `docs/IMPLEMENTATION.md` — o que existe, o que foi verificado e o que ainda depende de homologação.
3. `docs/MIGRATION.md` — limites entre este projeto e os repositórios de origem.
4. Este arquivo e `README.md` — forma de trabalhar, comandos e configuração local.

Para uma área específica, consulte também:

| Tema | Referência |
|---|---|
| Provedores OpenAI, Evolution e Meta | `docs/PROVIDERS.md` |
| Segurança e rollout de autenticação | `docs/AUTH_SECURITY_ROLLOUT.md` |
| Créditos de software de terceiros | `THIRD_PARTY_NOTICES.md` e `LICENSE` |
| Fluxo comercial Vida Card | `docs/HANDOFF_GPT_V11.md` e playbooks em `docs/` |

## O produto em uma frase

O SDR Flow é um editor visual e runtime multiempresa de fluxos de conversa para qualificação comercial no WhatsApp. O fluxo publicado é um grafo versionado; cada conversa deve executar a versão que lhe foi atribuída, com rastreabilidade de cada nó.

## Mapa do repositório

```text
apps/web          Vite + React: editor de fluxos, inbox, configurações e métricas
apps/api          Express: REST/WS, autenticação, webhooks e produção de jobs
apps/worker       BullMQ: consumo de turnos e tarefas de manutenção
packages/shared   tipos, enums e schemas Zod compartilhados
packages/flow     catálogo de nós, validação e runtime do grafo
packages/db       cliente Supabase, repositórios e tipos gerados
supabase/migrations  schema, RLS, RPCs e políticas versionados
tests             Vitest; integração SQL em PGlite descartável
```

O monorepo usa Node 22.13+ e pnpm 11.24.0. Os scripts disponíveis ficam no `package.json` da raiz.

## Invariantes que não podem ser quebrados

- **Supabase Postgres é a única persistência de negócio.** PGlite é somente infraestrutura de testes e geração de tipos.
- Toda entidade de negócio pertence a uma organização: use `organization_id`, RLS e FKs compostas em relações entre entidades organizacionais.
- O catálogo Zod é a fonte comum do formulário do builder e da validação de API. Não crie contratos concorrentes.
- Publicar um fluxo cria uma versão imutável. Retomadas, inclusive após `flow.wait_reply`, usam `flow_executions.flow_version_id`, e não a versão publicada atual.
- Um nó não reconhecido deve falhar na validação ou execução de forma explícita; nunca o trate como no-op.
- Não finja êxito para publicação, conexão, QR, webhook ou envio de WhatsApp. Integrações externas permanecem desativadas até confirmação real.
- Não inclua segredos, chaves de provedor ou credenciais criptografadas em respostas, logs ou código cliente.
- Preserve as atribuições MIT do AutoGen em `LICENSE` e `THIRD_PARTY_NOTICES.md`.

## Decisões de migração já tomadas

Este é um repositório novo e independente de `../auto-gen` e `../sdr-engine`. As origens servem apenas de referência e **não devem ser alteradas** durante a migração.

Não portar do SDR Engine:

- auth legado com SHA-256;
- tabelas duplicadas de conexão WhatsApp;
- escrita dupla Supabase/SQLite;
- buffer de mensagens em memória;
- `orchestrator.ts` monolítico;
- QR, conexão ou envio simulados.

O runtime próprio do grafo substitui a orquestração de agentes do AutoGen. Para novas capacidades, prefira adicionar schema, executor, portas e testes ao catálogo de nós em vez de introduzir regras específicas na interface.

## Estado e limitações atuais

As fases funcionais estão implementadas e possuem testes locais, mas integrações hospedadas — Supabase, Redis, OpenAI, Evolution, Meta e Google Calendar — ainda exigem homologação de ponta a ponta. Consulte `docs/IMPLEMENTATION.md` antes de declarar uma funcionalidade pronta para produção.

`WHATSAPP_SEND_ENABLED=false` é o padrão deliberado. Não o altere nem alegue envio real sem autorização e confirmação do provedor.

## Procedimento para mudanças

1. Delimite a área e identifique migrations, schemas, runtime, API e UI impactados.
2. Preserve o isolamento por organização desde o schema até a rota e a interface.
3. Quando alterar banco, crie uma migration aditiva e atualize os tipos gerados com `pnpm db:types`; não edite manualmente `packages/db/src/database.types.ts`.
4. Quando alterar um nó, mantenha schema Zod, formulário, validação, executor, portas e testes coerentes.
5. Prefira falhas visíveis, traces e portas `error` a fallbacks silenciosos.
6. Antes de concluir, execute os comandos de verificação aplicáveis e, para UI, percorra o fluxo no navegador.

## Verificação mínima

```powershell
pnpm db:types:check
pnpm check
```

Para mudanças estritamente de banco, rode também `pnpm test:db`. Para desenvolvimento local, `pnpm dev` inicia os apps; detalhes de Supabase e Docker estão no `README.md`.

## Como registrar uma entrega

Ao encerrar uma mudança, informe objetivamente:

- arquivos e comportamento alterados;
- decisões ou suposições relevantes;
- testes/comandos executados e resultado;
- o que continua pendente de infraestrutura ou homologação externa.

Evite afirmar que provedores externos enviaram, conectaram ou autenticaram se a confirmação foi simulada ou se o ambiente não foi configurado.
