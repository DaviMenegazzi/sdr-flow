# Relatório técnico — Debug do agente no Inbox

## O que foi implementado

O Inbox agora possui um debug one-shot por conversa. Ao abrir **Debug do agente**, a API arma uma escuta exclusiva para aquela conversa e captura somente a próxima execução iniciada depois do clique.

O painel mostra:

- fluxo ativo e versão usada pela instância;
- estado `aguardando`, `executando`, `concluído`, `falhou` ou `expirado`;
- blocos percorridos em cascata, na ordem de execução;
- duração e estado de cada bloco;
- entrada, saída e erro ao expandir um bloco;
- relatório final com quantidade de blocos, duração, tokens e problemas encontrados;
- download do JSON completo da escuta depois do relatório final;
- aviso específico quando a IA está pausada, não existe fluxo ativo, o modo teste bloqueia o contato ou o fluxo termina sem enviar mensagem.

A escuta expira após 15 minutos, pode ser interrompida manualmente e precisa ser armada novamente para observar outra mensagem.

## Exportação JSON

O botão **Baixar JSON completo do debug** aparece somente quando existe um relatório final. O arquivo usa o schema `sdr-flow.agent-debug.v1` e contém:

- identificadores da sessão, conversa, conexão e execução;
- início e fim da janela de escuta;
- retrato da conversa e do lead no momento do download;
- mensagens cuja data está dentro da janela observada;
- fluxo e versão usados, incluindo a definição do grafo quando ela está disponível;
- eventos brutos capturados em tempo real;
- passos normalizados com entrada, saída, duração e erro;
- métricas, problemas e resultado final.

O download é montado localmente no navegador a partir da sessão já carregada; não cria uma tabela nem uma cópia adicional no Supabase. Como pode conter telefone, memória comercial, prompts e respostas, o JSON deve ser tratado como dado sensível.

## Persistência e Supabase

Não é necessária uma nova migração para colocar o recurso em funcionamento.

O caminho de webhook autenticado já grava o histórico durável nas tabelas existentes:

- `flow_executions`: uma linha por execução, vinculada a `organization_id`, `conversation_id` e `flow_version_id`;
- `flow_execution_steps`: entrada, saída, duração e erro de cada nó, vinculados à execução e à organização.

A sessão criada pelo botão é intencionalmente temporária e fica em memória no processo da API. Ela existe apenas para correlacionar o clique com a próxima execução, mantém no máximo 250 eventos e é descartada uma hora depois de terminar. Assim, não foi criada uma segunda fonte de histórico no Supabase.

No webhook standalone da Evolution, mensagens continuam sendo persistidas no Supabase quando configurado, enquanto o trace exibido pelo debug é transmitido ao vivo. Esse caminho ainda não cria `flow_executions` e `flow_execution_steps`, pois seus fluxos/versões são mantidos no armazenamento standalone e não possuem uma FK compatível com `flow_versions`.

## Vínculo com a instância

Para o caminho standalone, o debug usa exatamente o vínculo `activeBindings` da instância Evolution que também é consultado antes da execução. Portanto, fluxo mostrado e fluxo executado são o mesmo.

Para o caminho Supabase autenticado, a resolução usa o fluxo publicado mais recente — exatamente o mesmo fallback usado atualmente pelo webhook genérico. Hoje a modelagem de `connections` não possui um campo de fluxo ativo por instância.

Se o produto migrar totalmente para os endpoints autenticados, a adaptação recomendada é adicionar `active_flow_id` e `active_flow_version_id` em `connections`, ambos com FKs compostas por `organization_id`, e atualizar a publicação em uma transação para trocar esses ponteiros. Isso elimina o fallback por “último fluxo publicado” sem criar uma nova tabela.

## Escala horizontal

Em uma única instância da API, a escuta funciona integralmente. Em múltiplas réplicas, o clique e o webhook podem cair em processos diferentes. Antes de escalar horizontalmente, mova apenas o registro efêmero da escuta para Redis, com TTL de 15 minutos e Pub/Sub para os eventos. As execuções e os passos devem continuar no Supabase; Redis não deve virar persistência de negócio.

## Segurança e isolamento

- endpoints autenticados validam a organização antes de armar ou consultar a escuta;
- a chave interna da sessão de debug acompanha os eventos ao vivo;
- o WebSocket filtra por organização, conversa e sessão de debug;
- clientes sem nenhum escopo de assinatura não recebem payloads de execução;
- uma escuta armada não pode ser reivindicada por uma segunda execução.

## Verificação executada

- tipagem da API e do frontend;
- testes unitários da sessão one-shot e do relatório;
- testes do schema exportado, preservação dos eventos e recorte das mensagens pela janela de escuta;
- teste WebSocket comprovando que eventos de uma conversa não chegam à assinatura de outra;
- verificação visual no navegador dos estados aguardando, cascata concluída, relatório, expansão de detalhes e posição do botão de download.

Ainda é necessária homologação com uma mensagem real da Evolution/OpenAI no ambiente que possui as credenciais dos provedores.
