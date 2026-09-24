import { offerCodeSchema } from '@sdr/shared';
import { createAbacatePayGateway } from './abacatepay-gateway.js';
import type { BillingGateway } from './billing-repository.js';

export class BillingConfigError extends Error {}

/**
 * Seleciona o gateway da assinatura a partir do ambiente (API e worker usam o mesmo).
 *
 * BILLING_PROVIDER vazio/none → null (checkout indisponível, 503). Provedor desconhecido
 * ou configuração incompleta → erro na inicialização: nunca um modo simulado.
 */
export function resolveBillingGateway(env: NodeJS.ProcessEnv): BillingGateway | null {
  const provider = (env.BILLING_PROVIDER || '').trim().toLowerCase();
  if (!provider || provider === 'none') return null;
  if (provider !== 'abacatepay') {
    throw new BillingConfigError(`BILLING_PROVIDER "${provider}" não tem adapter implementado. Use "abacatepay" ou deixe vazio.`);
  }
  const apiKey = env.BILLING_API_KEY?.trim() ?? '';
  const webhookSecret = env.BILLING_WEBHOOK_TOKEN?.trim() ?? '';
  if (!apiKey || webhookSecret.length < 16) {
    throw new BillingConfigError('AbacatePay exige BILLING_API_KEY e BILLING_WEBHOOK_TOKEN (mínimo 16 caracteres).');
  }
  const devModeFlag = (env.ABACATEPAY_DEV_MODE || '').trim().toLowerCase();
  const devMode = devModeFlag ? devModeFlag === 'true' : env.NODE_ENV !== 'production';
  return createAbacatePayGateway({
    apiKey,
    webhookSecret,
    devMode,
    productIds: parseProductIds(env.ABACATEPAY_PRODUCT_IDS),
    methods: parseMethods(env.ABACATEPAY_METHODS),
  });
}

function parseProductIds(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BillingConfigError('ABACATEPAY_PRODUCT_IDS deve ser um JSON {"<código da oferta>": "<id do produto>"}.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BillingConfigError('ABACATEPAY_PRODUCT_IDS deve ser um objeto JSON.');
  }
  const result: Record<string, string> = {};
  for (const [code, id] of Object.entries(parsed)) {
    if (!offerCodeSchema.safeParse(code).success) throw new BillingConfigError(`ABACATEPAY_PRODUCT_IDS: oferta desconhecida "${code}".`);
    if (typeof id !== 'string' || !id.trim()) throw new BillingConfigError(`ABACATEPAY_PRODUCT_IDS: produto vazio para "${code}".`);
    result[code] = id.trim();
  }
  return result;
}

function parseMethods(raw: string | undefined): Array<'PIX' | 'CARD' | 'BOLETO'> | undefined {
  if (!raw?.trim()) return undefined;
  const methods = raw.split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
  for (const method of methods) {
    if (!['PIX', 'CARD', 'BOLETO'].includes(method)) throw new BillingConfigError(`ABACATEPAY_METHODS: meio desconhecido "${method}".`);
  }
  return methods as Array<'PIX' | 'CARD' | 'BOLETO'>;
}
