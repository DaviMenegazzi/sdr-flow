import { z } from 'zod';
import { orgTiers, orgTierSchema, type OrgTier } from './capabilities.js';

/**
 * Catálogo da assinatura do SDR Flow (cobrança da ORGANIZAÇÃO pela plataforma).
 *
 * Não confundir com `payment_gates:manage`, que é a integração do cliente com os
 * pagamentos dos próprios leads. Este catálogo alimenta a LP, a página de preços,
 * o formulário de checkout e a validação da API — o preço nunca vem do navegador.
 *
 * Preços: `amountCents: null` significa "ainda não definido pelo negócio". A API
 * recusa checkout de ofertas sem preço e a LP mostra "Preço em definição". Para
 * lançar, preencha os valores e incremente `CATALOG_VERSION` (ofertas publicadas
 * são versionadas; um checkout guarda a versão que o comprador viu).
 */
export const CATALOG_VERSION = 1;

export const billingIntervals = ['monthly', 'yearly'] as const;
export const billingIntervalSchema = z.enum(billingIntervals);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const subscriptionStatuses = ['pending_payment', 'active', 'past_due', 'suspended', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const checkoutIntentStatuses = ['open', 'paid', 'expired', 'canceled', 'failed'] as const;
export type CheckoutIntentStatus = (typeof checkoutIntentStatuses)[number];

export const billingPaymentStatuses = ['pending', 'confirmed', 'received', 'overdue', 'refunded', 'chargeback', 'canceled'] as const;
export type BillingPaymentStatus = (typeof billingPaymentStatuses)[number];

/** Dias de carência após falha de renovação. Espelha private.billing_grace_days(). */
export const BILLING_GRACE_DAYS = 3;

/** Limites padrão por tier. null = ilimitado. Espelha private.plan_limits() (tests/billing.test.ts). */
export const PLAN_LIMITS: Record<OrgTier, { maxAgents: number | null; maxInstances: number | null }> = {
  'pre-venda': { maxAgents: 2, maxInstances: 1 },
  vendedor: { maxAgents: 5, maxInstances: 3 },
  'vendedor-senior': { maxAgents: null, maxInstances: null },
};

export interface PlanDefinition {
  tier: OrgTier;
  name: string;
  tagline: string;
  highlight?: boolean;
  features: string[];
}

export const PLANS: Record<OrgTier, PlanDefinition> = {
  'pre-venda': {
    tier: 'pre-venda',
    name: 'Pré-Venda',
    tagline: 'Para começar a responder leads no WhatsApp com IA.',
    features: [
      'Atendimento (Inbox) com assunção humana',
      'Indicadores do funil',
      'Agentes de IA nas instâncias configuradas',
    ],
  },
  vendedor: {
    tier: 'vendedor',
    name: 'Vendedor',
    tagline: 'Para quem precisa agendar e integrar a operação comercial.',
    highlight: true,
    features: [
      'Tudo do Pré-Venda',
      'Integrações externas (Google Agenda)',
      'Agendamento, remarcação e cancelamento pelo agente',
    ],
  },
  'vendedor-senior': {
    tier: 'vendedor-senior',
    name: 'Vendedor Sênior',
    tagline: 'Operação completa, do primeiro contato à cobrança.',
    features: [
      'Tudo do Vendedor',
      'Gates de pagamento para seus leads (Asaas, Mercado Pago, Stripe)',
    ],
  },
};

export interface BillingOffer {
  code: string;
  version: number;
  tier: OrgTier;
  interval: BillingInterval;
  currency: 'BRL';
  /** Centavos. null = preço ainda não definido; checkout bloqueado. */
  amountCents: number | null;
  active: boolean;
}

const offer = (tier: OrgTier, interval: BillingInterval, amountCents: number | null): BillingOffer => ({
  code: `${tier}-${interval === 'monthly' ? 'mensal' : 'anual'}`,
  version: CATALOG_VERSION,
  tier,
  interval,
  currency: 'BRL',
  amountCents,
  active: true,
});

// DECISÃO DE NEGÓCIO PENDENTE: valores mensais/anuais e se o Pré-Venda é gratuito.
export const BILLING_OFFERS: readonly BillingOffer[] = [
  offer('pre-venda', 'monthly', null),
  offer('pre-venda', 'yearly', null),
  offer('vendedor', 'monthly', null),
  offer('vendedor', 'yearly', null),
  offer('vendedor-senior', 'monthly', null),
  offer('vendedor-senior', 'yearly', null),
];

export const offerCodes = BILLING_OFFERS.map(item => item.code) as [string, ...string[]];
export const offerCodeSchema = z.enum(offerCodes);

export function findOffer(code: string, offers: readonly BillingOffer[] = BILLING_OFFERS): BillingOffer | undefined {
  return offers.find(item => item.code === code && item.active);
}

export function tierRank(tier: OrgTier): number {
  return orgTiers.indexOf(tier);
}

export function isPurchasable(item: BillingOffer): item is BillingOffer & { amountCents: number } {
  return item.active && typeof item.amountCents === 'number' && item.amountCents > 0;
}

export function formatPrice(amountCents: number | null, currency = 'BRL'): string {
  if (amountCents === null) return 'Preço em definição';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amountCents / 100);
}

/** Formulário de checkout e corpo de POST /api/me/billing/checkouts (mesmo schema). */
export const checkoutRequestSchema = z
  .object({
    offerCode: offerCodeSchema,
    idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const downgradeRequestSchema = z.object({ offerCode: offerCodeSchema }).strict();
export const cancelRequestSchema = z.object({ cancel: z.boolean() }).strict();

export const planGrantRequestSchema = z
  .object({
    tier: orgTierSchema,
    reason: z.string().trim().min(3).max(500),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export const planRevokeRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

/** Evento de cobrança normalizado pelo adapter do gateway (o único formato gravado na inbox). */
export const normalizedBillingEventKinds = [
  'payment.created',
  'payment.confirmed',
  'payment.received',
  'payment.overdue',
  'payment.refunded',
  'payment.chargeback',
  'payment.canceled',
  'subscription.canceled',
  'checkout.expired',
  'checkout.canceled',
  'other',
] as const;

export const normalizedBillingEventSchema = z
  .object({
    providerEventId: z.string().min(1).max(200),
    providerEventType: z.string().min(1).max(120),
    kind: z.enum(normalizedBillingEventKinds),
    externalReference: z.string().max(200).nullable().optional(),
    providerSubscriptionId: z.string().max(200).nullable().optional(),
    providerPaymentId: z.string().max(200).nullable().optional(),
    providerCustomerId: z.string().max(200).nullable().optional(),
    amountCents: z.number().int().nonnegative().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    billingType: z.string().max(40).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    paidAt: z.string().datetime({ offset: true }).nullable().optional(),
    periodStart: z.string().datetime({ offset: true }).nullable().optional(),
    periodEnd: z.string().datetime({ offset: true }).nullable().optional(),
    invoiceUrl: z.string().url().startsWith('https://').nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type NormalizedBillingEvent = z.infer<typeof normalizedBillingEventSchema>;

/** Resumo exibido na página Plano e cobrança (GET /api/me/billing). */
export interface BillingSummary {
  organizationId: string;
  tier: OrgTier;
  entitlementSource: 'subscription' | 'grant' | 'default';
  canManage: boolean;
  canViewFinancials: boolean;
  gatewayConfigured: boolean;
  provider: string | null;
  subscription: null | {
    id: string;
    status: SubscriptionStatus;
    tier: OrgTier;
    offerCode: string;
    interval: BillingInterval;
    amountCents: number;
    currency: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    graceUntil: string | null;
    scheduledTier: OrgTier | null;
  };
  grant: null | { tier: OrgTier; reason: string; expiresAt: string | null };
  limits: {
    maxAgents: number | null;
    maxInstances: number | null;
    activeAgents: number;
    instances: number;
  };
  payments: Array<{
    id: string;
    status: BillingPaymentStatus;
    amountCents: number;
    currency: string;
    dueDate: string | null;
    paidAt: string | null;
    invoiceUrl: string | null;
    createdAt: string;
  }>;
  openCheckout: null | { id: string; offerCode: string; status: CheckoutIntentStatus; checkoutUrl: string | null; expiresAt: string };
}
