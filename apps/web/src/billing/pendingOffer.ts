/**
 * Plano escolhido na LP antes do login. É só uma INTENÇÃO de compra: fica no navegador
 * até a pessoa autenticar e escolher a organização; o servidor valida o código e o
 * preço vem do catálogo. Nunca autoriza nada.
 *
 * Este módulo entra no bundle inicial (telas de login), então não importa @sdr/shared/zod;
 * o formato abaixo acompanha os códigos gerados em packages/shared/src/billing.ts.
 */
const KEY = 'sdr-flow:pending-offer';
const OFFER_CODE = /^(pre-venda|vendedor|vendedor-senior)-(mensal|anual)$/;

const TIER_NAMES: Record<string, string> = { 'pre-venda': 'Pré-Venda', vendedor: 'Vendedor', 'vendedor-senior': 'Vendedor Sênior' };

export function rememberOffer(code: string | null | undefined) {
  if (!code || !OFFER_CODE.test(code)) return;
  try { sessionStorage.setItem(KEY, code); } catch {}
}

export function peekPendingOffer(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && OFFER_CODE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingOffer() {
  try { sessionStorage.removeItem(KEY); } catch {}
}

/** Nome legível ("Vendedor (mensal)") sem carregar o catálogo completo. */
export function describeOffer(code: string): { plan: string; interval: string } | null {
  const match = OFFER_CODE.exec(code);
  if (!match) return null;
  return { plan: TIER_NAMES[match[1]!] ?? match[1]!, interval: match[2]! };
}

/** Destino pós-login: a página de cobrança com a oferta pré-selecionada, se houver. */
export function postLoginDestination(fallback = '/dashboard'): string {
  const offer = peekPendingOffer();
  return offer ? `/billing?offer=${encodeURIComponent(offer)}` : fallback;
}
