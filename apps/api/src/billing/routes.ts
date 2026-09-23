import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import {
  BillingRepository,
  BillingGatewayError,
  ingestBillingEvents,
  serviceDatabase,
  type BillingGateway,
} from '@sdr/db';
import {
  BILLING_OFFERS,
  PLANS,
  PLAN_LIMITS,
  CATALOG_VERSION,
  BILLING_GRACE_DAYS,
  checkoutRequestSchema,
  downgradeRequestSchema,
  cancelRequestSchema,
  planGrantRequestSchema,
  planRevokeRequestSchema,
  findOffer,
  isPurchasable,
  tierRank,
  type BillingOffer,
  type BillingSummary,
  type OrgTier,
} from '@sdr/shared';
import { requireRole, uuidParam } from '../auth.js';
import { logger } from '../telemetry/logger.js';

export interface BillingRoutesConfig {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  publicAppUrl?: string;
  gateway?: BillingGateway | null;
  /** Catálogo em vigor; padrão BILLING_OFFERS (packages/shared/src/billing.ts). */
  offers?: readonly BillingOffer[];
}

const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cobrança da assinatura do SDR Flow por organização (docs/BILLING.md).
 *
 * - O navegador escolhe apenas o código da oferta; preço, tier e versão vêm do catálogo.
 * - A página de retorno do checkout nunca libera o plano: só o webhook verificado,
 *   processado em transação por billing_process_event, altera organizations.tier.
 * - Sem gateway configurado, as ações de cobrança respondem 503 (nada é simulado).
 */
export function registerBillingRoutes(app: Express, config: BillingRoutesConfig) {
  const gateway = config.gateway ?? null;
  const offers = config.offers ?? BILLING_OFFERS;
  const serviceRepo = () =>
    config.supabaseUrl && config.serviceRoleKey
      ? new BillingRepository(serviceDatabase(config.supabaseUrl, config.serviceRoleKey))
      : null;

  // Catálogo público (LP e página de preços).
  app.get('/api/billing/catalog', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      version: CATALOG_VERSION,
      graceDays: BILLING_GRACE_DAYS,
      checkoutAvailable: Boolean(gateway),
      plans: Object.values(PLANS).map(plan => ({ ...plan, limits: PLAN_LIMITS[plan.tier] })),
      offers: offers.filter(offer => offer.active).map(offer => ({ ...offer, purchasable: isPurchasable(offer) })),
    });
  });

  // Webhook do gateway: público, autenticado pelo segredo do provedor, fora do
  // middleware de usuário e do rate limit por organização.
  app.post('/api/webhooks/billing/:provider', async (req, res) => {
    const provider = z.string().regex(/^[a-z_]{2,32}$/).safeParse(req.params.provider);
    if (!provider.success) { res.sendStatus(404); return; }
    if (!gateway || gateway.provider !== provider.data) { res.status(503).json({ error: 'Gateway de cobrança não configurado.' }); return; }
    const repo = serviceRepo();
    if (!repo) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    const request = {
      headers: req.headers,
      rawBody: (req as typeof req & { rawBody?: Buffer }).rawBody || Buffer.alloc(0),
      body: req.body,
    };
    if (!gateway.authenticateWebhook(request)) { res.sendStatus(401); return; }
    let events;
    try {
      events = gateway.parseWebhook(request);
    } catch (error) {
      logger.warn({ err: error, provider: provider.data }, 'Webhook de cobrança com payload inválido');
      res.status(400).json({ error: 'Payload inválido.' });
      return;
    }
    try {
      const results = await ingestBillingEvents(repo, gateway, events);
      res.status(200).json({ ok: true, results });
    } catch (error) {
      // Evento não persistido: o gateway deve reenviar.
      logger.error({ err: error, provider: provider.data }, 'Falha ao registrar webhook de cobrança');
      res.status(503).json({ error: 'Evento não persistido; tente novamente.' });
    }
  });

  // --- Área autenticada: /api/me/billing (organização ativa via X-Organization-Id) ---
  // /api/me e /api/admin já passam por authMiddleware em app.ts.
  app.get('/api/me/billing', async (_req, res) => {
    const auth = res.locals.auth!;
    const isOwner = auth.memberRole === 'owner';
    const canViewFinancials = auth.memberRole === 'owner' || auth.memberRole === 'admin';
    const db = auth.db as any;

    const limitsQuery = db.rpc('get_organization_limits', { p_org: auth.organizationId });
    const [limitsResult, subscriptionResult, grantResult, paymentsResult, checkoutResult] = await Promise.all([
      limitsQuery,
      canViewFinancials
        ? db.from('organization_subscriptions').select('*').eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canViewFinancials
        ? db.from('organization_plan_grants').select('tier,reason,expires_at').eq('organization_id', auth.organizationId).is('revoked_at', null).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canViewFinancials
        ? db.from('billing_payments').select('id,status,amount_cents,currency,due_date,paid_at,invoice_url,created_at').eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(24)
        : Promise.resolve({ data: [], error: null }),
      isOwner
        ? db.from('checkout_intents').select('id,offer_code,status,checkout_url,expires_at').eq('organization_id', auth.organizationId).eq('requested_by_user_id', auth.userId).eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const result of [limitsResult, subscriptionResult, grantResult, paymentsResult, checkoutResult]) {
      if (result.error) throw result.error;
    }
    const limits = (Array.isArray(limitsResult.data) ? limitsResult.data[0] : limitsResult.data) ?? {};
    const sub = subscriptionResult.data;
    const grant = grantResult.data;
    const grantActive = grant && (!grant.expires_at || new Date(grant.expires_at) > new Date());
    const entitlementSource: BillingSummary['entitlementSource'] =
      grantActive && grant.tier === auth.orgTier ? 'grant' : sub && sub.tier === auth.orgTier && auth.orgTier !== 'pre-venda' ? 'subscription' : 'default';

    const summary: BillingSummary = {
      organizationId: auth.organizationId,
      tier: auth.orgTier,
      entitlementSource,
      canManage: isOwner,
      canViewFinancials,
      gatewayConfigured: Boolean(gateway),
      provider: gateway?.provider ?? null,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            tier: sub.tier,
            offerCode: sub.offer_code,
            interval: sub.billing_interval,
            amountCents: sub.amount_cents,
            currency: sub.currency,
            currentPeriodStart: sub.current_period_start,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            graceUntil: sub.grace_until,
            scheduledTier: sub.scheduled_tier,
          }
        : null,
      grant: grantActive ? { tier: grant.tier, reason: grant.reason, expiresAt: grant.expires_at } : null,
      limits: {
        maxAgents: limits.max_agents ?? null,
        maxInstances: limits.max_instances ?? null,
        activeAgents: limits.active_agents ?? 0,
        instances: limits.instances ?? 0,
      },
      payments: (paymentsResult.data ?? []).map((payment: any) => ({
        id: payment.id,
        status: payment.status,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        dueDate: payment.due_date,
        paidAt: payment.paid_at,
        invoiceUrl: payment.invoice_url,
        createdAt: payment.created_at,
      })),
      openCheckout: checkoutResult.data
        ? {
            id: checkoutResult.data.id,
            offerCode: checkoutResult.data.offer_code,
            status: checkoutResult.data.status,
            checkoutUrl: checkoutResult.data.checkout_url,
            expiresAt: checkoutResult.data.expires_at,
          }
        : null,
    };
    res.json(summary);
  });

  const requireOwner: RequestHandler = (_req, res, next) => {
    if (res.locals.auth?.memberRole !== 'owner') {
      res.status(403).json({ error: 'Somente o proprietário da organização gerencia o plano.' });
      return;
    }
    next();
  };

  app.post('/api/me/billing/checkouts', requireOwner, async (req, res) => {
    const auth = res.locals.auth!;
    const body = checkoutRequestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Oferta inválida.' }); return; }
    const offer = findOffer(body.data.offerCode, offers);
    if (!offer) { res.status(404).json({ error: 'Oferta não encontrada.' }); return; }
    if (!isPurchasable(offer)) { res.status(409).json({ error: 'Esta oferta ainda não tem preço definido.', code: 'offer_without_price' }); return; }
    if (tierRank(offer.tier) <= tierRank(auth.orgTier)) {
      res.status(409).json({ error: 'Sua organização já tem este plano ou um superior. Para reduzir, agende um downgrade.', code: 'not_an_upgrade' });
      return;
    }
    if (!gateway) { res.status(503).json({ error: 'Checkout indisponível: gateway de cobrança não configurado.', code: 'gateway_not_configured' }); return; }
    const repo = serviceRepo();
    if (!repo) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }

    let intent;
    try {
      intent = await repo.openCheckout({
        organizationId: auth.organizationId,
        userId: auth.userId,
        offer,
        provider: gateway.provider,
        idempotencyKey: body.data.idempotencyKey,
        expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
      });
    } catch (error: any) {
      if (error?.code === '42501') { res.status(403).json({ error: 'Somente o proprietário da organização gerencia o plano.' }); return; }
      if (error?.code === 'P0001') { res.status(409).json({ error: 'Sua organização já tem este plano ou um superior.', code: error.hint || 'not_an_upgrade' }); return; }
      if (error?.code === '22023') { res.status(409).json({ error: 'Chave de idempotência já usada para outra oferta.' }); return; }
      throw error;
    }
    if (intent.checkout_url) { res.status(200).json({ checkoutId: intent.id, checkoutUrl: intent.checkout_url, status: intent.status }); return; }
    if (intent.status !== 'open') { res.status(409).json({ error: 'Este checkout não está mais aberto.', status: intent.status }); return; }

    const appUrl = (config.publicAppUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    let subscriptionRef: string | null = null;
    if (intent.subscription_id) {
      const { data } = await (auth.db as any).from('organization_subscriptions').select('provider_subscription_id').eq('id', intent.subscription_id).maybeSingle();
      subscriptionRef = data?.provider_subscription_id ?? null;
    }
    try {
      const created = await gateway.createCheckout({
        organizationId: auth.organizationId,
        offer,
        externalReference: intent.external_reference,
        customerEmail: auth.email,
        providerCustomerId: await repo.customerFor(auth.organizationId, gateway.provider),
        providerSubscriptionId: subscriptionRef,
        successUrl: `${appUrl}/billing/return?checkout=${intent.id}`,
        cancelUrl: `${appUrl}/billing?checkout=${intent.id}&canceled=1`,
        expiresAt: intent.expires_at,
      });
      if (created.providerCustomerId) await repo.saveCustomer(auth.organizationId, gateway.provider, created.providerCustomerId);
      const attached = await repo.attachCheckout(intent.id, created.providerCheckoutId, created.checkoutUrl);
      res.status(201).json({ checkoutId: attached.id, checkoutUrl: attached.checkout_url, status: attached.status });
    } catch (error) {
      await repo.failCheckout(intent.id, error instanceof BillingGatewayError ? error.code : 'gateway_error').catch(() => undefined);
      logger.error({ err: error, organizationId: auth.organizationId }, 'Falha ao criar checkout no gateway');
      res.status(502).json({ error: 'O gateway de pagamento não respondeu. Tente novamente em instantes.' });
    }
  });

  // Consulta do retorno do checkout (a página faz polling com backoff).
  app.get('/api/me/billing/checkouts/:checkoutId', requireOwner, async (req, res) => {
    const auth = res.locals.auth!;
    const checkoutId = uuidParam.safeParse(req.params.checkoutId);
    if (!checkoutId.success) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    const { data, error } = await (auth.db as any)
      .from('checkout_intents')
      .select('id,offer_code,tier,status,expires_at,paid_at')
      .eq('organization_id', auth.organizationId)
      .eq('id', checkoutId.data)
      .maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Checkout não encontrado.' }); return; }
    res.json({
      id: data.id,
      offerCode: data.offer_code,
      tier: data.tier,
      status: data.status,
      expiresAt: data.expires_at,
      paidAt: data.paid_at,
      // Tier efetivo agora — só muda depois do webhook confirmado.
      currentTier: auth.orgTier,
      activated: data.status === 'paid' && tierRank(auth.orgTier) >= tierRank(data.tier as OrgTier),
    });
  });

  app.post('/api/me/billing/subscription/cancel', requireOwner, async (req, res) => {
    const auth = res.locals.auth!;
    const body = cancelRequestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Dados inválidos.' }); return; }
    const subscription = await currentSubscription(auth.db, auth.organizationId);
    if (!subscription) { res.status(404).json({ error: 'Nenhuma assinatura ativa.' }); return; }
    if (!gateway || gateway.provider !== subscription.provider || !subscription.provider_subscription_id) {
      res.status(503).json({ error: 'Gateway de cobrança não configurado.', code: 'gateway_not_configured' });
      return;
    }
    const repo = serviceRepo();
    if (!repo) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    await gateway.setCancelAtPeriodEnd(subscription.provider_subscription_id, body.data.cancel);
    res.json(await repo.setCancelAtPeriodEnd(auth.organizationId, auth.userId, body.data.cancel));
  });

  app.post('/api/me/billing/subscription/downgrade', requireOwner, async (req, res) => {
    const auth = res.locals.auth!;
    const body = downgradeRequestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Oferta inválida.' }); return; }
    const offer = findOffer(body.data.offerCode, offers);
    if (!offer || !isPurchasable(offer)) { res.status(409).json({ error: 'Esta oferta ainda não tem preço definido.', code: 'offer_without_price' }); return; }
    const subscription = await currentSubscription(auth.db, auth.organizationId);
    if (!subscription) { res.status(404).json({ error: 'Nenhuma assinatura ativa.' }); return; }
    if (tierRank(offer.tier) >= tierRank(subscription.tier)) { res.status(409).json({ error: 'Escolha um plano inferior ao atual.', code: 'not_a_downgrade' }); return; }
    if (!gateway || gateway.provider !== subscription.provider || !subscription.provider_subscription_id) {
      res.status(503).json({ error: 'Gateway de cobrança não configurado.', code: 'gateway_not_configured' });
      return;
    }
    const repo = serviceRepo();
    if (!repo) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    await gateway.scheduleSubscriptionChange(subscription.provider_subscription_id, offer);
    res.json(await repo.scheduleDowngrade(auth.organizationId, auth.userId, offer));
  });

  // --- Administração da plataforma: concessão manual auditada ---
  app.get('/api/admin/organizations/:organizationId/billing', requireRole('admin'), async (req, res) => {
    const organizationId = uuidParam.safeParse(req.params.organizationId);
    if (!organizationId.success) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey) as any;
    const [org, grants, subscriptions, changes] = await Promise.all([
      db.from('organizations').select('id,name,tier').eq('id', organizationId.data).maybeSingle(),
      db.from('organization_plan_grants').select('*').eq('organization_id', organizationId.data).order('created_at', { ascending: false }).limit(20),
      db.from('organization_subscriptions').select('*').eq('organization_id', organizationId.data).order('created_at', { ascending: false }).limit(20),
      db.from('billing_entitlement_changes').select('*').eq('organization_id', organizationId.data).order('created_at', { ascending: false }).limit(50),
    ]);
    if (!org.data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json({ organization: org.data, grants: grants.data ?? [], subscriptions: subscriptions.data ?? [], changes: changes.data ?? [] });
  });

  app.post('/api/admin/organizations/:organizationId/plan-grants', requireRole('admin'), async (req, res) => {
    const auth = res.locals.auth!;
    const organizationId = uuidParam.safeParse(req.params.organizationId);
    const body = planGrantRequestSchema.safeParse(req.body);
    if (!organizationId.success || !body.success) { res.status(400).json({ error: 'Dados da concessão inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('admin_grant_org_plan', {
      p_org: organizationId.data,
      p_tier: body.data.tier,
      p_reason: body.data.reason,
      p_expires_at: body.data.expiresAt ?? null,
    });
    if (error) {
      res.status(error.code === '22023' ? 400 : 404).json({ error: error.code === '22023' ? 'Motivo ou expiração inválidos.' : 'Recurso não encontrado.' });
      return;
    }
    res.status(201).json(data);
  });

  app.post('/api/admin/organizations/:organizationId/plan-grants/revoke', requireRole('admin'), async (req, res) => {
    const auth = res.locals.auth!;
    const organizationId = uuidParam.safeParse(req.params.organizationId);
    const body = planRevokeRequestSchema.safeParse(req.body);
    if (!organizationId.success || !body.success) { res.status(400).json({ error: 'Informe o motivo da revogação.' }); return; }
    const { data, error } = await (auth.db as any).rpc('admin_revoke_org_plan', { p_org: organizationId.data, p_reason: body.data.reason });
    if (error) { res.status(404).json({ error: 'Nenhuma concessão ativa para esta organização.' }); return; }
    res.json({ tier: data });
  });

  app.get('/api/admin/billing/reconciliation', requireRole('admin'), async (_req, res) => {
    const repo = serviceRepo();
    if (!repo) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    res.json({ items: await repo.reconciliationReport() });
  });
}

async function currentSubscription(db: unknown, organizationId: string) {
  const { data, error } = await (db as any)
    .from('organization_subscriptions')
    .select('id,tier,provider,provider_subscription_id,status')
    .eq('organization_id', organizationId)
    .in('status', ['active', 'past_due'])
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; tier: OrgTier; provider: string; provider_subscription_id: string | null; status: string } | null;
}
