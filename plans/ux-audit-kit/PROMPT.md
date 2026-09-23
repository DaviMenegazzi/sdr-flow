# Prompt: auditoria visual de UX, elemento por elemento

> **De onde veio este prompt.** No SDR Flow não houve um único prompt. A auditoria foi construída em várias conversas, e este texto junta os pedidos feitos lá com o método que foi usado, num prompt só que dá para entregar a outra IA.
>
> **Antes de colar:**
> 1. Instale as três skills da pasta `skills/` no projeto (em `.claude/skills/` no Claude Code, ou no mecanismo de skills da outra ferramenta).
> 2. Troque tudo o que está entre `‹ ›` pelos dados do seu projeto.
>
> O prompt está dividido em duas etapas: **auditar** e **implementar**. Mande só a Parte 1 primeiro e revise o resultado. Depois mande a Parte 2.

---

## Parte 1: auditoria

Faça uma **auditoria visual de UX, minuciosa e elemento por elemento**, de todas as telas do ‹nome do produto› (‹stack: ex. React + Vite + Tailwind›, código em ‹caminho do front-end›).

Não quero uma lista genérica de boas práticas. Quero uma decisão para **cada** botão, input, select, toggle, link e bloco de dados de **cada** tela. As perguntas são estas:

- O que fica visível?
- O que deve ser **escondido ou agrupado** num menu "⋯"?
- O que vira um **card flutuante** (popover) que abre ao clicar?
- O que merece **outra aba ou página**, porque é um conjunto grande de dados competindo com a tarefa principal da tela?
- Quais botões e inputs estão **ruins** (tamanho, forma, controle nativo do navegador, rótulo)?
- O que ainda faz o app **"parecer web codado"**, com cara de protótipo ou template?

### Skills (leia antes de começar e cite-as nas justificativas)

| Skill | Use para |
| --- | --- |
| `apple-design` | Hierarquia, simplicidade (não minimalismo), agrupamento, familiaridade, retorno ao usuário, "a ação mais importante deve ser a mais óbvia", confirmação só para o que é destrutivo e irreversível |
| `emil-design-eng` | Acabamento de componentes (press, tooltip, popover ancorado ao botão, tamanhos consistentes) e o formato de revisão em tabela **Antes / Depois / Por quê** |
| `dataviz` | Tabelas, números, KPIs, gráficos, densidade de dados, filtros e cores. **Rode o script `validate_palette.js`** em toda paleta proposta, no tema claro e no escuro. Não escolha cores de olho |

### Método obrigatório

1. **Rode o app de verdade** com dados realistas. Se não houver backend disponível, simule a API interceptando as requisições no Playwright ou em outra ferramenta de automação de navegador. Use volumes realistas: dezenas de conversas, várias instâncias, estados de erro e de vazio.
   - Não simule sucesso onde o produto real falharia.
   - Capture também os estados abertos: modais, gavetas, menus, abas internas, formulários.
2. Em cada tela e estado, **numere na captura** todos os elementos interativos e **meça** cada um: altura, largura, raio, fonte, peso, cores e se é controle nativo. Use o script `tools/annotate-elements.js` e salve as capturas em `img/` e as medidas em `elements.json`.
   - Resolução: 1440×900, nos temas claro e escuro, e 390px para as telas principais no celular.
3. Com as medidas somadas, liste os **sinais transversais** de "web codado", sempre com números. Exemplos:
   - "12 alturas de botão diferentes";
   - "16 `<select>` nativos";
   - "69 dicas via `title=`";
   - "7 `confirm()` do navegador";
   - raios de borda inconsistentes;
   - fonte monoespaçada ou CAIXA ALTA fora de lugar;
   - linhas clicáveis que não respondem ao teclado;
   - banners que empurram o layout em vez de toasts;
   - crédito de biblioteca à vista;
   - emojis em texto de interface.
4. Para cada tela, faça uma **tabela** com as colunas `# | Elemento | Decisão | Por quê`. O `#` é o número na captura. A decisão usa esta legenda:

   | Símbolo | Decisão |
   | --- | --- |
   | ✅ | Manter |
   | ⭐ | Promover a ação principal |
   | ⋯ | Mover para o menu de ações |
   | 🪟 | Popover (card flutuante ancorado) |
   | 🗂️ | Outra aba ou página |
   | 👆 | Só no hover ou na seleção |
   | 🔁 | Redesenhar |
   | ✂️ | Remover |

5. Quando a mudança for de layout, acrescente um **esboço em ASCII** da proposta. Exemplos: cabeçalho da tela, linha de tabela, página nova.
6. Liste os **componentes que faltam** no design system para aplicar as decisões. Por exemplo: Popover, DropdownMenu, Tooltip, Toast com "Desfazer", ConfirmDialog, Select próprio, Checkbox/Switch, SegmentedControl, DateRangePicker, PageHeader.
7. Aponte, sem floreio, **dados falsos ou promessas indevidas** que encontrar. Exemplos: métricas fixas no código, "100% de precisão", botões que só mostram `alert`, telas de "sucesso" sem verificação.

### Entregáveis da Parte 1

Uma pasta `plans/ux-visual-audit/` com:

- **`README.md`**:
  - legenda;
  - tabela resumo por tela, com o número de elementos hoje e depois e a principal mudança;
  - os sinais transversais medidos;
  - os componentes que faltam;
  - uma **proposta de fases de implementação**.
- **Um `.md` por tela ou área**, com as tabelas `# | Elemento | Decisão | Por quê`.
- **`img/`** com as capturas numeradas e **`elements.json`** com as medidas.

Escreva em ‹português do Brasil›, com linguagem de produto e não de engenharia. Não altere código nesta etapa.

---

## Parte 2: implementação

Implemente as recomendações de `plans/ux-visual-audit/` **em sequência, fase por fase**, sem pedir aprovação a cada passo. Vou revisar tudo no final.

### Ordem das fases

1. **Base:**
   - componentes que faltam no design system;
   - tamanhos padronizados (botões com 3 alturas, inputs com 2, raios com 3 valores);
   - formatação local centralizada (datas relativas, números, telefone, moeda).
2. **Substituições transversais:** todo `confirm()` vira ConfirmDialog, todo `title=` importante vira Tooltip, banners de sucesso viram Toast.
3. **Estrutura global:** sidebar, cabeçalho, seletores de contexto (organização, instância), menu da conta.
4. **Uma fase por tela ou área**, da mais usada para a menos usada.
5. **Verificação final e relatório.**

### Regras

- **Um commit por fase**, com uma mensagem que explique o porquê. Rode typecheck, testes e build antes de cada commit.
- **Verifique cada fase no navegador:** tire capturas e olhe as capturas antes de seguir. Cubra desktop e celular, tema claro e escuro, sem erros no console.
- **Não simule** sucesso, publicação, conexão, envio nem resposta de IA. Se a recomendação depende de um endpoint que não existe, não faça um botão que finge funcionar. Mostre o estado real ("Em breve", "Não conectado") e registre como pendência.
- **Não remova comportamento** que os testes cobrem. Se uma decisão da auditoria conflitar com uma regra do projeto (‹arquivo de regras, ex. AGENTS.md›), a regra do projeto vence. Registre o conflito.
- **Mantenha os dados reais:** nada de números inventados na interface.
- **Gráficos:** siga a `dataviz`, com paleta validada por script para cada tema, cores separadas por tema, legenda com texto neutro e nunca eixo duplo.

### Relatório final

Salve em `plans/ux-visual-audit/IMPLEMENTATION.md`:

- tabela de verificação (typecheck, testes, build, orçamento de bundle, navegador);
- o que mudou em cada fase, com o hash do commit;
- **onde você se afastou da auditoria e por quê**;
- pendências sugeridas;
- como revisar: capturas **depois** em `plans/ux-visual-audit/after/`, com a mesma numeração das capturas de antes.
