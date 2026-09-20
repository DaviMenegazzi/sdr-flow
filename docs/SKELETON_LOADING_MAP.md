# Mapa de skeleton loading da interface

Este mapa cobre as superfícies visuais que consultam a API, o Supabase ou um provedor por meio da API. Cargas de conteúdo usam skeletons com a mesma geometria do resultado. Comandos mutáveis mantêm o conteúdo na tela e usam progresso no botão, evitando esconder contexto durante salvar, publicar, excluir, exportar ou assumir uma conversa.

| Superfície | Requisições de leitura | Estado visual durante a carga |
|---|---|---|
| Sessão protegida | Supabase Auth, `organizations`, `organization_members`, `GET /api/me` | Casca completa da aplicação com sidebar, header, KPIs e painéis em skeleton |
| Header global | `GET /api/me/instances` | Seletor do canal ativo em skeleton |
| Dashboard | `GET /connections`, `GET /metrics/dashboard` | Cards de KPI, dois gráficos e comparativo tabular em skeleton |
| Construtor de fluxos | `GET /flows`, `GET /me/agents/:id` | Header, abas, biblioteca, canvas e inspetor em skeleton; seletor de fluxo usa skeleton em recargas |
| Seletor de destinos do nó | `GET /connections/:id/targets` | Linhas de contatos e grupos em skeleton |
| Playground | `POST /flows/:id/playground` | Área de resposta, balões e resumo da execução em skeleton |
| Agentes | `GET /api/me/agents`, `GET /api/me/instances` | Grid de cards de agente em skeleton |
| Conexões | `GET /connections` | Tabela de canais em skeleton |
| Fluxos ativos por conexão | `GET /active-flows` | Grid de vínculos e automações em skeleton |
| QR Code | `GET /connections/:id/qr` e polling de status | Área quadrada do QR em skeleton, tanto no wizard quanto no modal |
| Inbox — lista | `GET /inbox/conversations` | Lista de conversas em skeleton com nome, badges e prévia |
| Inbox — conversa | `GET /inbox/conversations/:id` | Cabeçalho, balões e compositor em skeleton; troca de conversa usa balões em skeleton |
| Inbox — debug | `GET/POST /inbox/conversations/:id/debug` | Fluxo, escuta e passos em skeleton enquanto a sessão é preparada |
| Base de conhecimento | `GET /knowledge` | Grid de documentos em skeleton |
| Busca semântica | `POST /knowledge/search` | Cards de resultados e similaridade em skeleton |
| Integrações | `GET /integrations/calendar/accounts` | Badge, ação e dados da conta em skeleton |
| Agendas Google | `GET /integrations/calendar/accounts/:id/calendars` | Grid de agendas em skeleton |
| Logs de execução | `GET /executions` | Tabela de execuções em skeleton |
| Detalhe da execução | `GET /executions/:id` | Resumo e linha do tempo de passos em skeleton |
| Configurações | `GET /members`, `GET /invitations`, `GET /api-keys` | Tabela correspondente à aba ativa em skeleton |
| Administração | `GET /api/admin/users` | Tabela de usuários em skeleton |

## Regras de interação

- Skeletons possuem anúncio único para leitores de tela e os blocos decorativos são ocultos da árvore de acessibilidade.
- A animação respeita `prefers-reduced-motion`.
- Atualizações silenciosas que já têm conteúdo útil preservam os dados visíveis e mostram progresso no controle de atualização.
- Ações mutáveis continuam usando `loading`/spinner no botão para manter explícito qual comando está em andamento.
