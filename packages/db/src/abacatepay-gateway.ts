import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingOffer, NormalizedBillingEvent } from '@sdr/shared';
import {
  BillingGatewayError,
  type BillingGateway,
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type WebhookRequest,
} from './billing-repository.js';

/**
 * Adapter do AbacatePay (API v2) para a cobrança da assinatura do SDR Flow.
 *
 * Contrato conferido em @abacatepay/types 3.0.3 (tipos oficiais, 27/07/2026):
 * - Autenticação `Authorization: Bearer <API key>`, base https://api.abacatepay.com/v2.
 * - Respostas no envelope `{ data, error, success }`; valores sempre em centavos.
 * - Checkout hospedado: POST /checkouts/create com `items` (produtos do painel),
 *   `frequency: 'SUBSCRIPTION'`, `externalId` (nossa referência opaca), `completionUrl`/`returnUrl`.
 * - Assinaturas: /subscriptions/cancel (imediato, sem "fim do período"),
 *   /subscriptions/change-plan (aplicado no próximo ciclo), /subscriptions/list.
 * - Webhook `{ id, event, devMode, data }`, eventos checkout.* / subscription.*.
 *
 * O preço cobrado vem do PRODUTO cadastrado no AbacatePay; por isso cada checkout
 * confere que o produto da oferta custa exatamente o valor do nosso catálogo.
 */
export interface AbacatePayConfig {
  apiKey: string;
  /** Segredo do webhook (o mesmo informado ao cadastrar o webhook no AbacatePay). */
  webhookSecret: string;
  /** Aceita eventos de ambiente de desenvolvimento (chave de dev). */
  devMode: boolean;
  /** Mapa opcional código da oferta → ID do produto; sem ele, busca por externalId. */
  productIds?: Record<string, string>;
  methods?: Array<'PIX' | 'CARD' | 'BOLETO'>;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

interface AbacateProduct {
  id: string;
  externalId?: string;
  price: number;
  currency?: string;
  status?: string;
}

interface AbacateCheckout {
  id: string;
  amount: number;
  paidAmount: number | null;
  externalId: string | null;
  url: string;
  status: string;
  customerId: string | null;
  receiptUrl?: string | null;
  devMode?: boolean;
}

interface AbacateSubscription {
  id: string;
  amount: number;
  currency?: string;
  externalId?: string;
  status: string;
  customerId?: string;
  devMode?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.abacatepay.com/v2';

/** Referência de produto no AbacatePay para uma oferta do catálogo (cadastro no painel). */
export function abacatePayProductExternalId(offer: Pick<BillingOffer, 'code' | 'version'>): string {
  return `sdrflow-${offer.code}-v${offer.version}`;
}

export function createAbacatePayGateway(config: AbacatePayConfig): BillingGateway {
  if (!config.apiKey) throw new Error('AbacatePay: BILLING_API_KEY ausente.');
  if (!config.webhookSecret || config.webhookSecret.length < 16) {
    throw new Error('AbacatePay: BILLING_WEBHOOK_TOKEN ausente ou curto demais (mínimo 16 caracteres).');
  }
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const methods = config.methods?.length ? config.methods : ['PIX', 'CARD'];
  const productCache = new Map<string, { product: AbacateProduct; at: number }>();

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BillingGatewayError('AbacatePay indisponível.', 'abacatepay_unreachable');
    }
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!response.ok || !envelope?.success || envelope.data == null) {
      // Mensagem do provedor fica no código de erro truncado; nunca inclui a chave.
      const detail = String(envelope?.error || response.status).slice(0, 60);
      throw new BillingGatewayError(`AbacatePay recusou a operação (${detail}).`, `abacatepay_${response.status}`);
    }
    return envelope.data;
  }

  async function productFor(offer: BillingOffer & { amountCents: number }): Promise<AbacateProduct> {
    const cached = productCache.get(offer.code);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.product;
    const configuredId = config.productIds?.[offer.code];
    const product = configuredId
      ? await call<AbacateProduct>('GET', `/products/get?id=${encodeURIComponent(configuredId)}`)
      : await call<AbacateProduct>('GET', `/products/get?externalId=${encodeURIComponent(abacatePayProductExternalId(offer))}`);
    if (product.status && product.status !== 'ACTIVE') {
      throw new BillingGatewayError(`Produto ${product.id} inativo no AbacatePay.`, 'product_inactive');
    }
    if (product.price !== offer.amountCents || (product.currency && product.currency.toUpperCase() !== offer.currency)) {
      // O AbacatePay cobra o preço do produto: divergência cobraria valor diferente do anunciado.
      throw new BillingGatewayError(
        `Preço do produto ${product.id} no AbacatePay (${product.price}) difere do catálogo (${offer.amountCents}).`,
        'product_price_mismatch',
      );
    }
    productCache.set(offer.code, { product, at: Date.now() });
    return product;
  }

  async function findSubscription(id: string): Promise<AbacateSubscription | null> {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query: string = `/subscriptions/list?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await doFetch(`${baseUrl}${query}`, {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      const envelope = (await response?.json().catch(() => null)) as (ApiEnvelope<AbacateSubscription[]> & { pagination?: { hasNext?: boolean; nextCursor?: string | null } }) | null;
      if (!response?.ok || !envelope?.success || !Array.isArray(envelope.data)) {
        throw new BillingGatewayError('Não foi possível consultar assinaturas no AbacatePay.', 'abacatepay_list_failed');
      }
      const found = envelope.data.find(item => item.id === id);
      if (found) return found;
      if (!envelope.pagination?.hasNext || !envelope.pagination.nextCursor) return null;
      cursor = envelope.pagination.nextCursor;
    }
    return null;
  }

  async function cancel(providerSubscriptionId: string) {
    await call('POST', '/subscriptions/cancel', { id: providerSubscriptionId });
  }

  return {
    provider: 'abacatepay',
    supportsCancelRevert: false,
    cancelNotice: 'No AbacatePay o cancelamento interrompe as próximas cobranças na hora e não pode ser desfeito. O acesso continua até o fim do período já pago.',

    async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
      const product = await productFor(input.offer);
      let customerId = input.providerCustomerId ?? null;
      if (!customerId && input.customerEmail) {
        // Cliente mínimo (só e-mail): CPF/CNPJ e cartão ficam com o AbacatePay no checkout.
        const customer = await call<{ id: string }>('POST', '/customers/create', { email: input.customerEmail }).catch(() => null);
        customerId = customer?.id ?? null;
      }
      const checkout = await call<AbacateCheckout>('POST', '/checkouts/create', {
        items: [{ id: product.id, quantity: 1 }],
        frequency: 'SUBSCRIPTION',
        methods,
        externalId: input.externalReference,
        completionUrl: input.successUrl,
        returnUrl: input.cancelUrl,
        ...(customerId ? { customerId } : {}),
      });
      if (checkout.amount !== input.offer.amountCents) {
        throw new BillingGatewayError('Valor do checkout diverge do catálogo.', 'checkout_amount_mismatch');
      }
      if (!/^https:\/\//.test(checkout.url)) {
        throw new BillingGatewayError('URL de checkout inválida.', 'checkout_url_invalid');
      }
      return { providerCheckoutId: checkout.id, checkoutUrl: checkout.url, providerCustomerId: customerId ?? checkout.customerId };
    },

    authenticateWebhook(request: WebhookRequest): boolean {
      // A chave "compartilhada" que o AbacatePay publica no SDK é pública: uma assinatura
      // feita com ela não prova nada. Exigimos o NOSSO segredo, por HMAC do corpo com o
      // segredo do webhook ou pelo parâmetro webhookSecret da URL cadastrada.
      const header = request.headers['x-webhook-signature'];
      const signature = Array.isArray(header) ? header[0] : header;
      if (signature) {
        const expected = createHmac('sha256', config.webhookSecret).update(request.rawBody).digest('base64');
        if (safeEqual(expected, signature)) return true;
      }
      const query = request.query?.webhookSecret;
      const querySecret = Array.isArray(query) ? query[0] : query;
      return typeof querySecret === 'string' && safeEqual(querySecret, config.webhookSecret);
    },

    parseWebhook(request: WebhookRequest): NormalizedBillingEvent[] {
      const body = request.body as { id?: unknown; event?: unknown; devMode?: unknown; data?: unknown } | null;
      if (!body || typeof body.id !== 'string' || typeof body.event !== 'string') {
        throw new BillingGatewayError('Webhook do AbacatePay sem id/event.', 'invalid_payload');
      }
      if (body.devMode === true && !config.devMode) {
        // Pagamento de teste nunca libera plano em produção.
        return [{ providerEventId: body.id, providerEventType: body.event, kind: 'other' }];
      }
      return [normalizeAbacateEvent(body.id, body.event, (body.data ?? {}) as Record<string, unknown>)];
    },

    async verifyEvent(event: NormalizedBillingEvent): Promise<NormalizedBillingEvent> {
      if (event.providerEventType.startsWith('checkout.') && event.providerPaymentId) {
        const checkout = await call<AbacateCheckout>('GET', `/checkouts/get?id=${encodeURIComponent(event.providerPaymentId)}`);
        const expectedStatus = event.kind === 'payment.refunded' ? 'REFUNDED' : event.kind === 'payment.confirmed' ? 'PAID' : null;
        if (expectedStatus && checkout.status !== expectedStatus) {
          throw new BillingGatewayError(`Checkout ${checkout.id} está ${checkout.status}, não ${expectedStatus}.`, 'verification_status_mismatch');
        }
        if (event.externalReference && checkout.externalId && checkout.externalId !== event.externalReference) {
          throw new BillingGatewayError('Referência do checkout diverge do evento.', 'verification_reference_mismatch');
        }
        if (checkout.devMode === true && !config.devMode) {
          return { ...event, kind: 'other' };
        }
        return {
          ...event,
          externalReference: checkout.externalId ?? event.externalReference ?? null,
          amountCents: checkout.paidAmount ?? checkout.amount,
          currency: 'BRL',
          providerCustomerId: event.providerCustomerId ?? checkout.customerId ?? null,
          invoiceUrl: event.invoiceUrl ?? httpsOrNull(checkout.receiptUrl),
        };
      }
      if (event.providerEventType === 'subscription.renewed' && event.providerSubscriptionId) {
        const subscription = await findSubscription(event.providerSubscriptionId);
        if (!subscription) {
          throw new BillingGatewayError('Assinatura do evento não encontrada no AbacatePay.', 'verification_subscription_missing');
        }
        if (subscription.status !== 'ACTIVE') {
          throw new BillingGatewayError(`Assinatura ${subscription.id} está ${subscription.status}.`, 'verification_status_mismatch');
        }
        if (subscription.devMode === true && !config.devMode) return { ...event, kind: 'other' };
        return {
          ...event,
          amountCents: event.amountCents ?? subscription.amount,
          currency: (subscription.currency || 'BRL').toUpperCase(),
          providerCustomerId: event.providerCustomerId ?? subscription.customerId ?? null,
        };
      }
      return event;
    },

    async setCancelAtPeriodEnd(providerSubscriptionId: string, cancelIt: boolean) {
      if (!cancelIt) {
        throw new BillingGatewayError(
          'O AbacatePay não permite desfazer um cancelamento. Assine novamente quando o período atual terminar.',
          'cancel_revert_unsupported',
        );
      }
      // Cancelamento no AbacatePay é imediato: interrompe as próximas cobranças. O
      // acesso já pago continua até current_period_end pelas regras do banco.
      await cancel(providerSubscriptionId);
    },

    async scheduleSubscriptionChange(providerSubscriptionId: string, offer: BillingOffer & { amountCents: number }) {
      const product = await productFor(offer);
      // change-plan é aplicado no próximo ciclo: o mesmo comportamento do nosso downgrade.
      await call('POST', '/subscriptions/change-plan', { id: providerSubscriptionId, productId: product.id, quantity: 1 });
    },

    async cancelSubscriptionNow(providerSubscriptionId: string) {
      await cancel(providerSubscriptionId);
    },
  };
}

/** Converte um evento do AbacatePay no formato normalizado (sem repassar o payload bruto). */
export function normalizeAbacateEvent(eventId: string, eventType: string, data: Record<string, unknown>): NormalizedBillingEvent {
  const obj = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const str = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null);
  const cents = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

  const billing = obj(data.billing ?? data.checkout);
  const payment = obj(data.payment);
  const subscription = obj(data.subscription);
  const customer = obj(data.customer);
  const base: NormalizedBillingEvent = { providerEventId: eventId.slice(0, 200), providerEventType: eventType.slice(0, 120), kind: 'other' };

  const checkoutFields = {
    externalReference: str(billing.externalId),
    providerPaymentId: str(billing.id),
    providerSubscriptionId: str(subscription.id) ?? str(billing.subscriptionId),
    providerCustomerId: str(billing.customerId) ?? str(customer.id),
    amountCents: cents(payment.amount) ?? cents(billing.paidAmount) ?? cents(billing.amount),
    currency: 'BRL',
    billingType: str(payment.method),
    invoiceUrl: httpsOrNull(billing.receiptUrl),
  };

  switch (eventType) {
    case 'checkout.completed':
      return { ...base, ...checkoutFields, kind: 'payment.confirmed' };
    case 'checkout.refunded':
      return { ...base, ...checkoutFields, kind: 'payment.refunded' };
    case 'checkout.lost':
      // Disputa perdida = chargeback efetivado.
      return { ...base, ...checkoutFields, kind: 'payment.chargeback' };
    case 'checkout.disputed':
      // Disputa aberta: fica registrada, sem alterar o plano até o desfecho (lost/refunded).
      return { ...base, ...checkoutFields, kind: 'other' };
    case 'subscription.completed':
    case 'subscription.trial_started':
    case 'subscription.renewed':
    case 'subscription.cancelled': {
      const sub = Object.keys(subscription).length ? subscription : data;
      const fields = {
        providerSubscriptionId: str(sub.id),
        externalReference: str(sub.externalId) ?? str(billing.externalId),
        providerCustomerId: str(sub.customerId) ?? str(customer.id),
        currency: 'BRL',
      };
      if (eventType === 'subscription.cancelled') return { ...base, ...fields, kind: 'subscription.canceled' };
      if (eventType === 'subscription.renewed') {
        return {
          ...base,
          ...fields,
          kind: 'payment.confirmed',
          // Cada renovação é um pagamento; sem ID próprio no evento, o ID do evento é único.
          providerPaymentId: str(payment.id) ?? str(billing.id) ?? `${eventId.slice(0, 180)}:renewal`,
          amountCents: cents(payment.amount) ?? cents(sub.amount),
          billingType: str(payment.method) ?? str(sub.method),
        };
      }
      // completed / trial_started só revelam o ID da assinatura (vínculo no banco).
      return { ...base, ...fields, kind: 'other' };
    }
    default:
      return base;
  }
}

function httpsOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^https:\/\/\S+$/.test(value) ? value.slice(0, 500) : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
