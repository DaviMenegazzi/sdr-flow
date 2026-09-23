import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, testDatabase } from './helpers/database.js';
import {
  BILLING_GRACE_DAYS,
  PLAN_LIMITS,
  normalizedBillingEventSchema,
  orgTiers,
} from '../packages/shared/src/index.js';

let db: PGlite;
const owner = randomUUID();
const member = randomUUID();
const stranger = randomUUID();
const platformAdmin = randomUUID();
let org: string;
let otherOrg: string;

async function asService<T>(action: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role');
  try { return await action(); } finally { await db.exec('reset role'); }
}

async function tierOf(id: string) {
  return (await db.query<{ tier: string }>('select tier from public.organizations where id=$1', [id])).rows[0]!.tier;
}

async function openCheckout(orgId: string, user: string, offerCode: string, tier: string, amount: number, key = randomUUID()) {
  return asService(async () => (await db.query<{ id: string; external_reference: string; kind: string; status: string; subscription_id: string | null }>(
    "select * from public.billing_open_checkout($1,$2,$3,1,$4::public.org_tier,'monthly',$5,'BRL','fake',$6,now() + interval '1 day')",
    [orgId, user, offerCode, tier, amount, key],
  )).rows[0]!);
}

let eventSeq = 0;
async function deliver(payload: Record<string, unknown>, eventId = `evt_${++eventSeq}`) {
  return asService(async () => {
    const recorded = (await db.query<{ event_id: string; is_new: boolean }>(
      "select * from public.billing_record_event('fake',$1,$2,$3)",
      [eventId, String(payload.kind), JSON.stringify({ providerEventId: eventId, providerEventType: String(payload.kind), ...payload })],
    )).rows[0]!;
    const status = (await db.query<{ billing_process_event: string }>('select public.billing_process_event($1)', [recorded.event_id])).rows[0]!.billing_process_event;
    return { ...recorded, status };
  });
}

async function subscriptionOf(orgId: string) {
  return (await db.query<any>('select * from public.organization_subscriptions where organization_id=$1 order by created_at desc limit 1', [orgId])).rows[0];
}

beforeAll(async () => {
  db = await testDatabase();
  for (const [id, email, name] of [[owner, 'owner@example.test', 'Empresa Cobrança'], [stranger, 'other@example.test', 'Outra Empresa'], [platformAdmin, 'admin@example.test', 'Admin']] as const) {
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, email, JSON.stringify({ display_name: name })]);
  }
  await db.query("update public.profiles set role='admin' where user_id=$1", [platformAdmin]);
  org = (await db.query<{ default_organization_id: string }>('select default_organization_id from public.profiles where user_id=$1', [owner])).rows[0]!.default_organization_id;
  otherOrg = (await db.query<{ default_organization_id: string }>('select default_organization_id from public.profiles where user_id=$1', [stranger])).rows[0]!.default_organization_id;
  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)',
    [member, 'member@example.test', JSON.stringify({ display_name: 'Membro' }), JSON.stringify({ sdr_target_organization_id: org, sdr_member_role: 'agent', sdr_app_role: 'client', sdr_org_tier: 'vendedor-senior' })],
  );
});
afterAll(async () => db?.close());

describe('Billing catalog mirrors the database', () => {
  it('keeps PLAN_LIMITS and the grace period identical to the SQL definitions', async () => {
    for (const tier of orgTiers) {
      const row = (await db.query<{ max_agents: number | null; max_instances: number | null }>('select * from private.plan_limits($1)', [tier])).rows[0]!;
      expect({ maxAgents: row.max_agents, maxInstances: row.max_instances }).toEqual(PLAN_LIMITS[tier]);
    }
    expect((await db.query<{ billing_grace_days: number }>('select private.billing_grace_days()')).rows[0]!.billing_grace_days).toBe(BILLING_GRACE_DAYS);
  });

  it('never accepts an organization id from a gateway payload', () => {
    const parsed = normalizedBillingEventSchema.safeParse({ providerEventId: 'e', providerEventType: 'x', kind: 'payment.confirmed', organizationId: randomUUID() });
    expect(parsed.success).toBe(false);
  });
});

describe('Entitlement safety', () => {
  it('adding a login with sdr_org_tier metadata does not upgrade (or downgrade) the organization', async () => {
    expect(await tierOf(org)).toBe('pre-venda');
    expect((await db.query("select 1 from public.organization_members where organization_id=$1 and user_id=$2 and role='agent'", [org, member])).rows).toHaveLength(1);
  });

  it('refuses direct tier writes, even from the service role', async () => {
    await expect(asService(() => db.query("update public.organizations set tier='vendedor' where id=$1", [org]))).rejects.toThrow('managed by billing entitlements');
  });

  it('only the owner can open a checkout, and the same idempotency key returns the same intent', async () => {
    await expect(openCheckout(org, member, 'vendedor-mensal', 'vendedor', 19700)).rejects.toThrow('Only the organization owner');
    const key = randomUUID();
    const first = await openCheckout(org, owner, 'vendedor-mensal', 'vendedor', 19700, key);
    const again = await openCheckout(org, owner, 'vendedor-mensal', 'vendedor', 19700, key);
    expect(again.id).toBe(first.id);
    expect(first.kind).toBe('new');
    // Abandoning the checkout never changes the plan.
    expect(await tierOf(org)).toBe('pre-venda');
  });
});

describe('Payment lifecycle', () => {
  let intent: { id: string; external_reference: string };

  it('ignores events it cannot correlate and never guesses the organization', async () => {
    const result = await deliver({ kind: 'payment.confirmed', externalReference: 'sdrf_unknown', providerPaymentId: 'pay_x', amountCents: 19700, currency: 'BRL' });
    expect(result.status).toBe('unmatched');
    expect(await tierOf(org)).toBe('pre-venda');
  });

  it('holds the plan when the paid amount differs from the checkout', async () => {
    const wrong = await openCheckout(org, owner, 'vendedor-mensal', 'vendedor', 19700);
    const result = await deliver({ kind: 'payment.confirmed', externalReference: wrong.external_reference, providerPaymentId: 'pay_wrong', amountCents: 100, currency: 'BRL' });
    expect(result.status).toBe('needs_review');
    expect(await tierOf(org)).toBe('pre-venda');
  });

  it('a pending payment does not grant the plan; the confirmed initial payment does', async () => {
    intent = await openCheckout(org, owner, 'vendedor-mensal', 'vendedor', 19700);
    await deliver({ kind: 'payment.created', externalReference: intent.external_reference, providerPaymentId: 'pay_1', amountCents: 19700, currency: 'BRL', billingType: 'PIX' });
    expect(await tierOf(org)).toBe('pre-venda');

    const confirmed = await deliver({
      kind: 'payment.confirmed', externalReference: intent.external_reference, providerPaymentId: 'pay_1',
      providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1', amountCents: 19700, currency: 'BRL',
      periodStart: '2026-09-01T00:00:00Z', periodEnd: '2099-10-01T00:00:00Z',
    }, 'evt_confirm_1');
    expect(confirmed.status).toBe('processed');
    expect(await tierOf(org)).toBe('vendedor');
    const sub = await subscriptionOf(org);
    expect(sub).toMatchObject({ status: 'active', tier: 'vendedor', provider_subscription_id: 'sub_1' });
    expect((await db.query<{ status: string }>('select status from public.checkout_intents where id=$1', [intent.id])).rows[0]!.status).toBe('paid');
    expect((await db.query("select 1 from public.billing_entitlement_changes where organization_id=$1 and new_tier='vendedor' and reason='payment'", [org])).rows).toHaveLength(1);
  });

  it('duplicate and late events neither create a second subscription nor regress the payment', async () => {
    const replay = await deliver({ kind: 'payment.confirmed', externalReference: intent.external_reference, providerPaymentId: 'pay_1', amountCents: 19700, currency: 'BRL' }, 'evt_confirm_1');
    expect(replay.is_new).toBe(false);
    const periodBefore = (await subscriptionOf(org)).current_period_end;
    await deliver({ kind: 'payment.received', externalReference: intent.external_reference, providerPaymentId: 'pay_1', amountCents: 19700, currency: 'BRL' });
    await deliver({ kind: 'payment.overdue', externalReference: intent.external_reference, providerPaymentId: 'pay_1', amountCents: 19700, currency: 'BRL' });
    const sub = await subscriptionOf(org);
    expect(sub.status).toBe('active');
    expect(sub.current_period_end).toEqual(periodBefore);
    expect((await db.query<{ status: string }>("select status from public.billing_payments where provider_payment_id='pay_1'")).rows[0]!.status).toBe('received');
    expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toHaveLength(1);
  });

  it('a second paid "new" checkout for the same organization goes to review instead of creating another subscription', async () => {
    const parallel = await asService(async () => (await db.query<{ id: string; external_reference: string }>(
      "insert into public.checkout_intents(organization_id,requested_by_user_id,kind,offer_code,offer_version,tier,billing_interval,amount_cents,provider,external_reference,idempotency_key,expires_at) values($1,$2,'new','vendedor-mensal',1,'vendedor','monthly',19700,'fake','sdrf_parallel','parallel-key-1',now()+interval '1 day') returning id,external_reference",
      [org, owner],
    )).rows[0]!);
    const result = await deliver({ kind: 'payment.confirmed', externalReference: parallel.external_reference, providerPaymentId: 'pay_parallel', providerSubscriptionId: 'sub_parallel', amountCents: 19700, currency: 'BRL' });
    expect(result.status).toBe('needs_review');
    expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toHaveLength(1);
  });

  it('upgrades the same subscription only after the upgrade payment is confirmed', async () => {
    await expect(openCheckout(org, owner, 'pre-venda-mensal', 'pre-venda', 9700)).rejects.toThrow('Not an upgrade');
    const upgrade = await openCheckout(org, owner, 'vendedor-senior-mensal', 'vendedor-senior', 39700);
    expect(upgrade.kind).toBe('upgrade');
    expect(await tierOf(org)).toBe('vendedor');
    await deliver({ kind: 'payment.confirmed', externalReference: upgrade.external_reference, providerPaymentId: 'pay_up', providerSubscriptionId: 'sub_1', amountCents: 39700, currency: 'BRL' });
    expect(await tierOf(org)).toBe('vendedor-senior');
    const sub = await subscriptionOf(org);
    expect(sub).toMatchObject({ tier: 'vendedor-senior', amount_cents: 39700, status: 'active' });
    expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toHaveLength(1);
  });

  it('renewal failure keeps access during the grace period and suspends it afterwards', async () => {
    await asService(() => db.query("update public.organization_subscriptions set current_period_end=now() - interval '1 hour' where organization_id=$1", [org]));
    await deliver({ kind: 'payment.created', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_renew', amountCents: 39700, currency: 'BRL' });
    await deliver({ kind: 'payment.overdue', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_renew', amountCents: 39700, currency: 'BRL' });
    let sub = await subscriptionOf(org);
    expect(sub.status).toBe('past_due');
    expect(await tierOf(org)).toBe('vendedor-senior');

    await asService(() => db.query("select public.billing_run_maintenance(now() + interval '4 days')"));
    sub = await subscriptionOf(org);
    expect(sub.status).toBe('suspended');
    expect(await tierOf(org)).toBe('pre-venda');
    expect((await db.query("select 1 from public.billing_entitlement_changes where organization_id=$1 and new_tier='pre-venda' and reason='grace_expired'", [org])).rows).toHaveLength(1);
  });

  it('a late renewal payment on a suspended subscription restores access', async () => {
    await deliver({ kind: 'payment.confirmed', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_renew', amountCents: 39700, currency: 'BRL', periodEnd: '2099-12-01T00:00:00Z' });
    expect((await subscriptionOf(org)).status).toBe('active');
    expect(await tierOf(org)).toBe('vendedor-senior');
  });

  it('refund or chargeback of the current payment revokes the plan', async () => {
    await deliver({ kind: 'payment.chargeback', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_renew', amountCents: 39700, currency: 'BRL' });
    expect((await subscriptionOf(org)).status).toBe('suspended');
    expect(await tierOf(org)).toBe('pre-venda');
    // A chargeback is final: a late confirmation event for the same payment cannot undo it.
    await deliver({ kind: 'payment.confirmed', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_renew', amountCents: 39700, currency: 'BRL' });
    expect(await tierOf(org)).toBe('pre-venda');
  });
});

describe('Cancellation', () => {
  it('keeps access until the end of the paid period, then expires', async () => {
    const intent = await openCheckout(otherOrg, stranger, 'vendedor-mensal', 'vendedor', 19700);
    await deliver({ kind: 'payment.confirmed', externalReference: intent.external_reference, providerPaymentId: 'pay_other', providerSubscriptionId: 'sub_other', amountCents: 19700, currency: 'BRL', periodEnd: '2099-01-01T00:00:00Z' });
    expect(await tierOf(otherOrg)).toBe('vendedor');
    await deliver({ kind: 'subscription.canceled', providerSubscriptionId: 'sub_other' });
    expect((await subscriptionOf(otherOrg)).status).toBe('canceled');
    expect(await tierOf(otherOrg)).toBe('vendedor');
    await asService(() => db.query("select public.billing_run_maintenance('2099-01-02T00:00:00Z')"));
    expect((await subscriptionOf(otherOrg)).status).toBe('expired');
    expect(await tierOf(otherOrg)).toBe('pre-venda');
  });
});

describe('Manual grants', () => {
  it('only platform admins grant plans; grants are audited and can expire', async () => {
    await expect(asUser(db, owner, () => db.query("select public.admin_grant_org_plan($1,'vendedor-senior','auto-promoção')", [org]))).rejects.toThrow();
    await asUser(db, platformAdmin, () => db.query("select public.admin_grant_org_plan($1,'vendedor','Cortesia de piloto', now() + interval '10 days')", [org]));
    expect(await tierOf(org)).toBe('vendedor');
    expect((await db.query("select 1 from public.audit_events where organization_id=$1 and action='billing.plan_granted'", [org])).rows).toHaveLength(1);
    await asService(() => db.query("select public.billing_run_maintenance(now() + interval '11 days')"));
    expect(await tierOf(org)).toBe('pre-venda');
    expect((await db.query("select 1 from public.billing_entitlement_changes where organization_id=$1 and reason='grant_expired'", [org])).rows).toHaveLength(1);
  });
});

describe('Row level security', () => {
  it('members of another organization see nothing; agents do not see financial data; nobody writes from the browser', async () => {
    await asUser(db, stranger, async () => {
      expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toEqual([]);
      expect((await db.query('select id from public.billing_payments where organization_id=$1', [org])).rows).toEqual([]);
    });
    await asUser(db, member, async () => {
      expect((await db.query('select id from public.billing_payments where organization_id=$1', [org])).rows).toEqual([]);
      expect((await db.query('select id from public.organization_subscriptions where organization_id=$1', [org])).rows).toEqual([]);
    });
    await asUser(db, owner, async () => {
      expect((await db.query('select id from public.billing_payments where organization_id=$1', [org])).rows.length).toBeGreaterThan(0);
      await expect(db.query("insert into public.organization_plan_grants(organization_id,tier,reason) values($1,'vendedor-senior','hack')", [org])).rejects.toThrow();
      await expect(db.query("update public.organization_subscriptions set status='active' where organization_id=$1", [org])).rejects.toThrow();
      await expect(db.query("select public.billing_process_event($1)", [randomUUID()])).rejects.toThrow();
      await expect(db.query('select * from private.billing_webhook_events')).rejects.toThrow();
    });
  });
});

describe('Organization limits', () => {
  it('derive from the tier, are enforced per organization and never block login provisioning', async () => {
    const fresh = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [fresh, 'fresh@example.test']);
    const freshOrg = (await db.query<{ default_organization_id: string }>('select default_organization_id from public.profiles where user_id=$1', [fresh])).rows[0]!.default_organization_id;
    await asService(async () => {
      await db.query("insert into public.connections(organization_id,owner_user_id,name,provider) values($1,$2,'Primeira','evolution')", [freshOrg, fresh]);
      await expect(db.query("insert into public.connections(organization_id,owner_user_id,name,provider) values($1,$2,'Segunda','evolution')", [freshOrg, fresh])).rejects.toThrow('Instance limit reached');
    });
    await asUser(db, platformAdmin, () => db.query("select public.admin_grant_org_plan($1,'vendedor','Plano de teste')", [freshOrg]));
    await asService(() => db.query("insert into public.connections(organization_id,owner_user_id,name,provider) values($1,$2,'Segunda','evolution')", [freshOrg, fresh]));
    const limits = await asUser(db, fresh, async () => (await db.query<any>('select * from public.get_organization_limits($1)', [freshOrg])).rows[0]);
    expect(limits).toMatchObject({ max_agents: 5, max_instances: 3, instances: 2 });
    await expect(asUser(db, stranger, () => db.query('select * from public.get_organization_limits($1)', [freshOrg]))).rejects.toThrow();
  });
});
