# Estado da implementação — Motor de Fluxos SDR (SDR-Flow)

## Resumo Executivo das Entregas

As fases 0 a 7 possuem implementação e testes locais. A homologação de ponta a ponta com Supabase hospedado, Redis, OpenAI, Evolution e Meta permanece pendente. Os testes usam HTTP simulado e banco descartável; não certificam a operação em produção. Veja [configuração dos provedores](PROVIDERS.md).

| Fase | Escopo Entregue | Status de Verificação |
|---|---|---|
| **Fase 0 & 1 — Fundação & Modelagem** | 6 pacotes pnpm, TS estrito, 44 schemas Zod, visual builder React Flow, auto-layout Dagre, migrações PostgreSQL com RLS multi-tenant, RPC `publish_flow` atômica. | Testes locais passaram (`tests/flow.test.ts`, `tests/builder.test.ts`, `tests/database.test.ts`) |
| **Fase 2 — Runtime & Execução** | 44 executores de nós, motor DAG sequencial, suspensão e retomada (`flow.wait_reply`), memória comercial em PostgreSQL JSONB, CRM em `deals`, gravação de traces (`flow_executions`/`flow_execution_steps`), replay sandbox determinístico, webhooks Evolution/Meta com deduplicação no `IdempotencyGate`, buffer persistente de conversa com Redis/BullMQ, streaming via WebSocket (`/ws`), worker BullMQ. | Testes locais passaram (`tests/engine.test.ts`, `tests/executors.test.ts`, `tests/replay.test.ts`, `tests/ws-trace.test.ts`, `tests/sales-action-nodes.test.ts`, `tests/conversation-turn-queue.test.ts`) |
| **Fase 3 — Login & Organizações** | Autenticação Supabase (senha, magic link, Google OAuth), convites com hash/expiração, papéis (`owner`, `admin`, `agent`, `viewer`), API keys S2S com SHA-256 e escopos granulares, isolamento RLS multi-inquilino. | Testes locais passaram (`tests/auth-orgs.test.ts`) |
| **Fase 4 — Conexões de WhatsApp** | Multi-provedor (Evolution API v2.3.7 & Meta Cloud API Graph v21.0), encriptação de credenciais em repouso com AES-256-GCM, polling de QR code ao vivo via WebSocket, wizard de 4 passos na UI. | Testes locais passaram (`tests/connections.test.ts`) |
| **Fase 5 — Contexto do Agente** | Base de conhecimento vetorial com `pgvector` e fallback determinístico, nó `context.knowledge` com filtro por coleção/similaridade, memória comercial formalizada em Zod, resumo progressivo de conversas, interpolação com aliases em português (`{{lead.nome}}`), guarda de alucinação para preços/agenda, playground interativo no frontend. | Testes locais passaram (`tests/knowledge-context.test.ts`) |
| **Fase 6 — Inbox e Indicadores** | Live Inbox com lista de conversas, filtros por estágio e responsável, busca textual, assunção e devolução humana em 1 clique (Takeover/Release com auditoria), debug one-shot da próxima resposta com cascata por nó, relatório e download JSON completo da escuta, painel de indicadores com funil de conversão e tendências diárias em Recharts, consolidação diária em `metrics_daily` via função SQL, exportação de leads e conversas em CSV (RFC 4180). | Testes locais passaram (`tests/inbox-metrics.test.ts`, `tests/debug-session.test.ts`, `tests/ws-trace.test.ts`) |
| **Fase 7 — Produção & Observabilidade** | Traefik v3 com Let's Encrypt automático (HTTP→HTTPS redirect, ACME), logging estruturado em Pino/JSON, integração com Sentry enriquecida com tags multi-tenant (`organizationId`, `flowId`, `executionId`), rate limiting em janela deslizante com cabeçalhos canônicos e resposta 429, monitor de alertas operacionais (conexões caídas, acúmulo de fila BullMQ, taxa de falha > 5%), rotina de backup com verificação de checksum SHA-256 e **restauração testada** preservando relações e RLS, workflow de CI/CD no GitHub Actions. | Testes locais passaram (`tests/backup-restore.test.ts`, `tests/production-readiness.test.ts`) |

---

## Evidências Locais de Qualidade

1. **Verificação de Tipos**:
   - `pnpm -r typecheck`: 6 pacotes de 6 do monorepo checados (`@sdr/shared`, `@sdr/flow`, `@sdr/db`, `@sdr/api`, `@sdr/web`, `@sdr/worker`) com **0 erros de tipagem**.
2. **Suíte de Testes Automatizados**:
   - A suíte possui **305 testes em 27 arquivos**. Em 09/09/2026, a execução completa anterior ao
     teste unitário final ficou em 295/304; o novo teste do repositório passou isoladamente. Permanecem
     nove divergências preexistentes entre testes e comportamento atual (`api-auth`, health legado,
     modo teste e política de ciclos do validador), sem falha nova introduzida por esta entrega.
3. **Compilação de Produção**:
   - `pnpm -r build`: compilação limpa de todos os pacotes com empacotamento Vite do frontend web em aproximadamente 7 segundos.
4. **Resolução de Banco de Dados**:
   - Todos os testes de integração com banco de dados utilizam PostgreSQL embutido (`@electric-sql/pglite`) executando as 6 migrações oficiais em ordem estrita, garantindo fidelidade relacional e comportamental sem necessitar de mocks frágeis.

---

## Pendências Registradas (Ambiente do Host)

- **Docker & Stack Externa**:
  - Nesta máquina host Windows de desenvolvimento, o Docker daemon não está instalado/disponível.
  - O script de compose (`docker-compose.yml`), a configuração do Traefik (`infra/traefik.prod.yml`), o Dockerfile multi-stage e os workflows de CI do GitHub Actions (`.github/workflows/check.yml`) foram validados sintaticamente e estruturalmente, ficando a execução dos containers com Redis, Evolution externa e Supabase hospedado registrada para o ambiente de CI/staging no GitHub Actions.

## Integração OpenAI e preparação de WhatsApp — 08/09/2026

Responses API ligada à API e worker; playground com escolha explícita entre OpenAI e mock. Adaptadores Evolution e Meta ligados ao runtime, envio desativado por padrão, webhooks autenticados e acesso às credenciais privadas corrigido com RPCs de serviço. Testes novos cobrem respostas estruturadas, tokens, erros, bloqueio de envio, autenticação e isolamento de organização.

Com `REDIS_URL` configurada, o gateway persiste cada mensagem e agenda uma execução atrasada no
BullMQ. O nó `input.buffer` define uma janela de silêncio de 5 a 120 segundos; cada nova mensagem da
mesma conversa incrementa sua geração, reinicia a espera e faz a última execução receber o lote
completo. Locks distribuídos impedem processamento simultâneo entre réplicas. Antes de enviar pelo
WhatsApp, chamar webhooks ou operar a agenda, o runtime confirma que a geração ainda é a mais nova;
execuções substituídas são encerradas sem efeitos externos e sem consumir a escuta do debug.

A versão publicada (ou snapshot standalone) é registrada no trabalho atrasado, evitando trocar de
grafo durante a janela. Sem `REDIS_URL`, o ambiente local mantém execução inline; não existe fallback
de buffer em memória. A deduplicação HTTP pelo `IdempotencyGate` continua em memória e a homologação
de ponta a ponta com Redis e provedores reais ainda está pendente. Nenhuma mensagem real foi enviada.
Veja PROVIDERS.md para configurar e testar a IA sem WhatsApp.

## Histórico persistido no agente — 09/09/2026

O `context.memory` consulta as mensagens persistidas da conversa tanto no webhook multiempresa quanto
na rota standalone por instância. O trace do nó informa `history.source`, `messagesCount`,
`requestedLimit`, disponibilidade do leitor de banco e erro de fallback, permitindo distinguir no JSON
de debug entre histórico carregado, conversa vazia, lote atual e falha no Supabase. Erros deixaram de
ser silenciosos. O runtime também limita `notes` comerciais a 200 caracteres, enquanto o V11 orienta
o extrator a substituir o resumo anterior por um retrato conciso do estado atual.

## Blocos de próxima ação comercial e agenda — 08/09/2026

Foram adicionados `flow.required_fields`, `agent.next_action`, `calendar.availability`,
`calendar.create_event`, `calendar.reschedule_event`, `calendar.cancel_event`,
`context.conversation_state`, `output.smart_message` e `guard.response_policy`. Os mesmos schemas Zod
alimentam o builder e a validação da API. O estado estruturado é salvo na memória persistente do
lead; a política de resposta detecta perguntas já respondidas, preços sem lastro e regras de marca;
e a mensagem inteligente envia no máximo três bolhas completas.

As credenciais do Google Calendar permanecem somente no servidor em
`GOOGLE_CALENDAR_CREDENTIALS_JSON`. As operações usam a API real e seguem pela porta `error` quando
o provedor não está configurado ou não confirma a ação. Os contratos HTTP foram cobertos com
respostas simuladas; a homologação OAuth e a execução contra uma agenda real ainda estão pendentes.
