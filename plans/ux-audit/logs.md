# Logs de Execução — auditoria UX

Arquivos: `apps/web/src/logs/*` · Capturas: `img/logs.png`, `img/logs-detail.png`

A tela está bem resolvida: filtros no topo, tabela clara e um detalhe passo a passo com erro visível. Os ajustes são pontuais.

| Antes | Depois | Por quê |
| --- | --- | --- |
| **O caminho do topo mostra "Plataforma › Visão Geral"**: falta a rota `/logs` no `AppHeader` | "Inteligência › Logs de Execução" | Bug de orientação (o usuário não sabe onde está) |
| Uma execução que falhou é só mais uma linha com o selo "Falhou" | Um resumo no topo: "3 falhas nas últimas 24h · **ver**" (filtra por status=failed) | O motivo de abrir esta tela é quase sempre investigar uma falha |
| O detalhe não leva à conversa | "Abrir conversa" (vai para o Inbox com a conversa selecionada) e "Abrir no Construtor" (com o nó que falhou selecionado) | A pessoa quer ver o efeito e corrigir a causa |
| O erro do passo aparece cortado na linha ("OpenAI timeout after 30000...") | Mostrar o erro completo quando o passo falho estiver aberto. Traduzir os erros conhecidos ("A OpenAI não respondeu em 30 s") | Um erro legível é um erro resolvível |
| O tipo do nó aparece em caixa alta técnica (`PASSO 2 · AGENT.DECIDE`) | "Passo 2 · Decisão do agente" (o rótulo do catálogo) | Jargão |
| Campos de data nativos, que no navegador em inglês aparecem como `mm/dd/yyyy` | Seletor de período com presets (Hoje, 7 dias, 30 dias), o mesmo da Dashboard | Consistência entre as telas (`dataviz`: filtros) |
| Coluna "Tokens" crua (`1380`) | `1.380`, com o custo estimado ao lado | T1 e dado útil |
| "Baixar" (JSON) por linha, sempre visível | Manter no detalhe e na ação em lote. Na linha, só no hover | Ruído visual numa tabela longa |
