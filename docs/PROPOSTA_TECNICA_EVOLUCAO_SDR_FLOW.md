# 📋 Proposta Técnica de Implementação: Evolução do SDR Flow

> **Autor:** Antigravity (Pair Programming Assistant)  
> **Data:** 10/09/2026  
> **Status:** Aprovado para execução sequencial imediata  
> **Diretriz de Deploy:** Implementar localmente, validar via testes e build. **NÃO comitar e NÃO puxar para o GitHub** até ordem expressa do usuário.  
> **Premissa Fundamental de UX:** **Zero código para o usuário final**. Tudo deve ser operado através de seletores visuais, dropdowns pesquisáveis, chips/tags interativos e abas de visualização rápida.

---

## 🎯 Sumário Executivo das 4 Demandas

| Item | Módulo | Objetivo Central | Abordagem de UX |
| :--- | :--- | :--- | :--- |
| **1** | **Filtro de Conexão (Gate)** | Portão de entrada que interrompe a execução se o contato OU grupo não estiver na lista permitida. | Seletor visual com abas de Contatos e Grupos, chips removíveis e busca de contatos sincronizados. |
| **2** | **Envio Multidestino (Finalização)** | Enviar mensagens para um ou mais contatos e/ou grupos por instância sem digitar IDs manualmente. | Dropdown pesquisável com badges (👤 Contato / 👥 Grupo) alimentado por sync em tempo real da Evolution API. |
| **3** | **Conexões Externas & Google Calendar** | Eliminar chaves manuais de API; conectar Google Calendar via login OAuth 2.0 nativo de forma modular. | Nova seção "Conexões Externas" com cards de integração e fluxo "Conectar com Google" em 1 clique. |
| **4** | **Central de Prompts, RAG e Variáveis** | Visualizar e editar todos os prompts, bases de conhecimento e conexões de variáveis em uma tela única. | Navegação por abas no topo do Construtor: *1. Fluxo Visual*, *2. Central de Prompts & RAG*, *3. Mapa de Variáveis*. |

---

## 🧭 1. Ordem de Prioridade e Sequência Técnica de Execução

Recomendamos a seguinte sequência linear de implementação:

```
[Passo 1: Item 4] ──► [Passo 2: Item 1] ──► [Passo 3: Item 2] ──► [Passo 4: Item 3]
  Abas no Builder      Gate Contatos/Grupos   Envio Multidestino     OAuth Google Calendar
  (Prompts & Vars)      (Segurança no fluxo)   (Sync Evolution API)   (Módulo de Integrações)
```

### Justificativa da Ordem:
1. **Passo 1 (Item 4 - Abas no Builder):** Dá visibilidade instantânea de todo o fluxo. Facilita o teste e o refinamento dos blocos seguintes sem precisar abrir modais repetidamente.
2. **Passo 2 (Item 1 - Filtro Gate):** É um elemento de segurança operacional crítico para impedir que testes em andamento disparem mensagens indevidas em contatos ou grupos reais.
3. **Passo 3 (Item 2 - Envio Multidestino):** Reutiliza a infraestrutura de comunicação e sincronização de contatos da Evolution API iniciada no Passo 2.
4. **Passo 4 (Item 3 - Conexões Externas & OAuth):** Módulo autônomo e de maior escopo que introduz autenticação externa e rotas de callback sem impactar o motor visual existente.

---

## 🔍 2. Proposta Detalhada por Demanda

---

### 🛡️ Demanda 1: Bloco de Filtro de Conexão (Gate de Mensagens Recebidas)

#### A. Comportamento Esperado
- Posicionado imediatamente após o nó `trigger.message_received`.
- Funciona como um portão:
  - Se a mensagem veio de um **contato individual** liberado ➔ avança pela porta `pass`.
  - Se a mensagem veio de um **grupo** liberado (ex: grupo de testes interno da agência) ➔ avança pela porta `pass`.
  - Se o remetente não estiver na lista ➔ a mensagem morre na porta `blocked` (que deve ser ligada a um `output.end` silencioso).
- Fácil manutenção: lista centralizada sem precisar editar múltiplos nós do fluxo.

#### B. Arquitetura Técnica
1. **Evolução do Nó `guard.test_mode` (Retrocompatível):**
   - Schema de configuração (`catalog.ts` & `shared/src/index.ts`):
     ```typescript
     'guard.test_mode': z.strictObject({
       enabled: z.boolean().default(true),
       allowedPhones: z.array(z.string()).default([]),    // Contatos (telefones E.164 ou nomes)
       allowedGroups: z.array(z.string()).default([]),    // IDs/JIDs de grupos (ex: 120363...@g.us)
       mode: z.enum(['whitelist', 'blacklist']).default('whitelist'),
       actionOnBlock: z.enum(['drop', 'notify_admin']).default('drop'),
     })
     ```
2. **Execução no Motor (`packages/flow/src/executors/index.ts`):**
   - Identifica se a mensagem veio de grupo: `isGroup = ctx.lead.phone.includes('@g.us') || ctx.variables.isGroup`.
   - Se for grupo: valida se o JID do grupo consta em `allowedGroups`.
   - Se for individual: valida se o número bate com `allowedPhones` utilizando `isPhoneNumberMatch`.
   - Se validado: retorna `{ port: 'pass' }`. Caso contrário: `{ port: 'blocked', output: { reason: 'Bloqueado pelo Gate de Conexão' } }`.

#### C. Interface Visual (UI 100% User-Friendly)
- Substituir o campo de array técnico por um **Gerenciador Visual de Permissões**:
  - Duas abas: **📱 Contatos Liberados** e **👥 Grupos Liberados**.
  - **Dropdown sincronizado**: se a instância WhatsApp estiver conectada, exibe dropdown para selecionar contatos e grupos com 1 clique.
  - **Entrada rápida manual**: campo de telefone com máscara brasileira automática `(XX) XXXXX-XXXX`.
  - **Badges/Chips coloridos**: cada contato/grupo adicionado vira uma etiqueta visual com botão `(X)` para exclusão instantânea.

#### D. Trade-offs e Mitigações
- *Trade-off:* Grupos no WhatsApp possuem IDs longos e ininteligíveis (ex: `120363371648139968@g.us`).
- *Solução:* A plataforma armazena o par `{ id, name }`, exibindo sempre o nome amigável do grupo na tela (ex: *"Grupo Teste SDR"*).

---

### 📤 Demanda 2: Bloco de Finalização — Envio Multidestino (Contatos e/ou Grupos)

#### A. Comportamento Esperado
- Permitir que o nó de envio de mensagem envie não apenas para o lead que chamou o bot, mas também para **destinatários fixos escolhidos pelo operador** (ex: avisar grupo de corretores, alertar o gestor ou fazer broadcast controlado).
- **Requisito Não-Negociável:** Seleção via **dropdown pesquisável por texto**, nunca digitação de IDs técnicos.

#### B. Arquitetura Técnica
1. **Novo Endpoint no Backend (`apps/api/src/app.ts`):**
   - `GET /api/connections/instances/:instanceName/targets`
   - Consulta a Evolution API:
     - `/group/fetchAllGroups/{instanceName}?getParticipants=false`
     - `/chat/findChats/{instanceName}`
   - Retorna lista unificada e limpa:
     ```json
     [
       { "id": "555599238476@s.whatsapp.net", "name": "Davi Menegazzi", "type": "contact", "phone": "555599238476" },
       { "id": "120363371648139968@g.us", "name": "Vendas Vida Card - Plantão", "type": "group" }
     ]
     ```
   - Mecanismo de cache em memória (TTL: 5 minutos) com botão de "🔄 Sincronizar Agora" para atualização instantânea.
2. **Evolução do Nó `output.send_text`:**
   - Schema de configuração:
     ```typescript
     'output.send_text': z.strictObject({
       text: text('{{decision.reply}}', 'Mensagem'),
       typing: z.boolean().default(true),
       targetMode: z.enum(['active_lead', 'specific_targets', 'both']).default('active_lead'),
       targets: z.array(z.string()).default([]), // Lista de JIDs selecionados no dropdown
     })
     ```
3. **Execução no Motor:**
   - Se `targetMode === 'active_lead'`: envia para `ctx.lead.phone`.
   - Se `targetMode === 'specific_targets'`: itera sobre `targets` e dispara para cada contato/grupo via `evolutionClient.sendTextMessage`.
   - Se `targetMode === 'both'`: dispara para o lead ativo e também para os alvos selecionados.

#### C. Interface Visual (UI Dropdown com Busca)
- Componente `SearchableTargetSelect`:
  - Campo de busca em tempo real com ícone de lupa.
  - Resultados filtrados com badges visuais:
    - 👤 **Contato:** Nome + Telefone formatado.
    - 👥 **Grupo:** Nome do Grupo + Quantidade de participantes.
  - Seleção múltipla com contagem (*"3 destinos selecionados"*).

---

### 📅 Demanda 3: Conexões Externas & Integração Google Calendar via OAuth

#### A. Comportamento Esperado
- Zero chaves manuais (API keys). O usuário clica em "Conectar Google Calendar", faz login na conta Google e autoriza o acesso.
- Aba dedicada **"Conexões Externas"** no menu lateral (`/integrations`), projetada para ser extensível para futuras integrações (ex: CRMs, Webhooks OAuth, Slack).

#### B. Arquitetura Técnica
1. **Estrutura Modular de Conectores (`apps/api/src/integrations/`):**
   ```
   apps/api/src/integrations/
   ├── index.ts                # Gerenciador unificado de conectores
   ├── base-connector.ts       # Interface padrão (connect, disconnect, getStatus, refreshToken)
   └── google/
       ├── google-calendar.ts  # Implementação Google Calendar (OAuth2 + Calendar API v3)
       └── types.ts
   ```
2. **Fluxo OAuth 2.0:**
   - `GET /api/integrations/google/auth-url`: Retorna URL de consentimento com escopo `calendar.events`.
   - `GET /api/integrations/google/callback`: Recebe o `code` de autorização e obtém `access_token` e `refresh_token`.
   - `GET /api/integrations/status`: Lista todos os conectores e seus status (conectado, desconectado, e-mail da conta).
   - `POST /api/integrations/google/disconnect`: Revoga tokens e limpa a sessão.
3. **Armazenamento Seguro:**
   - Tokens salvos de forma isolada em `apps/api/data/store.json` sob a chave `integrations.google`.
   - Renovação automática transparente do `access_token` antes de cada operação caso expire.
4. **Novos Nós no Fluxo:**
   - `action.calendar_schedule`: Cria evento na agenda (reserva de consulta/reunião) utilizando a conta Google conectada.
   - `context.calendar`: Consulta horários vagos e ocupados para informar ao cliente no chat.

#### C. Interface Visual
- Página `/integrations` na barra lateral com design em Cards Modernos:
  - 📅 **Google Calendar:** Exibe avatar do usuário, e-mail autorizado (`dr.joao@gmail.com`), lista de agendas detectadas e botão "Desconectar".
  - 💼 **HubSpot / CRM (Em breve):** Card desativado indicando modularidade futura.

---

### 👁️ Demanda 4: Visibilidade e Edição de Prompts, RAG e Variáveis do Fluxo

#### A. Comportamento Esperado
- Eliminar a necessidade de abrir nó por nó para saber o que a IA está instruída a fazer.
- Ter uma navegação por abas superiores no Construtor de Fluxos:
  - **Aba 1: 🗺️ Construtor Visual** (Canvas do React Flow atual).
  - **Aba 2: ✍️ Central de Prompts & Conhecimento** (Tabela consolidada com edição in-place).
  - **Aba 3: 🔄 Mapa de Variáveis & Dependências** (Rastreio de quem gera e quem consome cada dado).

#### B. Arquitetura da Interface da Aba 2 (Central de Prompts & RAG)
- Varre os nós do fluxo buscando nós que contenham prompts ou coleções:
  - `agent.decide`, `agent.classify`, `agent.extract`, `agent.score`, `agent.structured`, `context.knowledge`.
- Exibe um painel de cartões limpos e expansíveis:
  - **Cabeçalho do Bloco:** Ícone da categoria, Tipo (`agent.decide`), Nome dado ao bloco (`"Qualificação de Vendas"`) e Modelo ativo (`OpenAI / default`).
  - **Base de Conhecimento Vinculada:** Se houver um nó de conhecimento anterior ou vinculado, exibe badge destacada (ex: `🩺 Coleção: Catálogo de Serviços` ou `💳 Coleção: Preços e Planos`).
  - **Editor Direto de Prompt:** Um campo de texto amplo com auto-save. Qualquer alteração feita aqui atualiza o nó do fluxo imediatamente no estado global do builder, sem precisar abrir o canvas.
  - **Contador de Palavras e Tokens Estimados** em tempo real.

#### C. Arquitetura da Interface da Aba 3 (Mapa de Variáveis e Dependências)
- **Representação Visual Clara (Sem código):**
  - O sistema analisa as conexões e os nós:
    - **Origem (Produtores):** Nós que geram dados (ex: `agent.decide` gera `{{decision.reply}}` e `{{decision.handoff}}`; `agent.extract` gera `{{decision.lead_data}}`).
    - **Destino (Consumidores):** Nós que usam interpolação `{{...}}` em seus campos (ex: `output.send_text` consome `{{decision.reply}}`; `flow.condition` consome `{{decision.handoff}}`).
  - Apresentação em formato de **Cartões de Linhagem de Dados**:
    ```
    ┌─────────────────────────────────┐
    │  Variável: {{decision.reply}}    │
    │  🟢 Gerada em: [Decisão da IA]  │
    │  ──► Consumida em:               │
    │      └─ [Enviar WhatsApp]       │
    └─────────────────────────────────┘
    ```
  - **Alerta de Inconsistência:** Se uma variável for consumida antes de ser gerada, um aviso em amarelo avisa o usuário visualmente.

---

## 🔒 3. Diretrizes de Segurança e Controle de Versão

- **Git Status:** As alterações serão desenvolvidas e testadas localmente. **Nenhum `git commit` ou `git push` será executado até validação prévia do usuário**.
- **Retrocompatibilidade:** Nenhum fluxo existente em produção sofrerá quebra estrutural.
- **Validação:** Todas as alterações devem manter `pnpm typecheck` e `pnpm -r build` aprovados com código 0.
