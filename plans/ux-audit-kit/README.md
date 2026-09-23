# Kit de auditoria visual de UX

Este kit tem o que foi usado na auditoria e na repaginação do SDR Flow. Serve para repetir o processo em outro projeto, com outra IA.

| Arquivo | O que é |
| --- | --- |
| `PROMPT.md` | O prompt, em duas partes: **auditoria** e depois **implementação** |
| `skills/apple-design/` | Skill de hierarquia, simplicidade, agrupamento e retorno ao usuário |
| `skills/emil-design-eng/` | Skill de acabamento de componentes e do formato Antes/Depois/Por quê |
| `skills/dataviz/` | Skill de gráficos, tabelas e KPIs. Traz o validador de paleta em `scripts/validate_palette.js`, que se roda com `node` |
| `tools/annotate-elements.js` | Script de Playwright que numera e mede os elementos de cada tela |

## Como usar

1. **Instale as skills:**
   - No **Claude Code**, copie as três pastas de `skills/` para `.claude/skills/` do projeto novo.
   - Em **outra IA**, anexe o `SKILL.md` de cada skill e as pastas `references/` como contexto, ou use o mecanismo de skills ou regras dela.
2. **Mande a Parte 1** do `PROMPT.md`, trocando os campos `‹ ›` pelos dados do projeto.
3. **Revise a auditoria.** Discorde do que não fizer sentido antes de mandar implementar.
4. **Mande a Parte 2.**

## Origem das skills e cuidados

- **`apple-design` e `emil-design-eng`** vêm do repositório público [github.com/emilkowalski/skills](https://github.com/emilkowalski/skills). A cópia sem nenhuma alteração é a que está no SDR Flow, em `.claude/skills/`.
- **`dataviz`** vem embutida no Claude Code. O `SKILL.md` desta pasta foi remontado a partir do texto que a ferramenta carrega. As referências e os scripts são os arquivos originais.
- Se o projeto novo for grande, peça a auditoria **por área**, uma conversa por grupo de telas, e depois um `README.md` que junte tudo. Uma única conversa não tem contexto para 30 ou mais telas com a mesma profundidade.
