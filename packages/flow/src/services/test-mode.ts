import { isPhoneNumberMatch } from '@sdr/shared';
import type { MessagingService } from './types.js';

/**
 * Delegates to the same lenient matcher used by the app.ts pre-check
 * (handles the Brazilian 8-vs-9-digit mobile variation, DDI/DDD suffixes,
 * and comma/semicolon-separated multiple numbers). Previously this used a
 * strict exact-match comparison, which caused messages that passed the
 * app.ts gate to be silently blocked again here whenever the sender's
 * number and the configured test phone differed only by the extra "9".
 */
export function matchesTestPhone(incoming: string | undefined, allowed: string): boolean {
  if (!incoming || (incoming.includes('@') && !/@s\.whatsapp\.net$/.test(incoming))) return false;
  return isPhoneNumberMatch(incoming, allowed);
}

export function restrictTestMessaging(messaging: MessagingService, phone: string, connectionId: string): MessagingService {
  const assertAllowed = (id: string, to: string) => {
    if (id !== connectionId || !matchesTestPhone(to, phone)) throw new Error('Modo Teste: envio bloqueado para destinatário ou conexão não autorizados.');
  };
  return {
    sendText(id, to, text, options) { assertAllowed(id, to); return messaging.sendText(id, to, text, options); },
    sendMedia(id, to, url, type, caption) { assertAllowed(id, to); return messaging.sendMedia(id, to, url, type, caption); },
    sendTemplate(id, to, name, language) { assertAllowed(id, to); return messaging.sendTemplate(id, to, name, language); },
  };
}
