# Base de Conhecimento — auditoria UX

Arquivo: `apps/web/src/knowledge/KnowledgePage.tsx` · Captura: `img/knowledge.png`

| Antes | Depois | Por quê |
| --- | --- | --- |
| Descrição: "…garantindo respostas com **100% de precisão e zero alucinações**" (`KnowledgePage.tsx:350`) | "A IA consulta estes documentos antes de responder, o que reduz respostas inventadas. Revise os documentos com frequência." | **Promessa falsa**. RAG reduz alucinação, mas não zera. A `apple-design` (Responsabilidade) manda não prometer além do que o sistema garante |
| 3 cards de estatística: "5 Documentos Ativos", "~795 Tokens Indexados", "5 Categorias Oficiais" | Uma linha discreta: "5 documentos · atualizado há 2 dias". Tokens só em "Detalhes técnicos" | Tokens é métrica de engenharia. "5 Categorias" é constante e não informa nada |
| "Testador de Busca Semântica da IA" com **"Limiar: 0.3"** | "Testar uma pergunta" (sem o limiar, que fica em "Avançado"), mostrando os trechos encontrados com "muito relevante / relevante" | Jargão (T5). O teste é ótimo e deveria ficar em evidência, mas em linguagem de uso |
| Cards de documento com "~180 tokens" em destaque e só a data | O título, as 2 primeiras linhas e "atualizado em 22/09". Tokens só nos detalhes | Hierarquia: o conteúdo importa mais que o tamanho |
| Coleções como abas-pílula com contagem ("Preços & Planos 0") | Ok. Ocultar ou esmaecer as coleções com 0 e oferecer "Adicionar primeiro documento" dentro da coleção vazia | Estado vazio com ação |
| Editar e excluir sempre visíveis em cada card | Clique no card para editar. Excluir no menu "⋯" | T3 |
| Não mostra **quais agentes/fluxos usam** a base | "Usada por: Sofia — SDR Vida Card" | Conecta a causa (documento) ao efeito (resposta da IA) |
