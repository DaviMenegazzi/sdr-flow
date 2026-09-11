# 🚀 SDR Flow — Documento Completo de Arquitetura, Contexto e Handoff Técnico

> **Data de Atualização:** 08/09/2026  
> **Finalidade:** Transferência de contexto completa (*Handoff*) para continuidade do desenvolvimento com GPT ou nova equipe de engenharia.  
> **Repositório GitHub:** `https://github.com/DaviMenegazzi/sdr-flow.git`  
> **Ambiente de Produção (VPS):** `https://sdr.147.93.10.249.sslip.io`  

---

## 📌 1. O Que É o SDR Flow

O **SDR Flow** é uma plataforma SaaS empresarial de automação comercial e qualificação de leads via **WhatsApp** com Inteligência Artificial generativa. 

A plataforma permite que gestores e times de vendas desenhem **fluxos visuais orientados a grafos (nós e conexões)** que definem exatamente como o agente autônomo (SDR) deve acolher o lead, filtrar números em teste, extrair dados cadastrais, consultar bases de conhecimento institucionais (RAG), avaliar a temperatura do lead, enviar mensagens dinâmicas e realizar o **transbordo qualificado (*handoff*)** para consultores humanos quando o lead estiver pronto para fechamento.

---

## 🏗️ 2. Arquitetura do Projeto e Monorepo

O projeto é estruturado como um monorepo moderno gerenciado via **pnpm workspaces**:

```
sdr-flow/
├── apps/
│   ├── api/          # Backend Express.js + TypeScript (Porta 3001)
│   │   ├── src/
│   │   │   ├── app.ts                 # Configuração de rotas, middlewares e APIs
│   │   │   ├── storage.ts             # Persistência Standalone em JSON (store.json)
│   │   │   ├── webhook.ts             # Processador de webhooks da Evolution API
│   │   │   └── whatsapp/              # Clientes HTTP e Connection Manager
│   │   └── data/store.json            # Banco de dados local standalone
│   └── web/          # Frontend SPA React 18 + Vite + TypeScript (Porta 5173 / Nginx)
│       ├── src/
│       │   ├── builder/               # Editor visual de fluxos (React Flow / Canvas)
│       │   ├── inbox/                 # Tela de atendimento humano e chat em tempo real
│       │   ├── knowledge/             # Base de conhecimento e busca semântica RAG
│       │   ├── connections/           # Gerenciador de instâncias WhatsApp e QR Code
│       │   └── simulator/             # Simulador de conversa / Playground interativo
├── packages/
│   ├── db/           # Repositórios Supabase / PostgreSQL (banco na nuvem)
│   │   └── src/
│   │       ├── inbox-repository.ts     # CRUD de conversas, mensagens e leads
│   │       ├── knowledge-repository.ts # Busca vetorial e embeddings
│   │       └── connection-repository.ts
│   ├── flow/         # Motor de execução do grafo (Engine)
│   │   └── src/
│   │       ├── catalog.ts             # Catálogo dos 33 nós, schemas Zod e portas
│   │       ├── validate.ts            # Validador estrutural de grafos
│   │       ├── engine.ts              # FlowEngine (orquestrador nó a nó)
│   │       ├── playground.ts          # Executor de simulação em memória
│   │       └── executors/index.ts     # Lógica de execução de cada tipo de nó
│   └── shared/       # Schemas Zod universais, tipos e utilitários
│       └── src/
│           ├── index.ts               # flowGraphSchema, flowNodeSchema, flowEdgeSchema
│           └── phone.ts               # Normalização E.164 brasileira
└── docs/             # Playbooks e documentações técnicas
```

---

## ⚖️ 3. Arquitetura Dual: Standalone vs Supabase

O SDR Flow foi projetado para operar com excelência em **dois modos híbridos**:

1. **Modo Standalone (Produção Atual na VPS):**
   - Não requer login nem configuração de autenticação por JWT para operar o construtor, conexões e conhecimento.
   - Armazena configurações, instâncias locais, bases de conhecimento e histórico em `apps/api/data/store.json`.
   - Gera embeddings de fallback localmente para busca semântica por cosseno sem custo extra.
2. **Modo Supabase (Persistência e Histórico de Chat):**
   - URL: `https://mppsvwqjmlvgsakqtpiw.supabase.co`
   - Todas as mensagens reais recebidas pelo WhatsApp são persistidas nas tabelas `leads`, `conversations` e `messages`.
   - Utiliza a `SERVICE_ROLE_KEY` no backend para ignorar travas de RLS e garantir entrega em tempo real mesmo em modo standalone.

---

## 💻 4. Funcionalidades e Módulos da Plataforma

### 4.1. Construtor Visual de Fluxos (`/builder`)
- Interface baseada em nós com zoom, arrastar e soltar e conexão de portas;
- **Biblioteca com 33 nós categorizados** (Gatilhos, Guardas, Entrada, Contexto, Agentes de IA, Controle de Fluxo, Ações Comerciais e Saídas);
- Validação estrita em tempo real: impede a publicação de fluxos com portas soltas, nós sem término ou loops inválidos;
- Exportação e importação completa em formato `.json`.

### 4.2. Base de Conhecimento RAG (`/knowledge`)
- Cadastro categorizado de conhecimento em 5 coleções:
  - 💳 **Preços & Planos** (`pricing`)
  - 🩺 **Catálogo & Serviços** (`catalog`)
  - ❓ **Dúvidas & FAQ** (`faq`)
  - 🛡️ **Objeções de Vendas** (`objections`)
  - 📋 **Políticas & Diretrizes** (`documents`)
- **Geração automática de embeddings** e cálculo de tokens no salvamento;
- **Testador de Busca Semântica Interativo**: permite digitar uma pergunta e ver qual documento a IA recupera e com qual score de similaridade;
- Modelos prontos com 1 clique para agilizar o preenchimento.

### 4.3. Conexões do WhatsApp & QR Code (`/connections`)
- Comunicação direta com a **Evolution API** rodando localmente na VPS;
- Criação de novas instâncias com 1 clique;
- Exibição de QR Code em tempo real para escaneamento;
- Exibição das instâncias ativas, status de conexão (*open*, *connecting*, *close*) e webhook configurado automaticamente;
- Seção de **Fluxos Ativos** exibindo qual fluxo está rodando em qual instância e se o **Modo Teste** está ativo.

### 4.4. Simulador / Playground Interativo
- Permite testar o fluxo criado em uma tela de chat idêntica ao WhatsApp sem gastar mensagens reais nem queimar números;
- Exibe o rastreio nó a nó da execução, tokens consumidos e variáveis geradas pela IA.

### 4.5. SDR Inbox de Atendimento Humano (`/inbox`)
- Interface no padrão WhatsApp Web com três colunas:
  - **Coluna Esquerda:** Lista de conversas ordenadas por última mensagem, filtros por status (Todos, IA, Humano), estágio do funil e busca textual.
  - **Coluna Central:** Histórico completo de mensagens com identificadores visuais (*Lead*, *SDR Flow IA*, *Atendente Humano*), banner de aviso quando o robô está ativo, botão de **Assumir Conversa** e campo para envio de mensagens manuais.
  - **Coluna Direita:** Contexto do lead, dados cadastrais, negócio no CRM e memória comercial acumulada.
- **Auto-polling em tempo real**: busca novas conversas a cada 5s e novas mensagens da conversa ativa a cada 4s.

---

## 🛠️ 5. O Que Foi Feito Recentemente (Últimas Modificações)

### A. Correção Completa do Inbox e Envio Real no WhatsApp
- **Diagnóstico:** O webhook da Evolution API recebia as mensagens e gravava no Supabase, mas a tela `/inbox` ficava vazia por causa de uma trava rígida `if (!session || !activeOrg) return;` e uma chamada para `/api/organizations/undefined/inbox`.
- **Backend (`apps/api/src/app.ts`):**
  - Criado o roteador público `/api/inbox` com endpoints para listar conversas (`/conversations`), ver mensagens (`/conversations/:id`), assumir (`/takeover`), devolver (`/release`), mudar estágio (`/stage`) e enviar mensagens (`/messages`).
  - Integrado o disparo real do WhatsApp: ao digitar no inbox e clicar em Enviar, o backend grava a mensagem humana no Supabase **e dispara o texto imediatamente para o WhatsApp do cliente via Evolution API** (`sendTextMessage`).
- **Frontend (`apps/web/src/inbox/InboxPage.tsx`):**
  - Removidas as barreiras de sessão, implementada a rota `/api/inbox` em modo standalone e adicionado auto-polling silencioso para atualização em tempo real sem flickers.

### B. Diagnóstico e Correção de Erros de Fluxos
- Diagnosticado erro em fluxo JSON do usuário:
  - Porta inexistente `qnt_mensagens_segmentadas` no nó `agent.structured`;
  - Porta `default` desconectada;
  - Saída `next` do nó `output.send_text` solta (causando erro `no_termination`);
  - Sintaxe com caractere extra em `"times": "{{structured.repeat_count}})"`.
- Gerado arquivo JSON 100% corrigido e validado: `fluxo-sdr-corrigido.json`.

### C. Geração de Playbooks de Engenharia
- **`PLAYBOOK_CONSTRUTORES_SDR_FLOW.md`**: Explica detalhadamente o que cada um dos 33 nós faz, sua lógica interna e suas variáveis.
- **`PLAYBOOK_ESTRUTURACAO_JSON_SDR_FLOW.md`**: Especificação técnica estrita do schema Zod para criação e validação de arquivos JSON de fluxos.

---

## 🌐 6. Infraestrutura, VPS e Deploy

### Dados da VPS:
- **IP:** `147.93.10.249`
- **Usuário:** `root`
- **URL Pública:** `https://sdr.147.93.10.249.sslip.io`
- **Serviço Backend:** Gerenciado pelo systemd: `systemctl status sdr-flow`
- **Serviço Frontend:** Nginx servindo os arquivos estáticos compilados em `/var/www/sdr-flow/` e redirecionando `/api/` para `http://127.0.0.1:3001`
- **Evolution API (Docker):** Rodando em `http://127.0.0.1:8080`

### Como Atualizar o Projeto na VPS:
Na VPS, existe um script automatizado que baixa o código do GitHub, compila e reinicia os serviços:
```bash
/root/sdr-flow/update.sh
```
O script executa:
1. `git pull origin main`
2. `pnpm install --no-frozen-lockfile`
3. `pnpm -r build`
4. `cp -r apps/web/dist/* /var/www/sdr-flow/`
5. `systemctl restart sdr-flow`

### Arquivo de Configuração `.env` na VPS (`/root/sdr-flow/.env`):
- `PORT=3001`
- `SUPABASE_URL=https://mppsvwqjmlvgsakqtpiw.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `EVOLUTION_SERVER_URL=http://127.0.0.1:8080`
- `EVOLUTION_API_KEY=...`
- `PUBLIC_API_URL=https://sdr.147.93.10.249.sslip.io`
- `OPENAI_API_KEY=...`

---

## 🎯 7. Sugestões e Próximos Passos Recomendados para o GPT

1. **Segmentação Automática de Mensagens na Saída**:
   - Em vez de forçar o usuário a desenhar nós de loop complexos no canvas para enviar 2 ou 3 mensagens curtas, criar uma opção no nó `output.send_text`: `"splitParagraphs": true` ou `"maxLinesPerBubble": 2`. Quando ativada, se a IA responder 2 parágrafos, o próprio executor do nó envia as mensagens sequencialmente com um pequeno delay humanizado de digitação entre elas.
2. **WebSocket para o Inbox (Push em vez de Polling)**:
   - A base para WebSocket já existe em `apps/api/src/ws.ts`. O GPT pode plugar o hook do frontend no WebSocket para que novas mensagens apareçam instantaneamente sem precisar esperar o intervalo de 4 segundos do polling.
3. **Filtro de Instância Ativa no Inbox**:
   - Conectar o dropdown de instâncias no topo do inbox para alternar a visualização caso o cliente possua mais de um WhatsApp conectado.
4. **Exportação / Backup de Conversas**:
   - Permitir exportar relatórios de atendimento ou métricas de conversão dos leads atendidos pelo SDR.
