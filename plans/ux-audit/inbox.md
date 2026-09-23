# Atendimento (Inbox) — auditoria UX

Arquivo: `apps/web/src/inbox/InboxPage.tsx` · Capturas: `img/inbox-list.png`, `img/inbox-conversation.png`, `img/mobile-inbox-conv.png`

É a tela mais usada do produto, dezenas de vezes por dia por operador. A pergunta que ela precisa responder em 1 segundo é: **"quem precisa de mim agora?"**. Hoje a lista é só cronológica.

## Lista de conversas

| Antes | Depois | Por quê |
| --- | --- | --- |
| Ordem só por horário. Uma conversa encaminhada para humano aparece misturada às que a IA está atendendo | Seção fixa no topo **"Aguardando você (2)"** com as conversas em `HUMAN_HANDOFF` / `bot_paused`, ordenadas pelo **tempo de espera** ("há 12 min") | O trabalho do operador são as exceções. Hierarquia: o mais importante deve ser o mais óbvio |
| Nenhum indicador de mensagem nova | Ponto ou contador de não lidas, e nome em negrito quando há mensagem nova do lead | Retorno de status |
| Horário `02:21 AM` | `14:21`, "ontem", "seg" (relativo, 24h) | Padrão pt-BR (T1) |
| Estágios com cores de status: *Qualificando* e *Negociação* em **âmbar** (cor de alerta), *Coleta de Info* em verde | Estágios em um selo neutro com um pontinho numa escala ordinal de um tom (mais avançado = mais escuro). Reservar âmbar/vermelho para **espera longa** e **erro** | Cor de status é reservada para significado de status (`dataviz`). Hoje "Qualificando" parece um alerta |
| Selo "IA" em todas as linhas | Mostrar só a exceção: selo **"Humano"** quando alguém assumiu | Um selo que aparece em 90% das linhas não informa nada |
| Grupos ("Grupo Vendas Norte") misturados com leads | Ícone de grupo + filtro "Ocultar grupos" (ou uma aba própria) | Grupo não é lead. Hoje ele recebe um estágio de funil |
| Segmentado *Todos · IA · Humano* + select *Todos os Estágios* | Manter, mas mostrar a contagem em cada opção ("Humano 2") | Informa antes do clique |

## Conversa aberta

| Antes | Depois | Por quê |
| --- | --- | --- |
| **Dois botões para assumir**: "Assumir Conversa" no header **e** "Assumir Agora" no banner | Um só: o banner "IA respondendo · **Assumir**". O header fica com o estágio e o menu "⋯" | A mesma ação em dois lugares faz a pessoa se perguntar se são coisas diferentes |
| "Debug do agente" é o 1º botão do header | Mover para o menu "⋯" (visível só para quem tem permissão de fluxo) | É uma ferramenta de desenvolvimento no lugar mais nobre da tela de atendimento |
| Header: `Mariana Souza 55` (telefone cortado) · `Conexão: Vida Card Principal` quebrando em 2 linhas · `ID: c0` | Nome + telefone formatado numa linha, instância numa linha secundária. O ID vai para "Detalhes técnicos" | Hoje o header está apertado e mostra dado interno |
| Campo de texto: *"Digite sua mensagem (a conversa será assumida automaticamente)…"* | Enquanto a IA atende, o botão diz **"Assumir e enviar"**. Depois de assumir, volta a "Enviar" | Deixa a consequência explícita na própria ação, não num texto de ajuda |
| Sem separador de dia no histórico | "Hoje", "Ontem", "12 de setembro" entre as mensagens | Orientação no tempo |
| O nome "SDR Flow IA" aparece em verde em cada mensagem da IA | O nome do **agente** ("Sofia") em cor de texto secundária. A identidade vem da cor do balão | Texto não usa a cor do dado. O usuário conhece o agente pelo nome |

## Contexto do lead (painel direito)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Cada campo da memória com 2 botões (editar e excluir) sempre visíveis | Editar ao clicar no valor. Excluir no hover ou no menu | Hoje são 8 ícones competindo com 4 dados |
| Telefone `5555991000000` | `+55 55 99100-0000` com um botão de copiar | T2 |
| Não mostra o estágio, o deal nem o agente | Mostrar estágio, oportunidade (título, score) e agente responsável | Os dados já vêm em `conversation.deal` |

## Celular (`img/mobile-inbox-conv.png`)

A lista e a conversa aparecem lado a lado em 390px. O balão tem ~1 palavra por linha e o campo de texto vira um quadrado. **Fica inutilizável.**
→ Padrão mestre/detalhe: lista em tela cheia → toque abre a conversa em tela cheia com "‹ Voltar". O contexto do lead abre como uma gaveta por um botão no header.
