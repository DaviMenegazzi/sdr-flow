import { normalizePhoneDigits } from '@sdr/shared';
import type { MessagingService } from './types.js';

/** Exact international number comparison: never match suffixes or omit a DDD. */
export function matchesTestPhone(incoming: string | undefined, allowed: string): boolean {
  if (!incoming || (incoming.includes('@') && !/@s\.whatsapp\.net$/.test(incoming))) return false;
  const a = normalizePhoneDigits(incoming), b = normalizePhoneDigits(allowed);
  return /^[1-9]\d{7,14}$/.test(a) && a === b;
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
