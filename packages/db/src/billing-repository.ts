import type {
  BillingInterval,
  BillingOffer,
  NormalizedBillingEvent,
  OrgTier,
} from '@sdr/shared';
import { normalizedBillingEventSchema } from '@sdr/shared';
import type { AnyDbClient } from './execution-repository.js';

/**
 * Contrato que cada provedor de cobrança da ASSINATURA do SDR Flow implementa
 * (Asaas, Mercado Pago, Stripe…). Nenhum adapter está implementado ainda: sem
 * gateway configurado a API responde 503 em vez de simular sucesso.
 */
export interface CreateCheckoutInput {
  organizationId: string;
  offer: BillingOffer & { amountCents: number };
  externalReference: string;
  customerEmail?: string;
  providerCustomerId?: string | null;
  /** Assinatura atual no gateway quando o checkout é upgrade. */
  providerSubscriptionId?: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: string;
}

export interface CreateCheckoutResult {
  providerCheckoutId: string;
  checkoutUrl: string;
  providerCustomerId?: string | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: unknown;
}

export interface BillingGateway {
  readonly provider: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /** Autentica a entrega (token/assinatura) em tempo constante. */
  authenticateWebhook(request: WebhookRequest): boolean;
  /** Converte o corpo do provedor em eventos normalizados (sem dados sensíveis). */
  parseWebhook(request: WebhookRequest): NormalizedBillingEvent[];
  /**
   * Revalida no gateway eventos críticos (pagamento confirmado, estorno) antes de
   * aplicar: status, valor, moeda e identificadores vêm da API autenticada.
   */
  verifyEvent(event: NormalizedBillingEvent): Promise<NormalizedBillingEvent>;
  setCancelAtPeriodEnd(providerSubscriptionId: string, cancel: boolean): Promise<void>;
  scheduleSubscriptionChange(providerSubscriptionId: string, offer: BillingOffer & { amountCents: number }): Promise<void>;
}

export class BillingGatewayError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const CRITICAL_KINDS = new Set(['payment.confirmed', 'payment.received', 'payment.refunded', 'payment.chargeback']);

export interface CheckoutIntentRow {
  id: string;
  organization_id: string;
  kind: 'new' | 'upgrade';
  subscription_id: string | null;
  offer_code: string;
  offer_version: number;
  tier: OrgTier;
  billing_interval: BillingInterval;
  amount_cents: number;
  currency: string;
  provider: string;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  external_reference: string;
  status: 'open' | 'paid' | 'expired' | 'canceled' | 'failed';
  expires_at: string;
  paid_at: string | null;
  created_at: string;
}

export class BillingRepository {
  constructor(private readonly db: AnyDbClient) {}

  async openCheckout(input: {
    organizationId: string;
    userId: string;
    offer: BillingOffer & { amountCents: number };
    provider: string;
    idempotencyKey: string;
    expiresAt: string;
  }): Promise<CheckoutIntentRow> {
    const { data, error } = await (this.db as any).rpc('billing_open_checkout', {
      p_org: input.organizationId,
      p_user: input.userId,
      p_offer_code: input.offer.code,
      p_offer_version: input.offer.version,
      p_tier: input.offer.tier,
      p_interval: input.offer.interval,
      p_amount_cents: input.offer.amountCents,
      p_currency: input.offer.currency,
      p_provider: input.provider,
      p_idempotency_key: input.idempotencyKey,
      p_expires_at: input.expiresAt,
    });
    if (error) throw error;
    return data as CheckoutIntentRow;
  }

  async attachCheckout(intentId: string, providerCheckoutId: string, checkoutUrl: string): Promise<CheckoutIntentRow> {
    const { data, error } = await (this.db as any).rpc('billing_attach_checkout', {
      p_intent: intentId,
      p_provider_checkout_id: providerCheckoutId,
      p_checkout_url: checkoutUrl,
    });
    if (error) throw error;
    return data as CheckoutIntentRow;
  }

  async failCheckout(intentId: string, code: string): Promise<void> {
    const { error } = await (this.db as any).rpc('billing_fail_checkout', { p_intent: intentId, p_failure_code: code });
    if (error) throw error;
  }

  async customerFor(organizationId: string, provider: string): Promise<string | null> {
    const { data, error } = await (this.db as any).rpc('billing_customer_for', { p_org: organizationId, p_provider: provider });
    if (error) throw error;
    return (data as string | null) ?? null;
  }

  async saveCustomer(organizationId: string, provider: string, providerCustomerId: string): Promise<void> {
    const { error } = await (this.db as any).rpc('billing_save_customer', {
      p_org: organizationId,
      p_provider: provider,
      p_provider_customer_id: providerCustomerId,
    });
    if (error) throw error;
  }

  async recordEvent(provider: string, event: NormalizedBillingEvent): Promise<{ eventId: string; isNew: boolean; status: string }> {
    const parsed = normalizedBillingEventSchema.parse(event);
    const { data, error } = await (this.db as any).rpc('billing_record_event', {
      p_provider: provider,
      p_provider_event_id: parsed.providerEventId,
      p_event_type: parsed.providerEventType,
      p_payload: parsed,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { event_id: string; is_new: boolean; processing_status: string };
    return { eventId: row.event_id, isNew: row.is_new, status: row.processing_status };
  }

  async processEvent(eventId: string): Promise<string> {
    const { data, error } = await (this.db as any).rpc('billing_process_event', { p_event: eventId });
    if (error) throw error;
    return data as string;
  }

  async markEventFailed(eventId: string, code: string): Promise<void> {
    const { error } = await (this.db as any).rpc('billing_mark_event_failed', { p_event: eventId, p_error_code: code });
    if (error) throw error;
  }

  async claimEvents(limit = 20): Promise<Array<{ event_id: string; provider: string; event_type: string }>> {
    const { data, error } = await (this.db as any).rpc('billing_claim_events', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as Array<{ event_id: string; provider: string; event_type: string }>;
  }

  async runMaintenance(): Promise<number> {
    const { data, error } = await (this.db as any).rpc('billing_run_maintenance', {});
    if (error) throw error;
    return Number(data ?? 0);
  }

  async reconciliationReport(): Promise<Array<{ kind: string; organization_id: string | null; reference: string }>> {
    const { data, error } = await (this.db as any).rpc('billing_reconciliation_report', {});
    if (error) throw error;
    return (data ?? []) as Array<{ kind: string; organization_id: string | null; reference: string }>;
  }

  async setCancelAtPeriodEnd(organizationId: string, userId: string, cancel: boolean) {
    const { data, error } = await (this.db as any).rpc('billing_set_cancel_at_period_end', {
      p_org: organizationId,
      p_user: userId,
      p_cancel: cancel,
    });
    if (error) throw error;
    return data;
  }

  async scheduleDowngrade(organizationId: string, userId: string, offer: BillingOffer & { amountCents: number }) {
    const { data, error } = await (this.db as any).rpc('billing_schedule_downgrade', {
      p_org: organizationId,
      p_user: userId,
      p_offer_code: offer.code,
      p_offer_version: offer.version,
      p_tier: offer.tier,
      p_amount_cents: offer.amountCents,
    });
    if (error) throw error;
    return data;
  }
}

/**
 * Grava e processa eventos normalizados. Eventos críticos são revalidados no gateway
 * antes de alterar direito de acesso; a revalidação substitui o conteúdo do webhook.
 */
export async function ingestBillingEvents(
  repo: BillingRepository,
  gateway: BillingGateway,
  events: NormalizedBillingEvent[],
): Promise<Array<{ eventId: string; status: string }>> {
  const results: Array<{ eventId: string; status: string }> = [];
  for (const raw of events) {
    const event = CRITICAL_KINDS.has(raw.kind) ? await gateway.verifyEvent(raw) : raw;
    const recorded = await repo.recordEvent(gateway.provider, event);
    if (!recorded.isNew && recorded.status !== 'pending' && recorded.status !== 'failed') {
      results.push({ eventId: recorded.eventId, status: 'duplicate' });
      continue;
    }
    try {
      results.push({ eventId: recorded.eventId, status: await repo.processEvent(recorded.eventId) });
    } catch (error) {
      await repo.markEventFailed(recorded.eventId, errorCode(error));
      results.push({ eventId: recorded.eventId, status: 'failed' });
    }
  }
  return results;
}

/** Reprocessa eventos pendentes/falhos com backoff (chamado pelo worker). */
export async function drainBillingEvents(repo: BillingRepository, limit = 20): Promise<number> {
  const claimed = await repo.claimEvents(limit);
  for (const item of claimed) {
    try {
      await repo.processEvent(item.event_id);
    } catch (error) {
      await repo.markEventFailed(item.event_id, errorCode(error));
    }
  }
  return claimed.length;
}

function errorCode(error: unknown): string {
  const candidate = error as { code?: string; message?: string };
  return String(candidate?.code || candidate?.message || 'processing_error').slice(0, 80);
}
