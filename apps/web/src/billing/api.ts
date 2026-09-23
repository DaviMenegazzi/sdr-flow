import { useMemo } from 'react';
import type { BillingSummary, OrgTier } from '@sdr/shared';
import { useSession } from '../session';

async function failure(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  const error = new Error(data.error || fallback) as Error & { code?: string; status?: number };
  error.code = data.code;
  error.status = res.status;
  throw error;
}

export interface CheckoutStatus {
  id: string;
  offerCode: string;
  tier: OrgTier;
  status: 'open' | 'paid' | 'expired' | 'canceled' | 'failed';
  expiresAt: string;
  paidAt: string | null;
  currentTier: OrgTier;
  activated: boolean;
}

function idempotencyKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Endpoints de Plano e cobrança com os cabeçalhos da sessão e da organização ativa. */
export function useBillingApi() {
  const { session, activeOrg } = useSession();
  const token = session?.access_token;

  return useMemo(() => {
    const headers: Record<string, string> | undefined = token
      ? { Authorization: `Bearer ${token}`, ...(activeOrg ? { 'X-Organization-Id': activeOrg } : {}) }
      : undefined;
    const json = headers ? { ...headers, 'Content-Type': 'application/json' } : undefined;
    return {
      ready: Boolean(headers),
      async summary(): Promise<BillingSummary> {
        const res = await fetch('/api/me/billing', { headers });
        if (!res.ok) await failure(res, 'Não foi possível carregar o plano.');
        return res.json();
      },
      /** A chave de idempotência é gerada uma vez por intenção de compra (reenvio seguro). */
      newIdempotencyKey: idempotencyKey,
      async startCheckout(offerCode: string, key: string): Promise<{ checkoutId: string; checkoutUrl: string }> {
        const res = await fetch('/api/me/billing/checkouts', { method: 'POST', headers: json, body: JSON.stringify({ offerCode, idempotencyKey: key }) });
        if (!res.ok) await failure(res, 'Não foi possível abrir o checkout.');
        return res.json();
      },
      async checkout(id: string): Promise<CheckoutStatus> {
        const res = await fetch(`/api/me/billing/checkouts/${encodeURIComponent(id)}`, { headers });
        if (!res.ok) await failure(res, 'Não foi possível consultar o pagamento.');
        return res.json();
      },
      async setCancel(cancel: boolean) {
        const res = await fetch('/api/me/billing/subscription/cancel', { method: 'POST', headers: json, body: JSON.stringify({ cancel }) });
        if (!res.ok) await failure(res, 'Não foi possível alterar o cancelamento.');
        return res.json();
      },
      async downgrade(offerCode: string) {
        const res = await fetch('/api/me/billing/subscription/downgrade', { method: 'POST', headers: json, body: JSON.stringify({ offerCode }) });
        if (!res.ok) await failure(res, 'Não foi possível agendar a mudança de plano.');
        return res.json();
      },
    };
  }, [token, activeOrg]);
}
