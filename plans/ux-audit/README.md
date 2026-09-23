# Auditoria UX — todas as abas do SDR Flow

- **Skills**: `apple-design` (propósito, hierarquia, simplicidade, orientação, retorno ao usuário, familiaridade, responsabilidade) e `dataviz` (onde há gráficos, tabelas e números)
- **Método**: o app rodando no Chromium com **dados realistas simulados**: 10 conversas com histórico, 2 agentes, 3 conexões (conectada, desconectada e com erro), 12 execuções (com falha), 5 documentos, membros, convites, chaves de API e conta Google. Percorri cada aba e as interações principais (abrir conversa, carregar modelo, selecionar nó, validar, abrir agente, detalhe do log, abas de configurações), em 1440×900 e 390×844. As capturas ficam em `img/`.
- **Commit auditado**: `abbc1c8` (depois das 6 fases de design)
- A Dashboard tem auditoria própria: [`../dashboard-ux-audit/README.md`](../dashboard-ux-audit/README.md)

## Relatórios por aba

| Aba | Arquivo | Achados graves |
| --- | --- | --- |
| Atendimento (Inbox) | [inbox.md](inbox.md) | 2 botões de assumir, "Debug" como ação principal, no celular fica inutilizável, horário em AM/PM |
| Conexões WhatsApp | [connections.md](connections.md) | Status "Erro" sem motivo nem ação, excluir em vermelho cheio em todas as linhas |
| Construtor de Fluxos (+ Prompts, Variáveis, Modelos) | [builder.md](builder.md) | **O modelo SDR abre ilegível** (17 nós em uma linha a ~15% de zoom), 3 botões para o mesmo modelo, painel do nó cheio de termos técnicos |
| Agentes de IA | [agents.md](agents.md) | **Métricas inventadas no card** ("Ativo", "IA Ativa", "~850ms" fixos no código), aba da gaveta cortada |
| Base de Conhecimento | [knowledge.md](knowledge.md) | **Promessa falsa**: "100% de precisão e zero alucinações" |
| Logs de Execução | [logs.md](logs.md) | Caminho do topo errado ("Plataforma › Visão Geral"), sem link para a conversa |
| Integrações Externas | [integrations.md](integrations.md) | Termos de infraestrutura para o usuário final (variável de ambiente, VPS, RLS), "Pronto para Conectar" em verde para o que **não** está configurado |
| Configurações + Administração | [settings.md](settings.md) | **Suspender sem confirmação e sem proteção contra suspender a si mesmo**, checkboxes quebrados em Chaves de API, 3 lugares diferentes para adicionar pessoas |

---

## Problemas que se repetem em todo o app

Aparecem em várias abas. Corrigir uma vez resolve em todas.

| # | Problema | Onde | Correção |
| --- | --- | --- | --- |
| T1 | **Datas e horas fora do padrão pt-BR**: `02:21 AM`, `5/7/2026`, `9/28/2026` | Inbox, Configurações (membros, convites), Logs (campos de data) | Um único formatador (`formatDate`, `formatTime`, `formatRelative`) com `Intl` pt-BR, 24h e datas relativas ("há 5 min", "ontem") em listas |
| T2 | **Telefones crus** `5555991000000` / `+5555999990000` em fonte monoespaçada | Inbox, Conexões, contexto do lead | Formatar como `+55 55 99100-0000` na fonte normal |
| T3 | **Ações destrutivas em destaque**: botões vermelhos cheios em todas as linhas (Excluir conexão, Arquivar agente, Suspender, Desconectar) | Conexões, Agentes, Administração, Integrações | Destrutivo fica no menu "⋯" ou como botão discreto. Vermelho só no diálogo de confirmação. A `apple-design` pede para confirmar só o que é realmente destrutivo, e sem que o botão chame mais atenção que a ação principal |
| T4 | **Diálogos nativos `confirm()`** nas exclusões (7 lugares) e **nenhuma** confirmação em Suspender | Todas as exclusões, Administração | Usar o `Modal` do design system com o nome do item e a consequência ("O atendimento dessa instância para imediatamente"). Para ações reversíveis (papel, arquivar), trocar a confirmação por **Desfazer** num aviso rápido |
| T5 | **Jargão técnico na interface**: `guard.chat_type`, `ID: decide...`, `S2S`, `X-API-Key`, `Baileys`, `RLS`, `VPS`, `GOOGLE_CALENDAR_CREDENTIALS_JSON`, "Limiar 0.3", "Produção Livre / Trava de teste", "Estágio Canônico" | Builder, Configurações, Integrações, Conhecimento, Conexões | Linguagem de quem usa. Detalhes técnicos atrás de um "Detalhes técnicos" recolhido, visível só para administradores |
| T6 | **O filtro de instância do header muda as páginas em silêncio** | Inbox, Dashboard, Logs, Builder | Cada página mostra "Instância: Vida Card Principal ▾" no próprio filtro. O seletor global fica só como atalho |
| T7 | **Larguras de página diferentes**: Modelos e Integrações ficam centralizados e estreitos, as outras páginas alinham à esquerda com `max-w-6xl` | Modelos SDR, Integrações | Um só componente de layout de página (título, descrição, ações, conteúdo) |
| T8 | **CSS antigo aplicado a elementos globais**: `label{flex-direction:column}` põe os checkboxes **acima** dos textos em Chaves de API. `button{...}` já causou o problema das abas (resolvido na fase 5) | Configurações › Chaves de API, formulários antigos | Restringir o CSS antigo a classes (`.legacy-form label`) e migrar os formulários restantes para `Input`/`Checkbox` |
| T9 | **Muitas telas não funcionam no celular**: o Inbox mostra lista e conversa lado a lado, o Builder fica com o canvas sem largura | Inbox, Builder | Inbox mestre/detalhe (lista → conversa → voltar). No Builder, mostrar "Editor disponível no computador" com visualização somente leitura |
| T10 | **Títulos pequenos em caixa alta que repetem o H1** ("AGENTES DE ATENDIMENTO & MODELOS", "BASE DE CONHECIMENTO VETORIAL (RAG)", "PAINEL DE CONTROLE ADMINISTRATIVO") | Todas as páginas | Remover ou trocar por contexto útil (período, instância, contagem) |

---

## Prioridade sugerida

| Fase | Itens | Por quê primeiro |
| --- | --- | --- |
| **1 · Confiança** | Métricas inventadas nos cards de Agentes, promessa "100% de precisão", Suspender sem confirmação/proteção, "Pronto para Conectar" em verde, caminho do topo errado em Logs | São telas que **informam errado** ou ações que **podem causar dano**. A `apple-design` põe *Responsabilidade* antes do acabamento |
| **2 · Operação diária** | Inbox (um botão de assumir, Debug no menu, horários pt-BR, prioridade para quem aguarda humano), modelo SDR legível no Builder, checkboxes de Chaves de API | São as telas usadas dezenas de vezes por dia |
| **3 · Padrões transversais** | T1–T8: formatadores pt-BR, ações destrutivas, diálogo de confirmação, filtro de instância visível, layout de página único, jargão | Resolve de uma vez só em todas as abas |
| **4 · Celular** | Inbox mestre/detalhe, Builder somente leitura | Para o operador que atende pelo celular |
| **5 · Dashboard** | Fases A–D da auditoria da Dashboard | Já detalhado no relatório próprio |
