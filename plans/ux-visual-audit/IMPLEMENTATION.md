# Auditoria visual de UX: relatório de implementação

Este relatório cobre as recomendações de `plans/ux-visual-audit/` que foram implementadas, em 10 fases com um commit cada, no branch `claude/skill-install-sdr-audit-k511qv`.

As telas depois das mudanças estão em [`after/`](after/). Os nomes dos arquivos seguem a numeração das imagens de `img/`, para comparar lado a lado.

## Verificação

| Verificação | Resultado |
| --- | --- |
| `pnpm db:types:check` | ✅ 22 tabelas e 7 enums conferidos |
| `pnpm check`: typecheck | ✅ |
| `pnpm check`: testes | ✅ 50 arquivos, 478/478 |
| `pnpm check`: build | ✅ |
| `pnpm check`: orçamento de bundle | ✅ JS inicial com 70,5 kB gzip (limite de 180 kB). Aumento de 7,3% sobre a linha de base, abaixo do limite de 10% |
| Navegador (Playwright com API simulada) | ✅ Todas as telas no desktop (1440px), claro e escuro, e as principais no mobile (390px). Sem erros no console, exceto o WebSocket do realtime, que o harness não simula |

## O que mudou, por fase

### F1: base do design system (`3b91bae`)

- **Componentes novos** em `components/ui`:
  - `Popover`, `DropdownMenu` (o menu ⋯), `Tooltip` e `IconButton`;
  - `Toast` com ação "Desfazer" e `ConfirmDialog`;
  - `Select` com descrições, busca e aparência de chip, que substitui o select nativo;
  - `Checkbox` e `Switch`, `SegmentedControl` e `DateRangePicker` com presets e intervalo personalizado;
  - `PageHeader` e `PageContainer`.
- **Formatação pt-BR** centralizada em `lib/format.ts`: telefone, datas relativas, números, duração e US$.
- **Tamanhos padronizados:** botões com 28, 32 ou 36px e inputs com 36px.

### F2: substituições transversais (`ac8f2a6`)

- Todo `confirm()` nativo virou `ConfirmDialog`, com título, consequência e botão destrutivo nomeado.

### F3: estrutura global (`4d899d7`)

- **Seletor de organização** no topo da sidebar.
- **Menu da conta** no rodapé da sidebar, com tema, Configurações, Administração e Sair.
- **Navegação em seções:** Operação, Automação & IA e Dados.
- O cabeçalho ganhou o **breadcrumb** e o **chip da instância** com popover (status, número formatado, "Gerenciar conexões").

### F4: Atendimento (`9df853e`)

- **Lista de conversas:**
  - navegável por teclado (↑↓);
  - o grupo "Atendimento humano" fica no topo;
  - os filtros ficam num popover e as abas Todos/IA/Humano mostram contagem.
- **Cabeçalho da conversa:**
  - uma ação principal só (Assumir ou Devolver);
  - o estágio fica num chip;
  - o resto vai para o ⋯.
- **Painel de contexto:** recolhível. A memória é editada inline e a exclusão tem "Desfazer".
- **Mensagens:** separadores de dia e um campo que cresce com o texto.
- **Mobile:** lista e conversa em telas separadas, sem selecionar a primeira conversa sozinho.

### F5: Construtor de Fluxos (`ca991ef`)

- **Cabeçalho numa linha só:**
  - nome editável com a troca de fluxo;
  - status do fluxo e Canvas/Prompts/Variáveis;
  - chip de validação e botões Testar e Salvar;
  - "Publicar ▾", com o modo e o número de teste;
  - ⋯ com Configurações, JSON, exportar e importar.
- **Canvas:**
  - biblioteca de blocos recolhível, com categorias;
  - barra de ferramentas flutuante;
  - enquadramento inicial calculado a partir das posições.
- **Atalhos:** ⌘S e "/", aviso ao sair sem salvar e "Desfazer" ao apagar um nó.
- **Formulário do nó:** Select e Switch próprios.
- **Variáveis:** viraram uma tabela com Em uso, Com problema e Todas.

### F6: Agentes (`466c0ef`)

- **Lista:**
  - o card inteiro abre o agente;
  - Abrir, Duplicar e Arquivar ficam no ⋯;
  - o bloco de métricas fixas no código ("~850ms", "IA Ativa") foi removido;
  - só a exceção aparece: "Sem chave da OpenAI · Adicionar".
- A busca e o filtro só aparecem a partir de 6 agentes. O cabeçalho diz "2 de 5 agentes do plano".
- **Página própria `/agents/:id`** no lugar da gaveta:
  - navegação lateral (Geral, Instruções, Modelo, Ferramentas, Números, Chave da OpenAI);
  - Salvar no cabeçalho e aviso de alterações não salvas;
  - **editor grande em fonte normal**, em que digitar `{{` abre as variáveis no cursor;
  - modelo num Select com descrições;
  - estilo das respostas com **Preciso, Equilibrado ou Criativo**, e o slider em "Avançado";
  - ferramentas em cards com Switch;
  - números atendidos com a ação "Atender com este agente" ou "Transferir".

### F7: Conhecimento, Logs, Conexões e Integrações (`b95f328`, `905247e`, `c5fd532`, `abd2070`)

- **Base de Conhecimento:**
  - o texto dos "100% de precisão e zero alucinações" saiu e os 3 cards de estatística viraram uma linha;
  - as **coleções ficam numa coluna lateral**, com contagem. Havia um bug: com uma coleção selecionada, as outras mostravam 0;
  - o testador de busca fica atrás de "Testar pergunta", com o limiar em Avançado;
  - o card abre o editor e Excluir fica no ⋯;
  - há alternância entre lista e cards;
  - o editor usa o Modal padrão e fonte normal.
- **Logs de Execução:**
  - filtros numa linha, com SegmentedControl de status e DateRangePicker;
  - **o status é a primeira coluna**;
  - o horário é relativo, com a data completa, o modelo e os tokens no tooltip;
  - linhas focáveis (Enter abre e Espaço seleciona);
  - checkbox e download só aparecem no hover;
  - **barra de ações em lote flutuante**;
  - atualiza a cada 30 s enquanto houver execução em andamento.
- **Conexões:**
  - ⋯ por linha: copiar webhook, verificar, reiniciar, simular o fluxo, remover;
  - **"Reconectar"** é a ação da linha desconectada e "Verificar de novo" a da linha com erro;
  - Agente e Fluxo publicado viraram colunas e a seção separada de fluxos ativos saiu;
  - **o assistente virou um Modal** com os passos numerados.
- **Integrações:**
  - um card igual por integração;
  - as agendas do Google abrem num popover, com o botão de copiar o ID;
  - Desconectar fica no ⋯;
  - os detalhes técnicos ficam recolhidos e só aparecem para admin;
  - "Voltar aos fluxos" saiu.

### F8: Configurações e Administração (`548c1b1`)

- **Configurações** estão em `settings/SettingsPage.tsx`, fora de `session.tsx`. Com isso a página passou a ser carregada sob demanda, como as outras.
  - Navegação lateral: Organização (Geral, Membros, Chaves de API, Nova organização) e Minha conta (Perfil). O link `?section=new-org` do seletor de organização funciona.
  - **Membros:**
    - colunas Pessoa, Papel e Desde;
    - o **papel é um menu** que explica o que cada papel pode fazer, com toast de "Desfazer";
    - Remover fica no ⋯;
    - os convites pendentes aparecem logo abaixo.
  - **"Convidar pessoa"** abre um modal. "Criar login com senha" fica como caminho avançado dentro dele. O código do convite aparece num diálogo com botão de copiar.
  - **Chaves de API:**
    - lista com prefixo e último uso;
    - "Criar chave" abre um modal com checkboxes próprios, o que corrige o bug de layout;
    - a chave criada aparece uma única vez, num diálogo de copiar.
  - Saíram a tabela duplicada de agentes, o select de organização e o botão Sair.
- **Administração:**
  - "Convidar cliente" abre um modal;
  - **medidores de uso** para agentes e instâncias;
  - os **limites são editados num popover**. Antes era `window.prompt`, que só editava agentes;
  - Suspender fica no ⋯, com confirmação e **desabilitado na própria conta**;
  - Reativar aparece na linha só quando a conta está suspensa.

### F9: Indicadores (`b91bff4`)

- **Filtros:** período e instância numa linha. A API já aceitava `startDate` e `endDate`, que agora são usados.
- **Ações:** "Exportar ▾" substituiu os dois botões de CSV. Consolidar foi para o ⋯ e só aparece para admin e dono.
- **KPIs:**
  - **a taxa de qualificação é o destaque**, com sparkline;
  - 4 cards mostram a **variação contra o período anterior** de mesmo tamanho;
  - o custo total fica dentro do card de custo.
- **Funil em barras horizontais**, com a rampa de verdes validada, em tons separados para o claro e o escuro. "Encaminhado a humano" e "Encerrado" aparecem como resultados, não como etapas.
- **Conversas por dia:** duas linhas com legenda, grade sólida e discreta e datas dd/mm, nas cores validadas para cada tema.
- A tabela de versões tem números alinhados à direita, com separador pt-BR.

## Onde me afastei da auditoria, e por quê

| Item da auditoria | O que fiz | Motivo |
| --- | --- | --- |
| Agentes: botão "Testar" e playground ao lado | **Removi o playground** | Ele respondia com textos fixos no código ("R$ 29,90…") como se fosse o agente. O `AGENTS.md` proíbe simular envio. Um playground real precisa de um endpoint, como `POST /api/me/agents/:id/test` |
| Agentes: "Definir como padrão" no ⋯ | Não incluí | A API não tem esse endpoint |
| Agentes: vários números por agente, com checkbox | Lista com "Atender com este agente" ou "Transferir" | Cada número tem um agente só (`assign-agent`). Um checkbox sugeriria desvincular, e a API não tem essa operação |
| Agentes: `/` também abre as variáveis | Só `{{` | A barra aparece em texto comum ("e/ou"), e o menu abriria sem querer |
| Integrações: pagamentos com "Conectar" | "Não conectado · Em breve" | O botão antigo só mostrava um `alert`. Não existe endpoint para salvar credenciais de pagamento |
| Conexões: "Erro · token expirado" | "Erro" com "Verificar de novo" | A API não devolve o motivo do erro |
| Conexões: coluna Agente | Aparece quando a conexão traz `agent_id` | Os dados simulados não trazem esse campo. Vale conferir se `listConnections` o devolve |
| Conexões: "Já conectei" | Agora **verifica com o provedor** antes de mostrar a tela de sucesso | A tela de sucesso aparecia sem checar nada, o que é conexão simulada |
| Logs: lead como link para a conversa | Não fiz | A lista de execuções não traz `conversation_id` e o Atendimento não abre uma conversa por link |
| Logs: contagem nas abas de status | Sem contagem | Exigiria uma consulta por status. A API filtra, mas não conta |
| Configurações: "Minha conta › Preferências" | Não fiz | O tema já está no menu da conta. Não havia outra preferência |
| Indicadores: aba "Versões" | Mantive a tabela no fim da página, com o título "Resultado por versão do fluxo" | Mudança pequena e reversível. Dá para mover depois |

## Pendências sugeridas

1. **Playground real de agente:** um endpoint que chame o modelo com o prompt e as ferramentas do agente, sem enviar WhatsApp. Com ele, o botão "Testar" volta à página do agente.
2. **Motivo do erro nas conexões:** guardar e devolver `last_error` para mostrar "Erro · token expirado · Reautenticar".
3. **Link de uma conversa no Atendimento:** `/inbox?conversation=…`, com `conversation_id` na lista de execuções.
4. **Contagem por status** nos Logs.
5. **Credenciais dos gateways de pagamento** (Asaas, Mercado Pago, Stripe).
6. **Rodar `/pick-ui-library`**, se quiserem avaliar trocar os componentes próprios por uma biblioteca (Radix, Base UI). Esse skill só pode ser acionado por você.

## Como revisar

- `pnpm dev:web` e percorrer as telas. Para comparar, use `plans/ux-visual-audit/img/*.png` (antes) e `plans/ux-visual-audit/after/*.png` (depois).
- Cada fase é um commit isolado (`git log --oneline`), então dá para reverter uma parte sem perder as outras.
