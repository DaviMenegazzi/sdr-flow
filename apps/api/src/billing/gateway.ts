import type { BillingGateway } from '@sdr/db';
import { logger } from '../telemetry/logger.js';

/**
 * Seleciona o adapter do gateway da assinatura a partir de BILLING_PROVIDER.
 *
 * Nenhum adapter está implementado nesta versão (ver docs/BILLING.md, "O que falta").
 * Configurar um provedor sem adapter não liga um modo simulado: a cobrança continua
 * indisponível e a API responde 503 nas ações de checkout, cancelamento e webhook.
 */
export function resolveBillingGateway(env: NodeJS.ProcessEnv): BillingGateway | null {
  const provider = (env.BILLING_PROVIDER || '').trim().toLowerCase();
  if (!provider || provider === 'none') return null;
  logger.error({ provider }, 'BILLING_PROVIDER configurado, mas o adapter deste gateway ainda não foi implementado; cobrança desativada.');
  return null;
}
