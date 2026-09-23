# Auditoria visual de UX — elemento por elemento

**O que é:** para cada tela, cada botão, input, select e bloco de dados foi **numerado na captura** (`img/`) e recebeu uma decisão: fica visível, vai para um menu "⋯", abre num card flutuante, ganha outra aba/página, aparece só no hover, é redesenhado ou é removido. As medidas (altura, canto, fonte e cor de **460 elementos em 20 estados de tela**) estão em `elements.json`.

**Skills:** `apple-design` (hierarquia, simplicidade, agrupamento, retorno), `emil-design-eng` (acabamento de componentes, formato Antes/Depois/Por quê) e `dataviz` (tabelas, números e densidade de dados). A escolha de biblioteca de componentes fica para a skill `/pick-ui-library`, que só roda quando você a chama.

**Método:** o app rodando com dados realistas simulados, em 1440×900, tema escuro.

## Legenda das decisões

| Símbolo | Decisão | Quando usar |
| --- | --- | --- |
| ✅ | **Manter** como está | Já está no lugar e na forma certos |
| ⭐ | **Promover** | Vira a ação principal da tela ou do card |
| ⋯ | **Menu de ações** | Ação ocasional ou destrutiva: vai para um botão "⋯" que abre uma lista |
| 🪟 | **Popover** (card flutuante) | Configuração ou detalhe que só se consulta às vezes: um botão abre um card ancorado a ele |
| 🗂️ | **Outra aba ou página** | Um conjunto grande que compete com a tarefa principal da tela |
| 👆 | **Só no hover ou na seleção** | Ação por linha que só importa na linha em que se está |
| 🔁 | **Redesenhar** | O elemento está no lugar certo, mas a forma está errada (controle nativo, tamanho, estilo) |
| ✂️ | **Remover** | Duplicado, redundante ou sem uso |

## Telas

| Tela | Arquivo | Elementos hoje | Visíveis depois | Principal mudança |
| --- | --- | --- | --- | --- |
| Estrutura (sidebar + header) | [shell.md](shell.md) | 17 | 15 | Organização e usuário viram um único menu. O seletor de instância vira popover |
| Indicadores | [dashboard.md](dashboard.md) | 3 ações + 6 KPIs + 2 gráficos + tabela | 2 ações | Exportar em um só menu. Filtros de período numa barra |
| Atendimento | [inbox.md](inbox.md) | 21 | 9 | Header da conversa com 1 ação + ⋯. Memória do lead editada ao clicar no campo |
| Conexões | [connections.md](connections.md) | 14 (3 por linha) | 5 (1 por linha) | Linha com status acionável + ⋯. Assistente em modal |
| Construtor de Fluxos | [builder.md](builder.md) | **78** | ~30 | **A barra de ferramentas desaparece**: desfazer, organizar e zoom flutuam no canvas. JSON, importar e exportar vão para o ⋯ |
| Prompts & Variáveis | [builder-panels.md](builder-panels.md) | 19 / 39 | 12 / 14 | Variáveis viram uma tabela compacta. Só os problemas ficam à vista |
| Agentes | [agents.md](agents.md) | 9 + gaveta de 15 | 5 | **A edição do agente sai da gaveta para uma página própria** |
| Base de Conhecimento | [knowledge.md](knowledge.md) | 20 | 9 | O testador de busca vira popover. Card clicável com ações no hover |
| Logs de Execução | [logs.md](logs.md) | 31 | 6 + hover | Ações por linha no hover. Barra flutuante de ações em lote |
| Integrações | [integrations.md](integrations.md) | 6 | 4 | Grade de integrações no estilo de uma loja de apps |
| Configurações + Admin | [settings.md](settings.md) | 11–14 | 6–8 | Papel com um seletor próprio. Admin com ⋯ por linha |

---

## Por que o app ainda "parece web codado"

Não é um problema só. São **dez sinais somados**, medidos no app rodando:

| # | Sinal | Medição | Por que denuncia | Correção |
| --- | --- | --- | --- | --- |
| W1 | **Botões com alturas diferentes** | **12 alturas** (20, 26, 28, 29, 31, 32, 34, 36, 38, 40, 42, 60px) | Em produto maduro, lado a lado os botões têm a mesma altura. Aqui, "Enviar" (28px) fica ao lado de um input de 34px (Inbox #11/#12) | 3 tamanhos: **sm 28 · md 32 · lg 36**. Input e botão lado a lado sempre com a mesma altura |
| W2 | **Cantos diferentes** | **7 raios** de botão (0, 4, 5, 6, 7, 8, 12px) e 5 de input | Cantos variados parecem peças de lugares diferentes | **Raio 8** para controles, **12** para cards e modais, **999** para pílulas. Só esses 3 |
| W3 | **Inputs com alturas diferentes** | **11 alturas de input** (22 a 38px) e 5 de select | O nome do fluxo tem 23px, a busca 38px. A mesma função com formas diferentes | Input **32** (compacto, em barras) e **36** (em formulários) |
| W4 | **Controles nativos do navegador** | **16 `<select>`**, **9 checkboxes**, 2 `input type=date`, 1 `range`, todos nativos | O menu do select, o calendário e o checkbox são desenhados pelo sistema operacional: saem com outra fonte e outra cor, e no modo escuro abrem **brancos** no Windows | Componentes próprios: Select (lista num popover), Checkbox/Switch, DateRangePicker com presets, Slider |
| W5 | **Janela `confirm()` do navegador** | 7 exclusões usam o `confirm()` nativo | A caixa cinza do navegador com "127.0.0.1 diz…" é o sinal mais claro de protótipo | `ConfirmDialog` do design system, com o nome do item e a consequência |
| W6 | **Dicas pelo `title` nativo** | **69** usos de `title=` | A dica demora ~1 s, usa a fonte do sistema, não aparece no toque e não segue o tema | `Tooltip` próprio (atraso de 400 ms no primeiro, instantâneo nos seguintes, como diz a `emil-design-eng`) |
| W7 | **Retorno por banner no meio da página** | Sucesso e erro aparecem como faixas que empurram o conteúdo (Dashboard, Agentes, Configurações) | O layout pula a cada ação | **Toast** para conclusão ("Documento salvo · Desfazer"). Banner só para estado persistente ("Instância desconectada") |
| W8 | **Excesso de fonte monoespaçada e CAIXA ALTA** | `font-mono` em 27 lugares (telefone, modelo, prompts, nomes de pessoas); `uppercase` em 44 | Monoespaçada fora de código e caixa alta em tudo são estética de painel de desenvolvedor | Monoespaçada **só** em `{{variáveis}}`, IDs e JSON. Caixa alta só no rótulo de seção da sidebar |
| W9 | **Linhas clicáveis que não respondem ao teclado** | A conversa do Inbox (`div onClick`) e a linha de Logs (`tr onClick`) | Não recebem foco, não abrem com Enter e o leitor de tela não as anuncia | Linha como `button` ou link. Foco visível. Setas ↑↓ navegam no Inbox |
| W10 | **Detalhes de acabamento** | O crédito "React Flow" no canto do canvas · o emoji 💡 no texto de ajuda do agente · links sublinhados como botão ("Assumir Agora") · a fonte do textarea de conhecimento em monoespaçada | Cada um sozinho é pequeno. Somados, dão cara de template | Esconder o crédito (é permitido na licença MIT com `proOptions`), ícone em vez de emoji, botão em vez de link sublinhado, fonte normal no editor de conteúdo |

## Componentes que faltam no design system

Hoje o `components/ui` tem Button, Badge, Card, Input, Tabs, Modal, Drawer, Skeleton e EmptyState. Para aplicar as decisões desta auditoria faltam:

| Componente | Substitui | Usado em |
| --- | --- | --- |
| **DropdownMenu** (o "⋯") | Fileiras de botões por linha ou card | Conexões, Agentes, Conhecimento, Logs, Admin, Membros, Builder |
| **Popover** | Painéis que ficam sempre abertos | Seletor de instância, configurações do fluxo (Loop), testador de busca, validação |
| **Select** (com busca) | 16 selects nativos | Estágio, filtros, papéis, provedor |
| **Checkbox / Switch** | 9 checkboxes nativos | Ferramentas do agente, escopos da chave, seleção em lote |
| **DateRangePicker** com presets | `input type=date` | Logs, Indicadores |
| **Tooltip** | 69 `title=` | Botões só com ícone |
| **Toast** (com Desfazer) | Banners de sucesso inline | Salvar, excluir, mudar papel |
| **ConfirmDialog** | 7 `confirm()` | Exclusões, suspender |
| **SegmentedControl** | 3 implementações diferentes (Inbox, Tabs pills, filtros) | Inbox, Prompts, Conhecimento |
| **DataTable** (ações no hover + barra de lote) | Tabelas feitas à mão | Logs, Conexões, Membros, Admin, comparativo da Dashboard |
| **CommandMenu** (⌘K / "/") | Biblioteca de 46 blocos sempre aberta | Builder (adicionar bloco), navegação global |
| **PageHeader** | 11 cabeçalhos feitos à mão | Todas as páginas |

## Ordem sugerida

1. **Base visual:** tamanhos únicos de botão, input e canto (W1–W3) + DropdownMenu, Popover, Tooltip, Toast e ConfirmDialog. Resolve a sensação de "web codado" em todas as telas de uma vez.
2. **Builder e Inbox:** as duas telas com mais elementos e mais uso ([builder.md](builder.md), [inbox.md](inbox.md)).
3. **Agentes em página própria + Logs com DataTable.**
4. **As outras telas.**
