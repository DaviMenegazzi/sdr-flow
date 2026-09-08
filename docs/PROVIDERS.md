# OpenAI e WhatsApp

## Configuração local

Use `.env` na raiz (ignorado pelo Git). API e worker carregam esse arquivo. Nunca use `VITE_` para chaves privadas.

```dotenv
OPENAI_API_KEY=preencha_localmente
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=60000
WHATSAPP_SEND_ENABLED=false
META_GRAPH_VERSION=v21.0
PUBLIC_API_URL=https://api.seudominio.com
ENCRYPTION_KEY=segredo_aleatorio_persistente
```

API e worker precisam do mesmo `ENCRYPTION_KEY`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Preserve a chave de criptografia entre reinícios. Existe fallback para a chave de serviço por compatibilidade; a chave fixa anterior foi removida. Credenciais antigas gravadas com a chave fixa precisam ser recadastradas. Aplique todas as migrações em ordem, incluindo `202609080006_provider_credentials.sql`, que permite ao servidor acessar a tabela privada por RPCs restritas a `service_role`.

Reinicie API e worker após editar `.env`. O Compose já encaminha essas variáveis aos dois serviços.

## Testar a IA sem WhatsApp

1. Preencha a chave OpenAI e a configuração Supabase.
2. Entre na organização, salve o fluxo e abra o playground.
3. Selecione **OpenAI — IA real, WhatsApp simulado** e execute.

Os nós `agent.decide`, `agent.classify`, `agent.extract` e `agent.score` usam a Responses API com JSON Schema estrito, `store:false` e consumo de tokens retornado pelo provedor. Extração suporta os campos de lead nome, cidade, interesse, urgência, objeções e notas. O modelo `default` (ou o antigo `configure-model`) usa `OPENAI_MODEL`; um modelo específico no nó prevalece. Gemini produz erro explícito até existir um adaptador.

A chave permanece no servidor. A opção OpenAI consome tokens da conta; **Resposta simulada** continua disponível sem chave. O playground sempre usa mensagens de prévia e bloqueia nós de chamadas HTTP externas. Não grava mensagens, CRM ou resumos simulados no banco. Ele usa o rascunho salvo no servidor, portanto salve alterações antes de testar.

No runtime de conversas não há fallback para IA fictícia nem IDs de mensagem inventados. Sem chave, a etapa de IA falha. Com envio desativado, a etapa de saída falha explicitamente e não registra mensagem enviada. Nenhum envio real foi realizado durante esta implementação.

## Evolution API

Em **Conexões**, escolha Evolution e informe URL do servidor e `apikey`. O servidor cria uma instância, obtém o QR e salva credenciais criptografadas. Via API também é possível indicar `instanceName` para usar uma instância existente.

No Compose, use `http://evolution:8080` como URL interna da Evolution, com o perfil `whatsapp` habilitado e seu banco próprio configurado. `PUBLIC_API_URL` deve ser a URL da API alcançável pela Evolution; não é a URL da Evolution. O cadastro registra `/api/webhooks/evolution/{connectionId}` com um token aleatório no header `x-webhook-token`. Instâncias antigas precisam desse header para que os eventos sejam aceitos. Falha no registro do callback é exibida como aviso de configuração.

O runtime está preparado para texto (`sendText`), imagem/vídeo/documento (`sendMedia`) e áudio (`sendWhatsAppAudio`). Templates oficiais são encaminhados somente por conexão Meta. URLs de mídia precisam ser acessíveis ao provedor.

## WhatsApp Cloud API oficial (Meta)

O cadastro solicita Phone Number ID, WABA ID, token de acesso, App Secret e token de verificação. Configure no painel da Meta:

- Callback: `https://api.seudominio.com/api/webhooks/meta/{connectionId}`.
- Verify Token: o mesmo preenchido no cadastro.
- Assinatura dos eventos: validada pelo servidor usando `X-Hub-Signature-256` e o App Secret.

Texto, imagem, vídeo, documento, áudio e templates aprovados **sem parâmetros** estão implementados. A versão Graph é configurável por `META_GRAPH_VERSION` (padrão herdado: `v21.0`); confirme a versão habilitada no app Meta na homologação. Templates com parâmetros/componentes ainda precisam de extensão no catálogo.

## Homologação pendente

Mantenha `WHATSAPP_SEND_ENABLED=false` até haver autorização para testar mensagens. A integração foi validada com HTTP simulado e PostgreSQL PGlite; credenciais, QR, entrega e regras da conta Meta ainda precisam ser verificados nos serviços reais. Docker e Supabase hospedado não foram exercitados nesta máquina.

O gateway ainda processa o turno dentro da requisição e usa deduplicação em memória; a fila Redis, buffering persistente e retomada automática de conversas não estão homologados de ponta a ponta. Não use os testes locais como certificação de produção.

Referências consultadas: [Structured Outputs OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Evolution Send Media](https://evolution-74046672.mintlify.app/v2/api-reference/message-controller/send-media), [rotas oficiais Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/sendMessage.router.ts).
