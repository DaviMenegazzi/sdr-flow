# Billing: LP, checkout e assinatura por organização

Branch: `billing-plan`. Implementa o plano "LP, checkout e assinatura por organização" (23/09/2026)
**sem nenhum gateway conectado**. Tudo o que depende do provedor está atrás do contrato
`BillingGateway` e, sem adapter, a API responde `503`. Nada é simulado.

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

### 2.1 Adapter do gateway (obrigatório)
Hoje `resolveBillingGateway` (`apps/api/src/billing/gateway.ts`) devolve `null` para qualquer `BILLING_PROVIDER`.
Para o Asaas, que é o recomendado no plano, falta criar `apps/api/src/billing/asaas.ts` implementando `BillingGateway`
(`packages/db/src/billing-repository.ts`):

1. **`createCheckout`:** criar ou reusar o cliente (`/v3/customers`, sem guardar CPF ou cartão aqui) e criar o checkout
   recorrente (`/v3/checkouts`, `chargeTypes: RECURRENT`, `subscription.cycle` MONTHLY/YEARLY) com
   `externalReference = input.externalReference`, `callback.successUrl/cancelUrl` e valor do catálogo.
   Deve retornar `providerCheckoutId`, `checkoutUrl` e `providerCustomerId`. Para upgrade, decidir entre atualizar
   a assinatura (`POST /v3/subscriptions/{id}` com novo `value`) e cobrar a diferença (ver 2.3).
2. **`authenticateWebhook`:** comparar o header `asaas-access-token` com `BILLING_WEBHOOK_TOKEN` em tempo constante
   (reusar `secretMatches` de `whatsapp/webhook-auth.ts`).
3. **`parseWebhook`:** mapear `PAYMENT_CREATED`→`payment.created`, `PAYMENT_CONFIRMED`→`payment.confirmed`,
   `PAYMENT_RECEIVED`→`payment.received`, `PAYMENT_OVERDUE`→`payment.overdue`, `PAYMENT_REFUNDED`→`payment.refunded`,
   `PAYMENT_CHARGEBACK_REQUESTED`/`CHARGEBACK_DISPUTE`→`payment.chargeback`, `PAYMENT_DELETED`→`payment.canceled`,
   `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED`→`subscription.canceled`, `CHECKOUT_EXPIRED`→`checkout.expired`,
   `CHECKOUT_CANCELED`→`checkout.canceled`, e o resto→`other`. Converter `value` (reais) em centavos. Usar `event.id` como
   `providerEventId`. Preencher `externalReference`, `subscription`, `payment.id`, `customer`, `invoiceUrl`, `dueDate`
   e `paymentDate`. **Não** repassar o payload bruto: o schema `normalizedBillingEventSchema` é estrito.
4. **`verifyEvent`:** para eventos críticos, fazer `GET /v3/payments/{id}` e sobrescrever status, valor, moeda e IDs com a resposta da API.
5. **`setCancelAtPeriodEnd` e `scheduleSubscriptionChange`:** chamar os endpoints de assinatura do Asaas
   (cancelamento ao fim do ciclo e alteração de `value` para o próximo ciclo).
6. Registrar o adapter em `resolveBillingGateway` e configurar `BILLING_PROVIDER=asaas`, `BILLING_API_KEY`
   e `BILLING_WEBHOOK_TOKEN` (já estão em `.env.example` e `docker-compose.yml`, só no servidor).
7. **Decisão pendente:** qual evento ativa o plano. Hoje ativa em `payment.confirmed` **ou** `payment.received`.
   Se o negócio quiser ativar só no `PAYMENT_RECEIVED` (dinheiro compensado), basta o adapter mapear
   `PAYMENT_CONFIRMED` para `other`.
8. **Homologação no sandbox:** Pix, cartão e boleto; retorno antes e depois do webhook; reentrega duplicada;
   eventos fora de ordem; renovação; chargeback; troca de plano.

Mercado Pago e Stripe seguem o mesmo contrato (um arquivo por provedor). Não é preciso mudar o banco nem a UI.

### 2.2 Decisões de negócio (bloqueiam o lançamento)
- **Preços:** todas as ofertas estão com `amountCents: null` em `BILLING_OFFERS`. A LP mostra "Preço em definição"
  e a API recusa o checkout (`409 offer_without_price`). Preencher os valores e incrementar `CATALOG_VERSION`.
- **Pré-Venda gratuito ou pago:** hoje o cadastro cai em `pre-venda` sem pagamento, e existem ofertas pagas para ele.
- **Limites de instâncias (1/3/ilimitado):** a proposta é minha e precisa de confirmação. Organizações antigas
  ficaram com instâncias ilimitadas por exceção.
- Meios de pagamento do MVP, carência (3 dias), política de estorno, textos legais (termos e privacidade),
  dados fiscais e domínio da LP.

### 2.3 Pendências técnicas menores
- **Prorrata do upgrade:** hoje o checkout de upgrade cobra o valor cheio da nova oferta. Se o Asaas não fizer
  prorrata, definir "cobrar a diferença" ou "trocar no próximo ciclo".
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
