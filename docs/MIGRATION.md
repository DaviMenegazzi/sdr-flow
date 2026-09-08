# Mapa das origens e da migração

Plano completo: `PLAN.md`. As origens ficam ao lado deste repositório.

## Contexto lido

O plano anexo foi lido integralmente. Foram inventariadas as duas árvores, seus manifests e testes, e consultado o grafo existente do SDR em `graphify-out/graphify-out/graph.json` (927 nós). A consulta mostrou os vínculos de orchestrator, banco, memória, handoff e máquina de estados; o grafo foi usado como índice, com inspeção direta dos módulos relevantes à migração. Nenhum grafo foi reescrito.

No AutoGen foram inspecionados o builder, store, layout/sidebar, utilitários de layout, tema, tipos e o painel de atividade. O working tree contém as alterações de chat, settings e WebSocket citadas no plano. Elas permanecem na origem para as próximas etapas. Não havia grafo na raiz do AutoGen.

No SDR foram inspecionados os contratos de telefone/estágio/webhook, os testes correspondentes, memória/handoff, o pipeline do orchestrator e as dependências de transporte, mídia, LLM e CRM. O caminho de vault citado pelo AGENTS.md do SDR não forneceu um AGENTS.md utilizável nesta sessão; o plano anexo e o código atual orientaram as decisões.

## AutoGen Studio

Base: `../auto-gen/python/packages/autogen-studio/frontend/`.

| Origem | Destino / estado |
|---|---|
| `src/components/views/teambuilder/builder/store.tsx` | `apps/web/src/builder/store.ts`: histórico adaptado ao grafo, sem mutações compartilhadas ou cursor fora do limite |
| `builder.tsx`, `nodes.tsx`, `library.tsx`, `toolbar.tsx` | Conceitos e componentes React Flow adaptados em `Builder.tsx` e `FlowNode.tsx`; contratos de agente/time substituídos por fluxo |
| `component-editor/` | Primeiro formulário genérico em `SchemaForm.tsx`; Zod → JSON Schema |
| `utils.ts`, `layout-storage.ts` | Dagre para layout do novo domínio; coordenadas serializadas no grafo e medições só na UI |
| `src/styles/global.css`, Tailwind | Tokens claro/escuro preservados e config Tailwind simplificada |
| `layout.tsx`, `sidebar.tsx`, Gatsby | Casca em React Router/Vite; sem Gatsby e sem dependências do backend Python |
| Chat/runview/rendermessage/activitypanel | Pendente: depende dos contratos de execução e WebSocket Node |
| Settings/apikeys e gallery | Pendente: componentes ainda acoplados aos tipos/API antigos |

Essa entrega adapta o núcleo do construtor, e **não copia o frontend inteiro** como se os contratos antigos continuassem válidos.

## SDR Engine

Base: `../sdr-engine/`.

| Origem | Estado / trabalho necessário |
|---|---|
| `src/models/enums.ts` | Portado para shared, incluindo os oito estágios canônicos e aliases legados |
| `src/utils/phone-utils.ts` | Portado com acessos seguros a arrays; revisar matching permissivo por sufixo antes de usá-lo como guarda de autorização |
| `src/services/state-machine.ts` | Portado para flow; suítes originais e adversariais preservadas |
| `evolution-client.ts`, `messaging-provider.ts`, `meta-whatsapp-provider.ts` | Pendente; dependem de configuração global e schemas legados. Injetar credenciais por conexão e distinguir erro de simulação |
| `media-processor.ts` | Pendente; depende dos clientes de transporte/LLM e configuração |
| `memory-service.ts` | Pendente; usa Database.prepare, lead_attributes e consultas síncronas. Portar para Supabase com escopo explícito e transações |
| `handoff-service.ts`, `handoff-notifier.ts` | Pendente; escrita de mensagem/pausa/handoff deve ser atômica e cobrir eco da IA |
| `base-llm`, `openai-service`, `gemini-service`, `llm-factory` | Pendente; remover tipos client/tenant legados e dependências/fallbacks de Antigravity CLI; manter tokens e decisão tipados |
| `crm-service`, `audit-service`, `webhook-dispatcher` | Pendente; substituir SQL SQLite por queries/RPCs e job de saída persistente |
| `models/schemas.ts` | Inventariado; os contratos específicos de webhook/decisão serão extraídos ao portar transporte/LLM. Não copiar schemas de auth, tenant e tabelas duplicadas |
| `tests/phone-utils`, `state-machine`, `state-machine-adversarial` | 43 casos portados |
| Demais testes | Inventariados; exigem adaptação de repositórios e serviços antes da migração |

Não foram portados o orchestrator monolítico, buffer em Map, connection-service de escrita dupla, auth SHA-256, database SQLite, rotas de tabelas WhatsApp duplicadas ou frontend legado.
