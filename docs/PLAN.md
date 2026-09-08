# Motor de Fluxos SDR — AutoGen Studio como base, funções do SDR Engine portadas

## Context

Existem dois projetos e cada um tem metade do produto desejado.

O **AutoGen Studio** (`~/Desktop/Projetos Dev/auto-gen/python/packages/autogen-studio`) tem a
interface: construtor visual em nós com `@xyflow/react`, biblioteca arrastável, store com
desfazer/refazer, painel de edição por nó e visualização de execução ao vivo. Nesta sessão o
frontend ganhou ainda o painel de chaves de API, os balões de chat com cor por agente, o painel de
atividade e o WebSocket de sessão. O que falta é qualquer noção de WhatsApp, lead ou qualificação.

O **SDR Engine** (`~/Desktop/Projetos Dev/sdr-engine`) tem o motor: recepção de webhook da Evolution
API, agrupamento de mensagens, transcrição de áudio e visão de imagem, memória comercial, máquina de
estados de qualificação, anti-colisão com o vendedor humano e normalização de telefone brasileiro.
O que falta é interface — o frontend é TypeScript puro montando DOM à mão — e a base está corroída
por duplicações estruturais.

**A direção é trazer as funções do SDR Engine para dentro do AutoGen.** O AutoGen é o produto; o SDR
é a fonte das capacidades. O construtor de agentes vira um **editor de fluxos de conversa**: o grafo
desenhado na tela é o caminho que a mensagem do lead percorre até virar resposta no WhatsApp.

### Decisões travadas com o usuário

| Decisão | Escolha |
|---|---|
| Repositório | **Novo, do zero** — traz de cada lado só o que interessa |
| Frontend | **React do AutoGen Studio**, migrado de Gatsby para Vite |
| Backend | **TypeScript/Node** — substitui o FastAPI, absorve os serviços do SDR |
| Fonte de verdade | **Supabase Postgres**, com RLS. SQLite só em testes |
| Hospedagem | **VPS + Docker Compose** |
| Acesso | **Organizações com múltiplos usuários** |

### O que se ganha e o que se perde nessa troca

Trocar o backend Python por TypeScript preserva o frontend inteiro do AutoGen (que já é React/TS) e
evita reescrever os ~4 mil linhas de serviços do SDR que funcionam e têm 25 testes.

O que fica para trás, e precisa de substituto explícito:

| Descartado do AutoGen | Substituto |
|---|---|
| `TeamManager` + AgentChat (times RoundRobin/Selector/Swarm) | Runtime de grafo próprio — o fluxo dita a ordem, não um algoritmo de seleção de falante |
| Sistema de componentes com `provider`/serialização | Catálogo de nós tipado com schema Zod por nó |
| MCP workbench | Nó `action.webhook` + ferramentas registradas no runtime (MCP fica fora do escopo inicial) |
| WebSocket de sessão em FastAPI (feito nesta sessão) | Reimplementado em Node — o protocolo e a lógica de continuidade servem de referência |
| SQLModel / migrações Alembic | Cliente Supabase tipado + SQL versionado |

---

## Diagnóstico do SDR Engine (verificado no código)

O que **não** deve ser portado, e por quê:

1. **Dois modelos de WhatsApp** — `whatsapp_instances` (escopo tenant, `src/api/v1/instances.ts`) e
   `whatsapp_connections` (escopo user, `src/services/connection-service.ts`). Tabelas e rotas
   distintas; o orchestrator lê das duas. Instância criada por um caminho é invisível pelo outro.
2. **Dois sistemas de auth** — `src/api/v1/auth.ts:34` usa SHA-256 sem salt e devolve uma API key
   como token de sessão sem expiração. `src/services/supabase-client.ts` existe configurado, mas não
   participa do login.
3. **Escrita dupla** — `src/services/connection-service.ts:239-287` grava no Supabase e no SQLite e
   engole falha de qualquer um com `console.warn`. Quando divergem, vence quem responder primeiro.
4. **QR code falso** — `src/api/v1/instances.ts:160-177` responde
   `"data:image/png;base64,dryrun_simulated_qrcode"` no fallback e trava o status em `connecting`.
   Não há escuta de `connection.update`.
5. **Pipeline monolítico** — `src/services/orchestrator.ts:195-857` encadeia filtros, buffer, mídia,
   memória, decisão, transição, CRM, handoff e envio numa função só. É exatamente isto que vira o
   grafo visual.
6. **Buffer em memória** — `src/services/message-buffer.ts` usa um `Map` em processo. Restart
   descarta as janelas abertas: o lead escreveu e ninguém responde.

---

## Arquitetura alvo

Repositório novo, monorepo pnpm workspaces:

```
sdr-flow/
├── apps/
│   ├── api/          Express 5 · REST + WebSocket · valida JWT, resolve org
│   ├── worker/       BullMQ · executa fluxos, mídia, webhooks de saída
│   └── web/          Vite + React 18 · canvas, inbox, dashboard
├── packages/
│   ├── shared/       schemas Zod, enums, tipos — usados pelos três apps
│   ├── flow/         catálogo de nós, FlowContext, executor, validador de grafo
│   └── db/           cliente Supabase tipado, queries, tipos gerados
├── supabase/migrations/
├── docker-compose.yml
└── pnpm-workspace.yaml
```

**Vite, não Gatsby.** O AutoGen roda em Gatsby, que é gerador de site estático — nesta sessão cada
rebuild levou 90 segundos e ainda travou num conflito de `ajv`. Isto é uma aplicação com sessão,
WebSocket e canvas interativo.

### O que copiar do frontend do AutoGen

Caminho base: `auto-gen/python/packages/autogen-studio/frontend/src/components/`

| Origem | Destino |
|---|---|
| `views/teambuilder/builder/{builder,store,nodes,library,toolbar,utils,layout-storage,validationerrors}` | O construtor de fluxos — canvas, drag-drop, undo/redo, serialização |
| `views/teambuilder/builder/component-editor/` | Painel de edição por nó, com formulário gerado por schema |
| `views/playground/chat/{rendermessage,chatinput,runview,activitypanel}.tsx` | Inbox de conversas e trace de execução (feitos nesta sessão) |
| `views/settings/view/apikeys.tsx` + `manager.tsx` | Configuração de provedores de IA por organização |
| `views/gallery/` | Biblioteca de fluxos prontos por nicho |
| `layout.tsx`, `sidebar.tsx`, `utils/`, config do Tailwind e tema claro/escuro | Casca da aplicação |

`types/datamodel.ts` é reescrito: os tipos de time e agente do AutoGen dão lugar aos tipos de fluxo,
nó, conexão e lead.

### O que portar do SDR Engine

Caminho base: `sdr-engine/src/`

| Origem | Vira |
|---|---|
| `services/evolution-client.ts`, `messaging-provider.ts`, `meta-whatsapp-provider.ts` | Camada de transporte, atrás dos nós de saída |
| `services/media-processor.ts` | Executor do nó `input.media` |
| `services/memory-service.ts` | Executor do nó `context.memory` |
| `services/state-machine.ts` | Validação dentro de `action.update_stage` |
| `services/handoff-service.ts`, `handoff-notifier.ts` | `guard.human_takeover` e `action.handoff` |
| `services/{base-llm,openai-service,gemini-service,llm-factory}.ts` | Executores dos nós `agent.*` |
| `services/crm-service.ts` | Executor do nó `action.crm_sync` |
| `services/{audit-service,webhook-dispatcher}.ts` | Serviços transversais |
| `utils/phone-utils.ts` | `input.normalize` — nono dígito e formatos BR |
| `models/schemas.ts` (`EvolutionWebhookPayloadHelper`, `AgentDecisionOutput`), `enums.ts` | `packages/shared` |

Não portados: `orchestrator.ts` (vira o runtime), `connection-service.ts` (escrita dupla),
`api/v1/auth.ts` (SHA-256), `api/v1/instances.ts` + `api/connections.ts` (tabela dupla),
`database.ts` (better-sqlite3) e o `frontend/` inteiro.

---

## Fases

### Fase 0 — Repositório e fundação · 2 semanas

- Monorepo pnpm com os seis pacotes, TS estrito, paths compartilhados
- `apps/web`: copiar o frontend do AutoGen e migrar Gatsby → Vite; roteamento, layout, tema
- `apps/api`: Express 5 com os serviços portados do SDR, sem rotas de negócio ainda
- Schema no Supabase, versionado em `supabase/migrations`, **já nascendo com `organizations` e
  `organization_members`** em todas as tabelas de negócio
- Tipos gerados do schema, consumidos por `packages/db`
- `docker-compose.yml` com api, worker, web, redis, evolution
- Suíte Vitest migrada, rodando contra Postgres

**Pronto quando:** `docker compose up` sobe a stack, os 25 testes portados passam contra Postgres, e
a interface do AutoGen abre em Vite com recarga instantânea.

### Fase 1 — Construtor visual de fluxos · 2 semanas

Prioridade declarada. O editor em nós funcionando de ponta a ponta.

- Canvas `@xyflow/react` adaptado do builder do AutoGen, com zoom, minimapa, snap e auto-layout
- Biblioteca lateral por categoria, arrastar e soltar
- Store Zustand com undo/redo (base: `builder/store.tsx`)
- Painel de edição por nó, formulário gerado do schema Zod do tipo
- Validador de grafo: gatilho único, todo caminho termina, sem ciclo sem saída, portas obrigatórias
- Versionamento em `flows` + `flow_versions`; publicar cria versão nova, e conversa em andamento
  continua na versão em que começou
- Fluxo padrão semeado reproduzindo o comportamento atual do `orchestrator.ts`

**Pronto quando:** você monta visualmente o pipeline atual do zero, publica, e o JSON gravado passa
no validador sem ajuste manual.

### Fase 2 — Runtime de execução · 2 semanas

- Registry de executores em `packages/flow`: cada nó implementa `execute(ctx, config)` e devolve a
  porta de saída escolhida
- `FlowContext` com org, conexão, lead, conversa, mensagens do turno, decisão e variáveis
- Redis + BullMQ: o webhook responde 200 em milissegundos e enfileira; o worker executa
- Buffer reescrito como *delayed job* — sobrevive a restart e permite múltiplas réplicas
- Trace em `flow_executions` e `flow_execution_steps` (entrada, saída, duração, erro por nó)
- WebSocket transmitindo cada passo; o nó em execução pulsa no canvas, o que falhou fica vermelho
- Reexecução de trace salvo, para depurar sem gastar WhatsApp
- Idempotência por `message_id` movida do `Map` para o Redis

**Pronto quando:** uma conversa real percorre o grafo ponta a ponta e você assiste ao caminho
acendendo nó a nó enquanto acontece.

### Fase 3 — Login e organizações · 1,5 semana

- Supabase Auth: e-mail e senha, link mágico, Google
- `organizations`, `organization_members` (dono/admin/atendente/leitor), `invitations` com token
- **RLS em todas as tabelas** derivada de `organization_members` — o isolamento passa a ser do banco
- Middleware validando JWT e resolvendo a organização ativa por requisição
- Telas: entrar, criar conta, aceitar convite, trocar de organização, gerenciar time
- API keys preservadas só para integração servidor-a-servidor, com escopo e expiração
- Auditoria amarrada ao usuário real que executou a ação

**Pronto quando:** usuário da org A não alcança dado da org B nem chamando a API direto com o token.

### Fase 4 — Conexões de WhatsApp · 1,5 semana

- Tabela única `connections`, escopo de organização, enum de provedor
- Assistente em passos: nomear → provedor → QR ao vivo → confirmar número
- QR real, renovado ao expirar, com estado vindo de `connection.update` por WebSocket — **o caminho
  simulado deixa de existir**
- Registro automático de webhook por conexão, em URL própria com token
- Verificação de saúde periódica e reconexão automática, com aviso na interface
- Meta Cloud API como segundo provedor, reusando `ConnectionService.verifyMetaCredentials` para
  validar na Graph API antes de salvar
- Credenciais cifradas em repouso, nunca devolvidas por inteiro

**Pronto quando:** conectar do zero leva menos de um minuto, o status bate com a realidade, e
derrubar a Evolution faz a interface avisar e reconectar sozinha.

### Fase 5 — Contexto do agente · 1,5 semana

- Base de conhecimento por organização com `pgvector`: catálogo, preços, objeções, FAQ, documentos
- Nó `context.knowledge` configurável — trechos, limiar de similaridade, coleções
- Memória comercial formalizada em schema tipado, no lugar de chave-valor solto
- Resumo progressivo para conversas longas, para o custo não crescer sem limite
- Variáveis de fluxo com interpolação em textos e prompts (`{{lead.nome}}`)
- Playground rodando o fluxo com contexto real de um lead, mostrando o prompt final e os tokens
- Guarda de alucinação: preço e disponibilidade só saem se vierem da base

**Pronto quando:** o agente cita conteúdo da base da organização e se recusa a inventar preço que
não existe lá.

### Fase 6 — Inbox e indicadores · 2 semanas

- Inbox ao vivo via Supabase Realtime: filtros por estágio e responsável, busca
- Assumir e devolver conversa em um clique, com registro de quem fez
- Painel: funil por estágio, taxa de qualificação, tempo até a primeira resposta, custo por lead
  qualificado, comparação entre fluxos
- Consolidação diária em `metrics_daily` por job agendado, em vez de agregar a cada carregamento
- Gráficos com Recharts respeitando os tokens de tema
- Exportação de leads e conversas em CSV

**Pronto quando:** o painel abre em menos de um segundo com 100 mil mensagens e a inbox mostra
mensagem nova sem recarregar.

### Fase 7 — Produção · 1 semana

- Traefik com Let's Encrypt automático
- Logs com Pino → Loki; erros no Sentry com contexto de organização e fluxo
- `pg_dump` agendado para armazenamento externo, com **restauração testada**
- Health checks, política de reinício, rate limit por organização
- GitHub Actions: build, testes e imagem a cada merge na principal
- Alertas para conexão caída, fila acumulando e taxa de erro acima do limite

---

## Catálogo de nós (31)

**Gatilhos** — `trigger.message_received`, `trigger.schedule`, `trigger.manual`

**Guardas** — `guard.test_mode`, `guard.human_takeover`, `guard.business_hours`, `guard.chat_type`

**Entrada** — `input.buffer`, `input.media`, `input.normalize`

**Contexto** — `context.memory`, `context.knowledge`, `context.crm`, `context.summarize`

**Inteligência** — `agent.decide`, `agent.classify`, `agent.extract`, `agent.score`

**Controle** — `flow.condition`, `flow.switch`, `flow.delay`, `flow.wait_reply`

**Ações** — `action.update_stage`, `action.update_lead`, `action.crm_sync`, `action.handoff`,
`action.webhook`

**Saída** — `output.send_text`, `output.send_media`, `output.send_template`, `output.end`

Cada nó expõe um schema Zod que o painel de edição transforma em formulário. Adicionar um tipo novo
é registrar um executor e um schema, sem tocar na interface.

---

## Tabelas

| Tabela | Papel | Fase |
|---|---|---|
| `organizations` | A empresa. Dona de conexões, fluxos, leads e base | 0 |
| `organization_members` | Vínculo usuário↔org com papel. Base de toda RLS | 0 · 3 |
| `invitations` | Convite por e-mail com token e expiração | 3 |
| `connections` | Conexão de WhatsApp unificada | 4 |
| `flows` | Fluxo nomeado com a versão publicada em vigor | 1 |
| `flow_versions` | Grafo serializado por versão | 1 |
| `flow_executions` | Execução do grafo para um turno de conversa | 2 |
| `flow_execution_steps` | Passo a passo por nó. Alimenta trace e replay | 2 |
| `knowledge_documents` | Trechos com embedding em `pgvector` | 5 |
| `conversation_summaries` | Resumo progressivo | 5 |
| `metrics_daily` | Consolidação diária | 6 |

`leads`, `conversations`, `messages` e `deals` são recriados a partir do schema do SDR, ganhando
`organization_id` e políticas de RLS.

---

## Infraestrutura

```yaml
services:
  traefik      # :80 :443 · Let's Encrypt automático
  web          # build Vite servido por Nginx
  api          # Node 22 · REST + WS · sem estado
  worker       # Node 22 · consumidores BullMQ
  evolution    # Baileys · volume persistente
  redis        # fila, buffer, idempotência, cache

volumes:
  evolution_instances   # sessões WhatsApp — perder isto derruba todos os números
  redis_data
  traefik_certs

# Postgres no Supabase gerenciado, via DATABASE_URL
```

**Dimensionamento:** 4 vCPU / 8 GB / 80 GB atende o começo. O gargalo é a Evolution — cada número
conectado mantém uma sessão Baileys viva consumindo 150–250 MB. Acima de ~20 números, separar a
Evolution numa segunda máquina; api e worker não têm estado e escalam horizontalmente.

**Não pode faltar:** `evolution_instances` no backup, Redis com persistência ligada, segredos em
arquivo fora do repositório, e só o Traefik expondo porta ao mundo.

---

## Sequência e dependências

Total ~13,5 semanas em série.

- Fase 2 precisa da 1 — sem grafo salvo não há o que executar
- Fase 4 precisa da 3 — a conexão unificada nasce com escopo de organização; criá-la antes obrigaria
  migrar de novo
- Fase 6 precisa da 2 — o painel mede execuções de fluxo
- Fase 5 é a única adiantável ou adiável sem quebrar nada (é aditiva)

---

## Riscos

1. **Migração das duas tabelas de WhatsApp** — a única que pode perder dado. Script com tabela de
   conferência lado a lado, rodado primeiro contra uma cópia de produção comparando contagens.
2. **`flow.wait_reply` e republicação** — a espera é indeterminada. A versão do fluxo fica gravada na
   *execução*, não na conversa, para a retomada continuar na versão certa.
3. **Custo de contexto crescendo em silêncio** — registrar tokens por execução desde a Fase 2, antes
   de existir painel, para o dado já estar lá quando você for olhar.
4. **Bloqueio de número** — Baileys é biblioteca não oficial. Manter a simulação de digitação e o
   atraso de leitura ligados; oferecer a Meta Cloud API como caminho oficial para quem tem volume.
5. **Perda das capacidades do AutoGen** — se depois fizer falta orquestração multi-agente de verdade
   (times que discutem entre si) ou MCP, será preciso reimplementar em TS. Vale confirmar na Fase 1
   se o grafo sequencial atende os casos de uso reais antes de investir nas fases seguintes.

---

## Verificação

**Fase 0** — `docker compose up -d` sobe seis containers saudáveis; `pnpm test` passa os testes
portados contra Postgres; a interface abre em `localhost:5173` com HMR funcionando.

**Fase 1** — Abrir `/flows/new`, arrastar os nós do pipeline atual, conectar, publicar. Conferir o
JSON gravado em `flow_versions` e rodar o validador contra ele.

**Fase 2** — Com modo teste ligado e o próprio número na lista: enviar mensagem no WhatsApp e
assistir ao canvas acendendo nó a nó. Depois reexecutar o trace salvo e comparar o resultado.

**Fase 3** — Criar duas organizações com usuários distintos. Com o JWT do usuário A, chamar
`GET /api/leads` e confirmar que nenhum lead da org B aparece. Repetir consultando o Postgres direto
com o token do A, para provar que a RLS segura mesmo sem a aplicação no caminho.

**Fase 4** — Conectar um número do zero cronometrando. Derrubar o container da Evolution
(`docker compose stop evolution`) e confirmar que a interface marca desconectado e reconecta ao
subir de volta.

**Fase 5** — Perguntar ao agente um preço que existe na base e outro que não existe. O primeiro deve
citar a fonte; o segundo deve encaminhar para humano em vez de inventar.

**Fase 6** — Semear 100 mil mensagens e medir o tempo de carga do painel. Enviar mensagem com a inbox
aberta e confirmar que aparece sem refresh.

**Fase 7** — `docker compose kill api` e confirmar que volta sozinho. Restaurar o backup mais recente
num banco limpo e conferir as contagens.
