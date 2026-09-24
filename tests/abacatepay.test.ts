import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PGlite } from '@electric-sql/pglite';
import * as database from '../packages/db/src/index.js';
import {
  BillingRepository,
  cancelReplacedSubscriptions,
  createAbacatePayGateway,
  normalizeAbacateEvent,
  resolveBillingGateway,
} from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { BILLING_OFFERS } from '../packages/shared/src/index.js';
import { testDatabase } from './helpers/database.js';
import { pgClient } from './helpers/pg-supabase.js';

const SECRET = 'whsec_test_0123456789abcdef';
// Chave publicada no SDK oficial (@abacatepay/types): qualquer um pode assinar com ela.
const PUBLIC_SHARED_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const pricedOffers = BILLING_OFFERS.map(offer => ({ ...offer, amountCents: offer.tier === 'vendedor' ? 19700 : offer.tier === 'vendedor-senior' ? 39700 : 9700 }));
const offer = (code: string) => pricedOffers.find(item => item.code === code)! as (typeof pricedOffers)[number] & { amountCents: number };

/** Servidor AbacatePay simulado: guarda produtos, checkouts e assinaturas como a API v2 responde. */
function fakeAbacatePay() {
  const calls: Array<{ method: string; path: string; body: any; auth: string | null }> = [];
  const products = new Map<string, { id: string; externalId: string; price: number; currency: string; status: string }>();
  for (const item of pricedOffers) {
    const id = `prod_${item.code}`;
    products.set(id, { id, externalId: `sdrflow-${item.code}-v${item.version}`, price: item.amountCents, currency: 'BRL', status: 'ACTIVE' });
  }
  const checkouts = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let seq = 0;
  const ok = (data: unknown, extra: object = {}) => new Response(JSON.stringify({ data, error: null, success: true, ...extra }), { status: 200 });
  const fail = (status: number, error: string) => new Response(JSON.stringify({ data: null, error, success: false }), { status });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v2/, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', path, body, auth: new Headers(init?.headers).get('authorization') });
    if (path === '/products/get') {
      const id = url.searchParams.get('id');
      const externalId = url.searchParams.get('externalId');
      const product = id ? products.get(id) : [...products.values()].find(item => item.externalId === externalId);
      return product ? ok(product) : fail(404, 'Product not found');
    }
    if (path === '/customers/create') return ok({ id: `cust_${++seq}`, email: body.email });
    if (path === '/checkouts/create') {
      const product = products.get(body.items[0].id)!;
      const checkout = { id: `bill_${++seq}`, amount: product.price, paidAmount: null, externalId: body.externalId, url: `https://app.abacatepay.com/pay/bill_${seq}`, status: 'PENDING', customerId: body.customerId ?? null, devMode: true, receiptUrl: null, productId: product.id };
      checkouts.set(checkout.id, checkout);
      return ok(checkout);
    }
    if (path === '/checkouts/get') {
      const checkout = checkouts.get(url.searchParams.get('id') ?? '');
      return checkout ? ok(checkout) : fail(404, 'Not found');
    }
    if (path === '/subscriptions/list') return ok([...subscriptions.values()], { pagination: { limit: 100, hasNext: false, hasPrevious: false, nextCursor: null } });
    if (path === '/subscriptions/cancel') {
      const subscription = subscriptions.get(body.id);
      if (!subscription) return fail(404, 'Not found');
      subscription.status = 'CANCELLED';
      return ok(subscription);
    }
    if (path === '/subscriptions/change-plan') return ok({ id: `chg_${++seq}`, subscriptionId: body.id, status: 'PENDING', productId: body.productId, quantity: 1, newAmount: products.get(body.productId)!.price, requestedAt: new Date().toISOString() });
    return fail(404, `Unknown route ${path}`);
  }) as typeof fetch;

  /** O "cliente pagou": marca o checkout, cria a assinatura e devolve os webhooks v2. */
  function pay(checkoutId: string) {
    const checkout = checkouts.get(checkoutId)!;
    checkout.status = 'PAID';
    checkout.paidAmount = checkout.amount;
    checkout.receiptUrl = `https://app.abacatepay.com/receipt/${checkoutId}`;
    const subscription = { id: `subs_${++seq}`, amount: checkout.amount, currency: 'BRL', externalId: checkout.externalId, status: 'ACTIVE', customerId: checkout.customerId, devMode: true };
    subscriptions.set(subscription.id, subscription);
    return {
      subscription,
      completed: { id: `log_${++seq}`, event: 'checkout.completed', devMode: true, data: { payment: { amount: checkout.amount, fee: 80, method: 'PIX' }, billing: { amount: checkout.amount, id: checkout.id, externalId: checkout.externalId, status: 'PAID', url: checkout.url } } },
      subscriptionCompleted: { id: `log_${++seq}`, event: 'subscription.completed', devMode: true, data: { subscription } },
    };
  }
  return { fetch: fetchImpl, calls, checkouts, subscriptions, products, pay };
}

function signed(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac('sha256', secret).update(raw).digest('base64') };
}

describe('AbacatePay configuration', () => {
  it('stays disabled without a provider and refuses unknown or incomplete configuration', () => {
    expect(resolveBillingGateway({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveBillingGateway({ BILLING_PROVIDER: 'none' } as NodeJS.ProcessEnv)).toBeNull();
    expect(() => resolveBillingGateway({ BILLING_PROVIDER: 'asaas' } as NodeJS.ProcessEnv)).toThrow('não tem adapter');
    expect(() => resolveBillingGateway({ BILLING_PROVIDER: 'abacatepay', BILLING_API_KEY: 'k' } as NodeJS.ProcessEnv)).toThrow('BILLING_WEBHOOK_TOKEN');
    expect(() => resolveBillingGateway({ BILLING_PROVIDER: 'abacatepay', BILLING_API_KEY: 'k', BILLING_WEBHOOK_TOKEN: SECRET, ABACATEPAY_PRODUCT_IDS: '{"inexistente":"prod"}' } as NodeJS.ProcessEnv)).toThrow('oferta desconhecida');
    const gateway = resolveBillingGateway({ BILLING_PROVIDER: 'abacatepay', BILLING_API_KEY: 'k', BILLING_WEBHOOK_TOKEN: SECRET, ABACATEPAY_METHODS: 'pix,card' } as NodeJS.ProcessEnv);
    expect(gateway?.provider).toBe('abacatepay');
    expect(gateway?.supportsCancelRevert).toBe(false);
  });
});

describe('AbacatePay adapter', () => {
  const server = fakeAbacatePay();
  const gateway = createAbacatePayGateway({ apiKey: 'abc_dev_key', webhookSecret: SECRET, devMode: true, fetch: server.fetch });

  it('authenticates webhooks with our secret only — never with the public shared key', () => {
    const body = { id: 'log_1', event: 'checkout.completed', devMode: true, data: {} };
    const ours = signed(body);
    const forgedWithPublicKey = signed(body, PUBLIC_SHARED_KEY);
    const req = (headers: Record<string, string>, query: Record<string, string> = {}, raw = ours.raw) => ({ headers, rawBody: Buffer.from(raw), body, query });
    expect(gateway.authenticateWebhook(req({ 'x-webhook-signature': ours.signature }))).toBe(true);
    expect(gateway.authenticateWebhook(req({ 'x-webhook-signature': forgedWithPublicKey.signature }))).toBe(false);
    expect(gateway.authenticateWebhook(req({}, { webhookSecret: SECRET }))).toBe(true);
    expect(gateway.authenticateWebhook(req({}, { webhookSecret: 'wrong-secret-value' }))).toBe(false);
    expect(gateway.authenticateWebhook(req({ 'x-webhook-signature': ours.signature }, {}, `${ours.raw} `))).toBe(false);
  });

  it('normalizes the v2 events it relies on, without passing the raw payload through', () => {
    expect(normalizeAbacateEvent('e1', 'checkout.completed', { payment: { amount: 19700, method: 'CARD' }, billing: { id: 'bill_1', externalId: 'sdrf_x', amount: 19700, customerId: 'cust_1', taxId: '123' } }))
      .toEqual({ providerEventId: 'e1', providerEventType: 'checkout.completed', kind: 'payment.confirmed', externalReference: 'sdrf_x', providerPaymentId: 'bill_1', providerSubscriptionId: null, providerCustomerId: 'cust_1', amountCents: 19700, currency: 'BRL', billingType: 'CARD', invoiceUrl: null });
    expect(normalizeAbacateEvent('e2', 'checkout.refunded', { billing: { id: 'bill_1' } }).kind).toBe('payment.refunded');
    expect(normalizeAbacateEvent('e3', 'checkout.lost', { billing: { id: 'bill_1' } }).kind).toBe('payment.chargeback');
    expect(normalizeAbacateEvent('e4', 'checkout.disputed', { billing: { id: 'bill_1' } }).kind).toBe('other');
    expect(normalizeAbacateEvent('e5', 'subscription.renewed', { subscription: { id: 'subs_1', amount: 19700 } })).toMatchObject({ kind: 'payment.confirmed', providerSubscriptionId: 'subs_1', providerPaymentId: 'e5:renewal', amountCents: 19700 });
    expect(normalizeAbacateEvent('e6', 'subscription.cancelled', { subscription: { id: 'subs_1' } })).toMatchObject({ kind: 'subscription.canceled', providerSubscriptionId: 'subs_1' });
    expect(normalizeAbacateEvent('e7', 'payout.completed', {}).kind).toBe('other');
  });

  it('never lets sandbox (devMode) events count in production', () => {
    const production = createAbacatePayGateway({ apiKey: 'abc_prod_key', webhookSecret: SECRET, devMode: false, fetch: server.fetch });
    const body = { id: 'log_9', event: 'checkout.completed', devMode: true, data: { billing: { id: 'bill_x', externalId: 'sdrf_x', amount: 1 } } };
    expect(production.parseWebhook({ headers: {}, rawBody: Buffer.alloc(0), body })[0]!.kind).toBe('other');
  });

  it('creates a subscription checkout for the catalog product and refuses a product priced differently', async () => {
    const created = await gateway.createCheckout({
      organizationId: randomUUID(), offer: offer('vendedor-mensal'), externalReference: 'sdrf_abc', customerEmail: 'dono@example.test',
      successUrl: 'https://app.example.test/billing/return?checkout=1', cancelUrl: 'https://app.example.test/billing', expiresAt: new Date().toISOString(),
    });
    expect(created.checkoutUrl).toMatch(/^https:\/\/app\.abacatepay\.com\/pay\//);
    const call = server.calls.find(item => item.path === '/checkouts/create')!;
    expect(call.auth).toBe('Bearer abc_dev_key');
    expect(call.body).toMatchObject({ items: [{ id: 'prod_vendedor-mensal', quantity: 1 }], frequency: 'SUBSCRIPTION', externalId: 'sdrf_abc', methods: ['PIX', 'CARD'], customerId: created.providerCustomerId });

    server.products.get('prod_vendedor-anual')!.price = 1;
    await expect(gateway.createCheckout({
      organizationId: randomUUID(), offer: offer('vendedor-anual'), externalReference: 'sdrf_def',
      successUrl: 'https://a.test/ok', cancelUrl: 'https://a.test/no', expiresAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'product_price_mismatch' });
    server.products.get('prod_vendedor-anual')!.price = offer('vendedor-anual').amountCents;
  });

  it('re-reads the checkout from the API before a payment counts', async () => {
    const pending = [...server.checkouts.values()][0];
    const event = normalizeAbacateEvent('e8', 'checkout.completed', { billing: { id: pending.id, externalId: pending.externalId, amount: 1 } });
    await expect(gateway.verifyEvent(event)).rejects.toMatchObject({ code: 'verification_status_mismatch' });
    server.pay(pending.id);
    expect(await gateway.verifyEvent(event)).toMatchObject({ amountCents: 19700, currency: 'BRL', externalReference: pending.externalId });
  });

  it('cancels immediately and reports that a cancellation cannot be reverted', async () => {
    const [subscription] = [...server.subscriptions.values()];
    await expect(gateway.setCancelAtPeriodEnd(subscription.id, false)).rejects.toMatchObject({ code: 'cancel_revert_unsupported' });
    await gateway.setCancelAtPeriodEnd(subscription.id, true);
    expect(subscription.status).toBe('CANCELLED');
  });
});

describe('AbacatePay end to end (API + Postgres)', () => {
  let db: PGlite;
  let org: string;
  const owner = randomUUID();
  const server = fakeAbacatePay();
  const gateway = createAbacatePayGateway({ apiKey: 'abc_dev_key', webhookSecret: SECRET, devMode: true, fetch: server.fetch });
  const config = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', serviceRoleKey: 'service', publicAppUrl: 'https://app.example.test', billingGateway: gateway, billingOffers: pricedOffers };
  const tier = async () => (await db.query<{ tier: string }>('select tier from public.organizations where id=$1', [org])).rows[0]!.tier;
  const sub = async () => (await db.query<any>('select * from public.organization_subscriptions where organization_id=$1', [org])).rows[0];
  const deliver = (body: object) => {
    const { raw, signature } = signed(body);
    return request(createApp(config)).post('/api/webhooks/billing/abacatepay').set('content-type', 'application/json').set('x-webhook-signature', signature).send(raw);
  };
  const buy = (offerCode: string, key: string) => request(createApp(config)).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' }).set('X-Organization-Id', org).send({ offerCode, idempotencyKey: key });

  beforeAll(async () => {
    db = await testDatabase();
    await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'dono@clinica.test']);
    org = (await db.query<{ default_organization_id: string }>('select default_organization_id from public.profiles where user_id=$1', [owner])).rows[0]!.default_organization_id;
    vi.spyOn(database, 'userDatabase').mockImplementation((_url, _key, token) => pgClient(db, token) as any);
    vi.spyOn(database, 'serviceDatabase').mockImplementation(() => pgClient(db, null) as any);
  });
  afterAll(async () => { vi.restoreAllMocks(); await db?.close(); });

  let firstSubscriptionId = '';

  it('checkout → payment webhook (any order with subscription.completed) → plan active and subscription linked', async () => {
    const checkout = await buy('vendedor-mensal', 'abacate-key-0001');
    expect(checkout.status).toBe(201);
    const billId = String(checkout.body.checkoutUrl).split('/').pop()!;
    const paid = server.pay(billId);
    firstSubscriptionId = paid.subscription.id;

    // subscription.completed antes do pagamento: o ID fica guardado no pedido.
    expect((await deliver(paid.subscriptionCompleted)).body.results[0].status).toBe('ignored');
    expect(await tier()).toBe('pre-venda');

    const unsigned = await request(createApp(config)).post('/api/webhooks/billing/abacatepay').send(paid.completed);
    expect(unsigned.status).toBe(401);

    const confirmed = await deliver(paid.completed);
    expect(confirmed.body.results[0].status).toBe('processed');
    expect(await tier()).toBe('vendedor');
    expect(await sub()).toMatchObject({ status: 'active', tier: 'vendedor', provider: 'abacatepay', provider_subscription_id: firstSubscriptionId });
    const customer = (await db.query<{ provider_customer_id: string }>('select provider_customer_id from private.billing_customers where organization_id=$1', [org])).rows[0];
    expect(customer?.provider_customer_id).toMatch(/^cust_/);
  });

  it('renewal extends the period; a replayed webhook is a duplicate', async () => {
    const before = (await sub()).current_period_end;
    const renewal = { id: 'log_renew_1', event: 'subscription.renewed', devMode: true, data: { subscription: { id: firstSubscriptionId, amount: 19700 } } };
    expect((await deliver(renewal)).body.results[0].status).toBe('processed');
    expect(new Date((await sub()).current_period_end).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect((await deliver(renewal)).body.results[0].status).toBe('duplicate');
  });

  it('upgrade: new subscription takes over, the old one is canceled at AbacatePay and its events are ignored', async () => {
    const checkout = await buy('vendedor-senior-mensal', 'abacate-key-0002');
    expect(checkout.status).toBe(201);
    const billId = String(checkout.body.checkoutUrl).split('/').pop()!;
    const paid = server.pay(billId);
    expect((await deliver(paid.completed)).body.results[0].status).toBe('processed');
    expect(await tier()).toBe('vendedor-senior');
    await deliver(paid.subscriptionCompleted);
    expect((await sub()).provider_subscription_id).toBe(paid.subscription.id);
    expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toHaveLength(1);

    const repo = new BillingRepository(pgClient(db, null) as any);
    expect(await cancelReplacedSubscriptions(repo, gateway)).toBe(1);
    expect(server.subscriptions.get(firstSubscriptionId).status).toBe('CANCELLED');
    expect(server.calls.filter(call => call.path === '/subscriptions/cancel').map(call => call.body.id)).toEqual([firstSubscriptionId]);

    // O cancelamento da assinatura antiga não pode derrubar o plano novo.
    const oldCanceled = { id: 'log_old_cancel', event: 'subscription.cancelled', devMode: true, data: { subscription: { id: firstSubscriptionId } } };
    expect((await deliver(oldCanceled)).body.results[0].status).toBe('ignored');
    expect(await tier()).toBe('vendedor-senior');
    expect((await sub()).status).toBe('active');
  });

  it('owner cancel: stops charges at AbacatePay now, keeps access until the paid period ends, cannot be reverted', async () => {
    const app = createApp(config);
    const summary = await request(app).get('/api/me/billing').auth(owner, { type: 'bearer' }).set('X-Organization-Id', org);
    expect(summary.body).toMatchObject({ provider: 'abacatepay', cancelRevertSupported: false });
    expect(summary.body.cancelNotice).toContain('não pode ser desfeito');

    const current = await sub();
    const cancel = await request(app).post('/api/me/billing/subscription/cancel').auth(owner, { type: 'bearer' }).set('X-Organization-Id', org).send({ cancel: true });
    expect(cancel.status).toBe(200);
    expect(server.subscriptions.get(current.provider_subscription_id).status).toBe('CANCELLED');
    await deliver({ id: 'log_new_cancel', event: 'subscription.cancelled', devMode: true, data: { subscription: { id: current.provider_subscription_id } } });
    expect((await sub()).status).toBe('canceled');
    expect(await tier()).toBe('vendedor-senior');

    const revert = await request(app).post('/api/me/billing/subscription/cancel').auth(owner, { type: 'bearer' }).set('X-Organization-Id', org).send({ cancel: false });
    expect(revert.status).toBe(404);
  });
});
