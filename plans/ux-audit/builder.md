# Construtor de Fluxos (+ Prompts, Variáveis e Modelos SDR) — auditoria UX

Arquivos: `apps/web/src/builder/*`, `main.tsx` (Modelos) · Capturas: `img/flows-template.png`, `img/flows-node-selected.png`, `img/flows-prompts.png`, `img/flows-variables.png`, `img/templates.png`, `img/mobile-flows.png`

## Canvas

| Antes | Depois | Por quê |
| --- | --- | --- |
| **O Modelo SDR (17 nós) abre como uma linha horizontal a ~15% de zoom**: os nós viram traços e nada é legível (`flows-template.png`) | Ao carregar um modelo, aplicar o layout automático **de cima para baixo** (dagre `TB`, o "Organizar" já existe) e enquadrar com `minZoom: 0.5`. Se não couber, começar pelo gatilho | A primeira impressão do produto é o modelo pronto, e hoje ele parece quebrado |
| **Três botões para o mesmo modelo**: "Usar Modelo SDR" (rodapé da biblioteca), "Carregar Modelo SDR" (inspector) e a página "Modelos SDR" | Um lugar só: a página Modelos + um atalho no **estado vazio** do canvas ("Comece por um modelo · ou arraste um gatilho") | A mesma ação em vários lugares confunde. O atalho aparece onde é útil (canvas vazio) |
| Biblioteca com 46 blocos + um aviso fixo sobre Inteligência ocupando o topo | Aviso recolhível ("i"). Categorias recolhíveis. Busca no topo | O mais comum primeiro, o avançado um nível abaixo |
| Mais de 220px de controles antes do canvas (header do app + cabeçalho do editor + abas + barra de ferramentas) | Juntar abas e ferramentas numa linha. "Produção Livre / Trava de teste" vira um único **Modo: Produção ▾** perto de Publicar | Pendente da auditoria de design. Precisa de protótipo |
| "Produção Livre" + "Responde a qualquer contato no WhatsApp" + "Trava de teste" | "Modo: **Teste** (só números autorizados) / **Produção** (todos os contatos)" | O rótulo deve dizer o efeito |

## Painel do nó (inspector)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Mostra o id técnico `guard.chat_type` em destaque logo abaixo do título | Uma frase do que o bloco faz ("Filtra conversas de grupo"). O id vai para "Detalhes técnicos" | Jargão (T5) |
| "Permitir grupos ☐ Ativado" | Um interruptor com o rótulo completo: "Responder em grupos" + uma descrição curta | O rótulo "Ativado" ao lado do checkbox é redundante e ambíguo |
| "Excluir Nó" em vermelho logo abaixo de um único campo | Excluir no rodapé do painel ou pela tecla Delete, com **Desfazer** (o editor já tem desfazer) | Ação reversível: desfazer em vez de destaque |
| Validar mostra "Tudo certo com o grafo" **dentro do painel do nó** e também na barra de status | Resultado da validação num popover ancorado ao botão Validar (erros clicáveis levam ao nó) | O retorno fica perto da ação que o causou. "Grafo" é jargão: usar "fluxo" |

## Prompts & Conhecimento

| Antes | Depois | Por quê |
| --- | --- | --- |
| Cabeçalho "com salvamento instantâneo" | Mostrar o estado real: "Salvo no rascunho · não publicado" | Não prometer o que não acontece. A edição vai para o rascunho, não para a produção |
| `ID: decide...` e `{{decision.reply}}` sem explicação | Rótulo do bloco + "Resposta gerada pelo agente" como texto de ajuda ao lado da variável | Jargão |
| "RAG CONECTADO: 0 coleções" em âmbar, sem ação | "Nenhuma base de conhecimento ligada · **Ligar base**" (link para Conhecimento) | Alerta precisa de uma saída |

## Mapa de Variáveis

| Antes | Depois | Por quê |
| --- | --- | --- |
| 8 cards, a maioria com "Consumido em: *Não utilizado em nenhum bloco*" | Duas listas: **"Em uso"** e **"Disponíveis"** (recolhida). Destacar só os problemas: variável usada mas não gerada (vai sair vazia) | O ruído esconde o único caso que importa: uma variável quebrada |
| Nomes em fonte monoespaçada verde | Monoespaçada em cor de texto, cópia em 1 clique | Texto não usa a cor de destaque |

## Modelos SDR (`templates.png`)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Página centralizada e estreita, diferente das outras | Layout padrão de página (T7) | Consistência |
| Um card com "Abrir e editar modelo ↗" (ícone de link externo) | "Usar este modelo" + uma prévia do fluxo (miniatura) + o que ele faz em 3 tópicos | O ícone ↗ sugere que vai sair do app. A prévia ajuda a decidir |

## Celular (`mobile-flows.png`)

O canvas fica sem largura, os painéis se sobrepõem e os botões saem da tela.
→ Abaixo de `md`, mostrar "O editor de fluxos está disponível no computador" com a lista de fluxos, o status (publicado/rascunho) e uma prévia somente leitura. A `apple-design` pede para adaptar ao contexto: no celular, consulta rápida; no computador, edição.
