import type { MessagingService } from './types.js';

/**
 * Test mode deliberately uses one normalized, exact number. A formatted
 * version of the same configured number is accepted, but nearby numbers or
 * Brazilian 8/9-digit variations are not authorized by accident.
 */
export function matchesTestPhone(incoming: string | undefined, allowed: string): boolean {
  if (!incoming || (incoming.includes('@') && !/@s\.whatsapp\.net$/.test(incoming))) return false;
  const normalize=(value:string)=>value.replace(/@s\.whatsapp\.net$/,'').replace(/\D/g,'');
  return normalize(incoming) === normalize(allowed);
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
