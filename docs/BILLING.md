# Billing: LP, checkout e assinatura por organização

Branch: `billing-plan`. Implementa o plano "LP, checkout e assinatura por organização" (23/09/2026).
Gateway integrado: **AbacatePay (API v2)**, detalhado na seção 3. Com `BILLING_PROVIDER` vazio a
cobrança fica desligada e a API responde `503`. Nada é simulado.

## 1. O que foi entregue

### Segurança do plano (entitlement)
- **Criar login não altera mais o plano.** `private.apply_target_login_provisioning` ignora `sdr_org_tier`.
  O campo saiu de `POST /api/admin/organizations/:id/logins` (o schema estrito devolve 400 se ele vier)
  e do formulário em Configurações.
- `organizations.tier` virou **projeção**: um trigger (`organizations_tier_guard`) recusa qualquer
  `UPDATE` do tier, inclusive com a chave de serviço, a menos que venha de `private.sync_org_entitlement`.
- O tier efetivo é calculado por `private.compute_org_entitlement`: uma concessão manual ativa ou uma
  assinatura válida (ativa, inadimplente dentro da carência ou cancelada até o fim do período), senão `pre-venda`.
  Toda mudança grava `billing_entitlement_changes` e `audit_events`.
- **Migração de dados:** organizações que já tinham tier diferente de `pre-venda` ganharam uma
  concessão auditada ("Plano atribuído manualmente antes da cobrança"). Assim, nenhum cliente atual é rebaixado.

### Banco (migration `20260923200000_billing_subscriptions.sql`)
| Tabela | Uso | Quem lê |
|---|---|---|
| `organization_subscriptions` | assinatura (uma corrente por organização; o histórico fica) | owner/admin |
| `checkout_intents` | pedido interno + `external_reference` opaca + idempotência | owner/admin |
| `billing_payments` | cada cobrança/ciclo, incluindo Pix/boleto pendente | owner/admin |
| `organization_plan_grants` | concessão manual (motivo obrigatório, expiração opcional) | owner/admin |
| `billing_entitlement_changes` | trilha de auditoria do tier | owner/admin |
| `organization_limits` | exceções manuais de limite por organização | membros |
| `private.billing_customers` | ID do cliente no gateway | só backend |
| `private.billing_webhook_events` | inbox durável de webhooks (idempotência por `provider_event_id`) | só backend |

Todas as tabelas têm RLS forçada, grants explícitos e FKs compostas `(organization_id, id)`. O navegador
não escreve em nada. A evidência financeira usa `on delete restrict`. Backup e restauração (`packages/db/src/backup.ts`)
incluem as tabelas públicas de billing; clientes do gateway e webhooks ficam de fora.

RPCs `security definer` executáveis **só com a chave de serviço**: `billing_open_checkout`, `billing_attach_checkout`,
`billing_fail_checkout`, `billing_record_event`, `billing_process_event`, `billing_claim_events`, `billing_mark_event_failed`,
`billing_run_maintenance`, `billing_reconciliation_report`, `billing_set_cancel_at_period_end`, `billing_schedule_downgrade`,
`billing_customer_for` e `billing_save_customer`. Para administradores da plataforma: `admin_grant_org_plan` e `admin_revoke_org_plan`.

### Regras de pagamento (`billing_process_event`, transacional e idempotente)
- A correlação usa **apenas referências gravadas por nós** (`external_reference`, ID da assinatura ou do pagamento).
  Se o evento não casar com nada, fica `unmatched` e não altera nenhuma organização.
- O pagamento inicial precisa ter **valor e moeda iguais ao pedido**. Se não tiver, vai para `needs_review` e o tier não muda.
- Pagamento pendente, checkout abandonado ou expirado não mudam o tier. O retorno do checkout também não.
- **Sem regressão:** um pagamento confirmado não volta a vencido. Estorno e chargeback prevalecem sobre qualquer evento atrasado.
- **Dois checkouts pagos** para a mesma organização: o segundo vai para `needs_review` e não cria outra assinatura.
- **Upgrade:** a mesma assinatura muda de tier só depois do pagamento. **Downgrade:** fica agendado e vale no próximo ciclo.
- **Renovação vencida:** a assinatura vira `past_due` com 3 dias de carência (`BILLING_GRACE_DAYS`) e depois é suspensa.
  Um pagamento tardio reativa.
- **Estorno ou chargeback** do pagamento vigente suspende a assinatura e retira o plano na hora (fica para revisão).
- **Cancelamento:** o acesso continua até `current_period_end`; depois a assinatura expira.
- O worker (`apps/worker`) roda a cada 60 s: reprocessa eventos pendentes ou com falha (backoff, `dead` após 10 tentativas),
  aplica fim de carência, fim de período, downgrades agendados e concessões vencidas. A cada ~1 h registra no log
  as divergências de `billing_reconciliation_report`.

### Limites por organização
- `private.plan_limits` e `PLAN_LIMITS` (`packages/shared/src/billing.ts`) definem os padrões. Um teste garante que as duas fontes não divergem.

  | Tier | Agentes | Números WhatsApp |
  |---|---|---|
  | Pré-Venda | 2 | 1 |
  | Vendedor | 5 | 3 |
  | Vendedor Sênior | ilimitado | ilimitado |

- A aplicação é atômica (advisory lock por organização). Agentes padrão (um por membro) contam no uso,
  mas nunca bloqueiam a criação de um login.
- Limites legados mais generosos, como instâncias ilimitadas, viraram exceção em `organization_limits` para quem já existia.
- `GET /api/me/agents` e o painel administrativo passaram a ler os limites efetivos por organização.
  Isso corrige o `maybeSingle()` sobre linhas por usuário.

### API (`apps/api/src/billing/routes.ts`)
| Rota | Acesso |
|---|---|
| `GET /api/billing/catalog` | público |
| `GET /api/me/billing` | membro. Owner e admin veem os dados financeiros; os demais, só o plano |
| `POST /api/me/billing/checkouts` | owner. O corpo tem só `offerCode` e `idempotencyKey`; o preço vem do catálogo |
| `GET /api/me/billing/checkouts/:id` | owner (polling da página de retorno) |
| `POST /api/me/billing/subscription/cancel` / `downgrade` | owner (exigem gateway) |
| `POST /api/webhooks/billing/:provider` | público, autenticado pelo adapter e fora do rate limit por organização |
| `GET/POST /api/admin/organizations/:id/billing`, `plan-grants`, `plan-grants/revoke`, `GET /api/admin/billing/reconciliation` | admin da plataforma |

### Web
- **`/` (LP) e `/pricing`:** públicas, em chunks separados, sempre no tema escuro Prodigi. A LP tem hero com
  prévia do produto, recursos, "como funciona", planos (mensal/anual), comparativo, FAQ e CTA final.
- **Plano escolhido sem sessão:** fica guardado como intenção em `sessionStorage` e em `?offer=`. Cadastro e
  login mostram o plano escolhido. Depois do login, a pessoa vai para `/billing?offer=…`.
- **`/billing`:** plano atual, situação, período, avisos de carência e suspensão, uso vs. limite, planos com
  upgrade e downgrade, cancelamento no fim do período e histórico de faturas.
- **`/billing/return`:** mostra "Aguardando confirmação" e consulta o pagamento com backoff (~3 min).
  Quando o plano é ativado, recarrega as capabilities (`session.refresh()`).
- **CTAs de upgrade:** "Fazer upgrade" no cabeçalho, na barra lateral (só para o owner, abaixo do Sênior),
  em Integrações bloqueadas e no limite de Agentes. Nova entrada "Plano e cobrança" na barra lateral.
- **Configurações:** o seletor de plano saiu do formulário de login. Entrou o painel "Plano da organização
  (administração)" para conceder ou revogar planos com motivo e expiração.
- **Correção em `session.tsx`:** um deep link com sessão, depois de um carregamento completo, era mandado
  para `/dashboard`. Isso quebraria o retorno do checkout e foi corrigido.

### Verificação
- `pnpm db:types:check` e `pnpm check`: 54 arquivos e 519 testes passando, build ok, bundle dentro do orçamento
  (+1,7 ponto de regressão inicial; a base já estava em 7,3%).
- `tests/billing.test.ts` (18 testes) cobre o banco: estados, RLS, limites, concessões e o espelho catálogo↔SQL.
- `tests/billing-api.test.ts` roda o fluxo LP → checkout → webhook → plano ativo de ponta a ponta,
  com RLS e RPCs reais em PGlite.
- No navegador (Playwright, com Supabase/API mockados): LP desktop e mobile sem scroll horizontal,
  preços → cadastro com oferta, `/billing` (normal, com oferta e inadimplente), retorno ativado. Sem erros de console.

## 2. O que falta para cobrar de verdade

### 2.1 Gateway
Integrado com o AbacatePay (seção 3). O que falta é **operacional**: cadastrar produtos e webhook,
configurar as variáveis e homologar no modo de desenvolvimento (checklist na seção 3.4).
Asaas, Mercado Pago e Stripe seguem o mesmo contrato `BillingGateway`, um arquivo por provedor.

### 2.2 Decisões de negócio (bloqueiam o lançamento)
- **Preços:** todas as ofertas estão com `amountCents: null` em `BILLING_OFFERS`. No AbacatePay o preço
  cobrado é o do produto, e cada checkout confere que ele é igual ao do catálogo. A LP mostra "Preço em definição"
  e a API recusa o checkout (`409 offer_without_price`). Preencher os valores e incrementar `CATALOG_VERSION`.
- **Pré-Venda gratuito ou pago:** hoje o cadastro cai em `pre-venda` sem pagamento, e existem ofertas pagas para ele.
- **Limites de instâncias (1/3/ilimitado):** a proposta é minha e precisa de confirmação. Organizações antigas
  ficaram com instâncias ilimitadas por exceção.
- Meios de pagamento do MVP, carência (3 dias), política de estorno, textos legais (termos e privacidade),
  dados fiscais e domínio da LP.

### 2.3 Pendências técnicas menores
- **Prorrata do upgrade:** no AbacatePay o upgrade cria uma assinatura nova com o valor cheio do plano
  novo, e a antiga é cancelada na hora, sem devolver os dias restantes. Se o negócio quiser compensar,
  é preciso decidir entre estorno parcial manual e cupom no checkout de upgrade.
- Endpoint de reparo com dry-run para itens `needs_review`, `unmatched` e `dead`. Hoje eles aparecem em
  `GET /api/admin/billing/reconciliation` e no log do worker, e o reparo é manual via SQL.
- Alertas (Sentry ou canal) para divergências da conciliação; hoje só há log `warn`.
- A LP é uma SPA: se a aquisição orgânica importar, avaliar prerender/SSR de `/` e `/pricing`.
- `tests/database.test.ts` e outros ainda mencionam `account_limits`. A tabela continua existindo por
  compatibilidade (provisionamento e admin), mas não é mais usada para aplicar limites. Removê-la depois de estabilizar.

### 2.4 LP de referência
A página https://prodigiadm.netlify.app/ ficou **inacessível neste ambiente**: o proxy de rede bloqueou o domínio
(403 no CONNECT). A LP foi construída com a identidade Prodigi que já existe no repositório (wordmark `pro(digi)`,
obsidiana `#0a0a0a`, verde `#2EE86B`, Sora + Inter) e com textos baseados nos recursos reais do produto. Para ficar
**idêntica** à referência, é preciso liberar o domínio na política de rede do ambiente ou enviar o HTML/prints.
Os ajustes ficam concentrados em `apps/web/src/billing/LandingPage.tsx`, `marketing.tsx` e no bloco `.lp` de `styles.css`.

## 3. Integração AbacatePay

### 3.1 Fonte do contrato
O domínio `docs.abacatepay.com` estava bloqueado no ambiente de desenvolvimento. O adapter segue os
**tipos oficiais** `@abacatepay/types` 3.0.3 (27/07/2026, "tipagens alinhadas à documentação oficial"),
lidos do registro npm. Por isso a homologação no modo de desenvolvimento (3.4) é obrigatória antes de cobrar.
Onde os tipos marcam o payload como não documentado (eventos `subscription.*`), o parser é defensivo:
aceita `data.subscription` ou o próprio `data`, e usa só IDs e valores.

### 3.2 Como funciona
| Etapa | AbacatePay | SDR Flow |
|---|---|---|
| Checkout | `POST /v2/checkouts/create` com `frequency: SUBSCRIPTION`, o produto da oferta, `externalId` = nossa referência opaca, `completionUrl` = `/billing/return`, `returnUrl` = `/billing` | Antes, confere que o produto está ativo e custa exatamente o valor do catálogo; senão recusa (`product_price_mismatch`). Cria o cliente só com e-mail; CPF/CNPJ e cartão ficam no AbacatePay. |
| Pagamento inicial | webhook `checkout.completed` | Reconsulta `GET /checkouts/get` (status `PAID`, valor, referência) e então libera o plano. |
| ID da assinatura | webhook `subscription.completed`, em qualquer ordem | Guardado no pedido e copiado para a assinatura (`private.billing_link_subscriptions`). |
| Renovação | webhook `subscription.renewed` | Confere a assinatura como `ACTIVE` via `/subscriptions/list` e estende o período. |
| Estorno / disputa perdida | `checkout.refunded` / `checkout.lost` | Suspende e retira o plano (regra existente). `checkout.disputed` só fica registrado. |
| Cancelamento pelo dono | `POST /v2/subscriptions/cancel` (**imediato** no AbacatePay) | O acesso continua até o fim do período pago. **Não pode ser desfeito**: a tela avisa antes e esconde "Manter assinatura". |
| Downgrade | `POST /v2/subscriptions/change-plan` (vale no próximo ciclo) | Igual ao downgrade agendado já existente. |
| Upgrade | Novo checkout de assinatura com o produto maior | Plano liberado após o pagamento. O ID da assinatura passa para a nova, a antiga vai para `private.billing_replaced_subscriptions` e o **worker a cancela no AbacatePay**. Eventos da antiga são ignorados, então não derrubam o plano novo. |

**Segurança do webhook.** A chave "compartilhada" que o SDK do AbacatePay usa para assinar webhooks é
**pública** (vem no pacote npm), então uma assinatura feita com ela não prova nada. O endpoint aceita só:
(a) `X-Webhook-Signature` = HMAC-SHA256 em base64 do corpo com o **nosso** `BILLING_WEBHOOK_TOKEN`; ou
(b) `?webhookSecret=<BILLING_WEBHOOK_TOKEN>` na URL cadastrada. Mesmo autenticado, todo evento que
libera ou retira plano é reconsultado na API com a nossa chave. Eventos `devMode` (sandbox) nunca
liberam plano quando `ABACATEPAY_DEV_MODE=false` (o padrão em produção). O Nginx não grava access log
de `/api/webhooks/billing/`, para o segredo da URL não ir para os logs.

### 3.3 Configuração
| Variável (API e worker) | Valor |
|---|---|
| `BILLING_PROVIDER` | `abacatepay` |
| `BILLING_API_KEY` | chave da API do AbacatePay (a de desenvolvimento para homologar) |
| `BILLING_WEBHOOK_TOKEN` | segredo aleatório com 16+ caracteres (ex.: `openssl rand -hex 32`) |
| `ABACATEPAY_DEV_MODE` | `true` na homologação, `false` em produção (padrão: `NODE_ENV !== production`) |
| `ABACATEPAY_PRODUCT_IDS` | opcional: `{"vendedor-mensal":"prod_…",…}`. Sem ele, o produto é buscado pelo externalId `sdrflow-<oferta>-v<versão>` |
| `ABACATEPAY_METHODS` | opcional: `PIX,CARD` (padrão) ou incluindo `BOLETO` |
| `PUBLIC_APP_URL` | URL pública do app (retorno do checkout) |

Se `BILLING_PROVIDER` for inválido ou faltar variável, a API e o worker **falham ao iniciar** em vez de rodar sem cobrança.

### 3.4 Checklist de ativação
1. Definir os preços em `BILLING_OFFERS` (`packages/shared/src/billing.ts`).
2. No painel do AbacatePay, criar **um produto por oferta paga**, com preço igual ao catálogo e ciclo
   de cobrança (mensal ou anual), e com externalId `sdrflow-<oferta>-v1` (ex.: `sdrflow-vendedor-mensal-v1`).
   Outra opção é informar os IDs em `ABACATEPAY_PRODUCT_IDS`. Ao mudar preço, incremente
   `CATALOG_VERSION` e crie novos produtos (`…-v2`).
3. Cadastrar o webhook (painel ou `POST /v2/webhooks/create`):
   - endpoint `https://<domínio>/api/webhooks/billing/abacatepay?webhookSecret=<BILLING_WEBHOOK_TOKEN>`;
   - `secret` = o mesmo token;
   - eventos `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`,
     `subscription.completed`, `subscription.renewed`, `subscription.cancelled`.
4. Configurar as variáveis da seção 3.3 na API e no worker e aplicar as migrations `20260923200000` e `20260924120000`.
5. Homologar no modo de desenvolvimento:
   - Pix e cartão;
   - retorno antes e depois do webhook;
   - `subscription.completed` antes e depois de `checkout.completed`;
   - renovação, upgrade (confirmar o cancelamento da assinatura antiga), downgrade, cancelamento e estorno.

   Confira em `GET /api/admin/billing/reconciliation`: o esperado é nenhum
   `subscription_without_provider_id` e nenhum `replaced_subscription_not_canceled`.
6. **Pontos a confirmar na homologação** (não documentados nos tipos):
   - se `subscription.*` traz `externalId` ou `customerId` (o vínculo usa um ou outro);
   - se `subscription.renewed` traz ID e valor do pagamento;
   - se o checkout de assinatura exige CPF/CNPJ do cliente antes do pagamento.
7. Trocar para a chave de produção e `ABACATEPAY_DEV_MODE=false`.
