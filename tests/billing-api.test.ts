import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PGlite } from '@electric-sql/pglite';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { BILLING_OFFERS, type NormalizedBillingEvent } from '../packages/shared/src/index.js';
import { testDatabase } from './helpers/database.js';
import { pgClient } from './helpers/pg-supabase.js';

let db: PGlite;

const owner = randomUUID();
const agentUser = randomUUID();
let org: string;
const verified: string[] = [];
const fakeGateway: database.BillingGateway = {
  provider: 'fake',
  async createCheckout(input) {
    return { providerCheckoutId: `chk_${input.externalReference}`, checkoutUrl: `https://pay.example.test/${input.externalReference}`, providerCustomerId: 'cus_fake' };
  },
  authenticateWebhook: ({ headers }) => headers['x-fake-token'] === 'webhook-secret',
  parseWebhook: ({ body }) => (body as { events: NormalizedBillingEvent[] }).events,
  async verifyEvent(event) { verified.push(event.providerEventId); return event; },
  async setCancelAtPeriodEnd() {},
  async scheduleSubscriptionChange() {},
};
const pricedOffers = BILLING_OFFERS.map(offer => ({ ...offer, amountCents: offer.tier === 'vendedor' ? 19700 : 39700 }));
const baseConfig = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', serviceRoleKey: 'service', publicAppUrl: 'https://app.example.test' };

beforeAll(async () => {
  db = await testDatabase();
  await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'owner@example.test']);
  org = (await db.query<{ default_organization_id: string }>('select default_organization_id from public.profiles where user_id=$1', [owner])).rows[0]!.default_organization_id;
  await db.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)', [agentUser, 'agent@example.test', JSON.stringify({ sdr_target_organization_id: org, sdr_member_role: 'agent' })]);
  vi.spyOn(database, 'userDatabase').mockImplementation((_url, _key, token) => pgClient(db, token) as any);
  vi.spyOn(database, 'serviceDatabase').mockImplementation(() => pgClient(db, null) as any);
});
afterAll(async () => { vi.restoreAllMocks(); await db?.close(); });

const tier = async () => (await db.query<{ tier: string }>('select tier from public.organizations where id=$1', [org])).rows[0]!.tier;

describe('Billing API', () => {
  it('serves the public catalog without authentication', async () => {
    const response = await request(createApp(baseConfig)).get('/api/billing/catalog');
    expect(response.status).toBe(200);
    expect(response.body.plans.map((plan: any) => plan.tier)).toEqual(['pre-venda', 'vendedor', 'vendedor-senior']);
    expect(response.body.checkoutAvailable).toBe(false);
    expect(response.body.offers.every((offer: any) => offer.purchasable === false)).toBe(true);
  });

  it('refuses checkout for unpriced offers, without a gateway, and for non-owners — never pretending it worked', async () => {
    const withoutPrice = await request(createApp(baseConfig)).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'key-00000001' });
    expect(withoutPrice.status).toBe(409);
    expect(withoutPrice.body.code).toBe('offer_without_price');

    const withoutGateway = await request(createApp({ ...baseConfig, billingOffers: pricedOffers })).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'key-00000002' });
    expect(withoutGateway.status).toBe(503);
    expect(withoutGateway.body.code).toBe('gateway_not_configured');

    const notOwner = await request(createApp({ ...baseConfig, billingOffers: pricedOffers, billingGateway: fakeGateway })).post('/api/me/billing/checkouts').auth(agentUser, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'key-00000003' });
    expect(notOwner.status).toBe(403);

    const tampered = await request(createApp({ ...baseConfig, billingOffers: pricedOffers, billingGateway: fakeGateway })).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'key-00000004', amountCents: 1 });
    expect(tampered.status).toBe(400);
    expect(await tier()).toBe('pre-venda');
  });

  it('runs LP → checkout → webhook → plan active, with the return page never granting access', async () => {
    const app = createApp({ ...baseConfig, billingOffers: pricedOffers, billingGateway: fakeGateway });
    const checkout = await request(app).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'checkout-key-0001' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.checkoutUrl).toMatch(/^https:\/\/pay\.example\.test\/sdrf_/);

    const retry = await request(app).post('/api/me/billing/checkouts').auth(owner, { type: 'bearer' })
      .set('X-Organization-Id', org).send({ offerCode: 'vendedor-mensal', idempotencyKey: 'checkout-key-0001' });
    expect(retry.body.checkoutId).toBe(checkout.body.checkoutId);

    const pending = await request(app).get(`/api/me/billing/checkouts/${checkout.body.checkoutId}`).auth(owner, { type: 'bearer' }).set('X-Organization-Id', org);
    expect(pending.body).toMatchObject({ status: 'open', activated: false, currentTier: 'pre-venda' });

    const reference = String(checkout.body.checkoutUrl).split('/').pop();
    const events = [{ providerEventId: 'evt_api_1', providerEventType: 'PAYMENT_CONFIRMED', kind: 'payment.confirmed', externalReference: reference, providerPaymentId: 'pay_api_1', providerSubscriptionId: 'sub_api_1', amountCents: 19700, currency: 'BRL', invoiceUrl: 'https://pay.example.test/invoice/1' }];

    const forged = await request(app).post('/api/webhooks/billing/fake').set('x-fake-token', 'wrong').send({ events });
    expect(forged.status).toBe(401);
    expect(await tier()).toBe('pre-venda');

    const delivered = await request(app).post('/api/webhooks/billing/fake').set('x-fake-token', 'webhook-secret').send({ events });
    expect(delivered.status).toBe(200);
    expect(delivered.body.results[0].status).toBe('processed');
    expect(verified).toContain('evt_api_1');
    expect(await tier()).toBe('vendedor');

    const again = await request(app).post('/api/webhooks/billing/fake').set('x-fake-token', 'webhook-secret').send({ events });
    expect(again.body.results[0].status).toBe('duplicate');

    const done = await request(app).get(`/api/me/billing/checkouts/${checkout.body.checkoutId}`).auth(owner, { type: 'bearer' }).set('X-Organization-Id', org);
    expect(done.body).toMatchObject({ status: 'paid', activated: true, currentTier: 'vendedor' });

    const summary = await request(app).get('/api/me/billing').auth(owner, { type: 'bearer' }).set('X-Organization-Id', org);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ tier: 'vendedor', entitlementSource: 'subscription', canManage: true, gatewayConfigured: true });
    expect(summary.body.subscription).toMatchObject({ status: 'active', tier: 'vendedor', amountCents: 19700 });
    expect(summary.body.payments).toHaveLength(1);
    expect(summary.body.limits).toMatchObject({ maxAgents: 5, maxInstances: 3 });

    const agentView = await request(app).get('/api/me/billing').auth(agentUser, { type: 'bearer' }).set('X-Organization-Id', org);
    expect(agentView.body).toMatchObject({ tier: 'vendedor', canManage: false, canViewFinancials: false, subscription: null, payments: [] });
  });

  it('answers 503 on a webhook for a provider that is not configured', async () => {
    const response = await request(createApp(baseConfig)).post('/api/webhooks/billing/asaas').send({});
    expect(response.status).toBe(503);
  });

  it('lets only platform admins grant a plan, with a reason', async () => {
    const app = createApp(baseConfig);
    const denied = await request(app).post(`/api/admin/organizations/${org}/plan-grants`).auth(owner, { type: 'bearer' }).set('X-Organization-Id', org).send({ tier: 'vendedor-senior', reason: 'quero' });
    expect(denied.status).toBe(404);
    const admin = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [admin, 'root@example.test']);
    await db.query("update public.profiles set role='admin' where user_id=$1", [admin]);
    const missingReason = await request(app).post(`/api/admin/organizations/${org}/plan-grants`).auth(admin, { type: 'bearer' }).send({ tier: 'vendedor-senior' });
    expect(missingReason.status).toBe(400);
    const granted = await request(app).post(`/api/admin/organizations/${org}/plan-grants`).auth(admin, { type: 'bearer' }).send({ tier: 'vendedor-senior', reason: 'Contrato anual assinado fora do gateway' });
    expect(granted.status).toBe(201);
    expect(await tier()).toBe('vendedor-senior');
    const revoked = await request(app).post(`/api/admin/organizations/${org}/plan-grants/revoke`).auth(admin, { type: 'bearer' }).send({ reason: 'Contrato encerrado' });
    expect(revoked.body.tier).toBe('vendedor');
  });
});
