# Plano de implantação — Treinar meu SDR

## Estado da implantação — 22/09/2026

Implementado nesta branch: jornada guiada de empresa, vendas, fatos e teste; perfil e fatos em rascunho/aprovação no Postgres com RLS; sugestões de perguntas usando a chave do agente; projeção transacional dos fatos aprovados na base existente; checagem de prontidão; teste do fluxo publicado com a chave/modelo do agente; prompt do perfil aprovado no runtime; RAG desligado respeitado; novo template SDR com `context.knowledge`. A antiga simulação de respostas fixas do agente foi substituída pela execução real em playground isolado.

Verificado: `pnpm db:types:check` e `pnpm check` passaram (481 testes). A rota `/training` foi aberta no navegador, mas o ambiente local redirecionou para login; a jornada autenticada ainda precisa de validação visual e homologação com Supabase/OpenAI reais. As migrações foram testadas em PGlite e aplicadas ao projeto Supabase `mppsvwqjmlvgsakqtpiw` como `20260923014516_ai_training_mvp` e `20260923014650_training_functions_invoker`; tabelas, RLS, políticas e funções foram conferidas após a aplicação. As quatro funções do treinamento executam como `SECURITY INVOKER` e não geram alertas novos no Security Advisor.

Pendente para o MVP completo: validação visual autenticada de ponta a ponta; teste com provedor real; registro explícito da revisão do conhecimento por execução; cinco perguntas obrigatórias com resultado persistido; fluxo de ativação guiado; importação/revisão dos documentos já existentes. A checagem atual informa prontidão da configuração e não ativa o WhatsApp.

## Objetivo e recorte

Trocar a primeira experiência de “criar documentos RAG” por uma jornada guiada que transforme respostas do responsável pela empresa em um perfil revisável, fatos aprovados e perguntas de teste. A chave OpenAI apenas autentica chamadas; o conhecimento permanece no Supabase da organização. O MVP não faz fine-tuning, importação de site/arquivos nem aprendizado automático a partir de conversas reais.

Resultado esperado: um administrador configura o primeiro agente sem conhecer RAG ou editar JSON do fluxo, confirma o que o agente pode afirmar, testa cinco perguntas e só então ativa a utilização no atendimento.

## Estado atual verificado

| Peça | Estado e implicação |
|---|---|
| `apps/web/src/knowledge/KnowledgePage.tsx` | Cadastro manual de título, coleção e texto; busca de teste. Textos e exemplos são específicos do Vida Card e há afirmações absolutas de precisão. Deve virar uma interface genérica. |
| `apps/web/src/agents/AgentDrawer.tsx` e `AgentsPage.tsx` | Salvam `system_prompt` e `tool_policy.rag`, além da chave por agente. A interface não é, por si, a garantia de que esses dados chegam ao runtime. |
| `apps/api/src/app.ts` | CRUD `/api/organizations/:org/knowledge`, busca e playground; teste do playground escolhe mock ou OpenAI configurada no servidor. |
| `packages/db/src/knowledge-repository.ts` | Persiste documentos por organização e usa embedding lexical determinístico de 64 dimensões; não há chamada a embeddings semânticos externos. |
| `packages/flow/src/catalog.ts` e `executors/index.ts` | O nó `context.knowledge` é explícito no grafo e fornece `knowledgeSnippets` às etapas seguintes. A recuperação depende de haver esse nó antes do agente. |
| `packages/flow/src/templates.ts` | O template SDR básico não inclui `context.knowledge`. A simples existência de documentos não habilita consulta. |
| `packages/runtime/src/turns/turn-processor.ts` | O WhatsApp usa a chave/modelo do agente e fornece a busca ao executor. Hoje a leitura do agente seleciona apenas `model`: é necessário conectar `system_prompt` e `tool_policy.rag` ao comportamento real. |
| `supabase/migrations/202609080004_knowledge_and_context.sql` | `knowledge_documents` tem `organization_id` e RLS. A função `match_knowledge` é `SECURITY DEFINER`; auditar autorização interna e `EXECUTE` antes de reutilizá-la em novas rotas. |
| `supabase/migrations/202609120008_account_operations.sql` | Conhecimento recebeu campos de vínculo a usuário/instância. O escopo efetivo da busca continua por organização; decidir explicitamente se o MVP compartilha o conteúdo entre agentes da mesma organização. |

## Decisões de produto recomendadas

1. **Escopo:** perfil e fatos são da organização; cada agente pode ter instruções próprias. No MVP, agentes da mesma organização consultam os mesmos fatos aprovados. Seleção por agente/instância fica para uma etapa posterior.
2. **Propriedade:** somente `owner` e `admin` editam/aprovam. Demais membros podem visualizar e testar conforme suas capacidades. A API deve aplicar a mesma regra da RLS.
3. **Publicação:** respostas da entrevista e texto gerado são rascunhos. Somente itens aprovados entram na consulta do atendimento. Corrigir um fato cria nova revisão; exclusão/desativação impede uso futuro.
4. **Fontes:** cada fato mantém origem (`entrevista`, `manual` ou, futuramente, `site`), responsável, data de aprovação e data de revisão. Preço precisa de valor, moeda, condições, vigência e fonte.
5. **Comportamento x fatos:** tom, roteiro e handoff ficam nas instruções do agente/fluxo; dados sobre produtos e políticas ficam no perfil/base. Não gerar um `system_prompt` monolítico misturando os dois.
6. **Versão:** `flow_versions` continuam imutáveis. Registrar na execução a revisão do perfil/conhecimento usada, para que a resposta seja auditável; não modificar uma versão publicada ao corrigir fatos.
7. **Teste:** o assistente de treino deve usar o mesmo agente, modelo, fluxo publicado ou prévia explicitamente identificada, e a mesma busca do WhatsApp. O playground atual usa uma escolha de provedor diferente; precisa ser alinhado para não dar falsa confiança.
8. **Limite:** até dois agentes/instâncias é uma regra de conta existente, não um limite da base de conhecimento. A jornada não deve duplicar conteúdo para cada instância.

## Jornada da tela

Entrada em `Agentes de IA > Treinar SDR`; `/knowledge` pode continuar como visão avançada, renomeada para “Conhecimento”, sem exigir que o usuário a abra primeiro.

| Etapa | O usuário faz | O sistema mostra/salva |
|---|---|---|
| 1. Empresa | Informa nome, segmento, público, oferta, região e horários | Perfil estruturado em rascunho, com campos faltantes visíveis |
| 2. Vendas | Define objetivo, perguntas de qualificação, objeções, tom e quando chamar humano | Prévia das instruções do agente; nada é publicado automaticamente |
| 3. Fatos | Cadastra produtos, preços/condições, políticas e FAQ por perguntas simples | Cartões de fatos com origem, estado e aviso de conflito/ausência |
| 4. Revisão | Confirma, corrige ou descarta as sugestões | Somente aprovados passam a ser recuperáveis |
| 5. Teste | Faz cinco perguntas: oferta, preço conhecido, preço ausente, objeção e handoff | Resposta, fonte usada, lacuna identificada e ação “corrigir conhecimento” |
| 6. Ativação | Escolhe o agente e confirma o fluxo que usará o contexto | Checagem de chave, fluxo, nó de conhecimento, permissões e fatos aprovados; falhas bloqueiam a ativação |

Estados da tela: vazio, rascunho, aguardando revisão, pronto para teste, pronto para ativar, ativo e precisa de revisão. Salvar progresso a cada etapa e permitir retomada.

## Modelo de dados e contratos

Criar migração nova, sem alterar migrações anteriores:

- `organization_training_profiles`: `id`, `organization_id`, `status`, `revision`, `company_json`, `sales_json`, `created_by`, `approved_by`, `approved_at`, timestamps. Schema Zod compartilhado define campos e limites; JSON permite evolução controlada do formulário.
- `knowledge_facts`: `id`, `organization_id`, `profile_id`, `type`, `question`, `answer`, `structured_value`, `source_type`, `source_reference`, `status`, `revision`, `review_at`, `created_by`, `approved_by`, timestamps. `status` distingue rascunho, aprovado e arquivado. Índices por organização/status/tipo. FK composta `(organization_id, profile_id)`.
- No MVP, espelhar fatos aprovados em `knowledge_documents` por serviço transacional, com `metadata` contendo `fact_id` e `revision`; remover/atualizar o espelho ao arquivar/revisar. Isso reutiliza o nó existente sem deixar rascunhos na busca. Preferir uma função/RPC transacional idempotente para aprovação e sincronização.
- Acrescentar à execução um identificador ou revisão do perfil e dos fatos consultados no trace do `context.knowledge` (sem guardar segredos). Conferir o formato de `flow_execution_steps` antes da implementação.
- Toda tabela de negócio: `organization_id`, RLS com papéis corretos e FKs compostas entre entidades da organização. Atualizar tipos via `pnpm db:types`.

API proposta sob `/api/organizations/:org/training`:

| Método/caminho | Finalidade |
|---|---|
| `GET /profile` | Ler perfil e estado da jornada |
| `PUT /profile` | Salvar rascunho validado |
| `POST /suggestions` | Gerar sugestões a partir das respostas, com saída estruturada; exige chave válida e nunca publica |
| `GET /facts` / `POST /facts` / `PATCH /facts/:id` | Listar, criar e corrigir fatos |
| `POST /facts/:id/approve` / `POST /facts/:id/archive` | Mudar o que pode ser usado no atendimento |
| `POST /test` | Executar pergunta pelo caminho do agente/fluxo escolhido, sem envio externo |
| `GET /readiness?agentId=...` | Informar bloqueios e lacunas antes de ativar |

Definir contratos no `packages/shared` e reutilizar Zod na UI e API. Respostas de sugestão devem ter schema estrito, limite de tamanho, custo/tokens registrados e indicação de que são propostas. Não salvar nem devolver a API key ao navegador. Revisar `checkScope`, capacidades e RLS; uma rota mutável não pode depender apenas do escopo `knowledge:write`.

## Sequência de implantação

### 0. Corrigir o contrato atual do agente

Verificar e ligar `ai_agents.system_prompt` e `tool_policy.rag` ao runtime. Definir precedência explícita entre instruções do agente e configurações dos nós. Para um agente com RAG ligado, o fluxo ativo precisa conter `context.knowledge` antes da decisão; inserir automaticamente apenas em novo template ou oferecer uma atualização de rascunho revisável. Publicar cria versão nova, sem mexer nas existentes. Para RAG desligado, impedir que o runtime injete trechos mesmo se o nó estiver presente, ou documentar outra semântica consistente e testá-la.

### 1. Dados e serviços

Adicionar migração, tipos e repositórios de perfil/fatos. Implementar aprovação transacional e projeção em `knowledge_documents`, com reprocessamento idempotente. Auditar a função de busca e impedir retorno de fatos de outras organizações ou não aprovados. Medir qualidade da busca lexical atual com perguntas reais em português; só escolher embeddings externos se houver ganho verificável.

### 2. API e geração assistida

Criar rotas e schemas. Gerar um resumo/FAQ sugerido com a chave do agente selecionado, usando saída estruturada, sem afirmar dados que não vieram da entrevista. Retornar lacunas e conflitos. Tratar chave ausente, provedor indisponível, limite de custo e saída inválida como erros explícitos; permitir preencher manualmente.

### 3. Tela e navegação

Criar `apps/web/src/training/TrainingPage.tsx` com etapas e componentes menores (`CompanyStep`, `SalesStep`, `FactsStep`, `ReviewStep`, `TestStep`). Adicionar rota em `main.tsx`, acesso em `AgentsPage.tsx`/`AgentDrawer.tsx` e link de navegação. Adaptar `KnowledgePage.tsx` para visão avançada genérica: retirar exemplos Vida Card e promessas de “100% de precisão”. Mostrar status aprovado/rascunho e origem.

### 4. Teste e ativação

Reusar `runPlayground` e a busca do runtime, parametrizando agente, chave, modelo e fluxo selecionados de modo seguro. Mostrar trechos/fatos efetivamente usados, revisões e motivos de ausência. A checagem de prontidão valida chave, permissões, fluxo publicado, nó de contexto, conteúdo aprovado e perguntas críticas. Ativação não pode simular sucesso de provedor nem enviar WhatsApp durante o teste.

### 5. Migração de dados existentes

Não reclassificar automaticamente os documentos atuais como fatos aprovados. Mantê-los disponíveis na aba avançada; oferecer revisão/importação para o novo modelo com identificação de origem. Se houver conteúdo Vida Card real, tratá-lo como dado da organização, sem copiá-lo para outras contas.

## Arquivos previstos

| Área | Arquivos existentes a alterar | Novos arquivos prováveis |
|---|---|---|
| Web | `apps/web/src/main.tsx`, `components/layout/AppSidebar.tsx`, `agents/AgentsPage.tsx`, `agents/AgentDrawer.tsx`, `knowledge/KnowledgePage.tsx`, `builder/PlaygroundModal.tsx` | `apps/web/src/training/*` |
| API | `apps/api/src/app.ts` (preferir extrair rotas para módulo), configuração de provedor | `apps/api/src/training/routes.ts`, serviço de sugestões |
| Contratos | `packages/shared/src/index.ts` ou módulo exportado | `packages/shared/src/training.ts` |
| Persistência | `packages/db/src/index.ts`, `packages/db/src/database.types.ts`, `packages/db/src/knowledge-repository.ts`, gerador de tipos | `packages/db/src/training-repository.ts`, nova migração em `supabase/migrations/` |
| Fluxo/runtime | `packages/flow/src/templates.ts`, `packages/flow/src/executors/index.ts`, `packages/runtime/src/turns/turn-processor.ts` | Testes de integração do treino/runtime |
| Testes | `tests/knowledge-context.test.ts`, testes de auth/org e playground | `tests/training-mvp.test.ts` |

Os nomes novos são uma proposta de organização; conferir os módulos e padrões atuais antes de criar cada arquivo. Há alterações locais não relacionadas no working tree: preservar todas.

## Critérios de aceite

1. Um administrador de uma organização nova completa a entrevista, salva, sai, volta e retoma sem perda.
2. Sugestão gerada pela IA nunca entra no atendimento antes da aprovação. Uma correção aprovada substitui a versão anterior; arquivar remove o fato da próxima consulta.
3. Usuário de outra organização não consegue ler, alterar, testar ou aprovar o perfil/fatos, nem por chamada direta à API/SQL com JWT.
4. Pergunta de preço conhecido retorna o valor e a fonte corretos. Preço ausente não é inventado e conduz à regra de encaminhamento; teste com resposta do provedor real.
5. O teste mostra a mesma seleção de agente, modelo, fluxo e conhecimento que o atendimento real. Se não houver chave, fluxo ou provedor, mostra bloqueio real.
6. Alterar o perfil/fato não modifica `flow_versions` já publicadas; a execução registra qual revisão do conhecimento foi consultada.
7. Desligar RAG tem efeito observável no atendimento real, não apenas no checkbox.
8. `pnpm db:types:check` e `pnpm check` passam. Validar visualmente a jornada no navegador, incluindo telas vazias, erros, retomada e aprovação.

## Fora do MVP / etapa seguinte

Importar website, PDF e planilhas; sincronização periódica; sugestões baseadas em conversas reais; seleção de conhecimento por agente/instância; embeddings semânticos externos. Essas capacidades exigem origem confiável, controle de atualização e revisão humana e devem entrar depois da jornada guiada básica.
