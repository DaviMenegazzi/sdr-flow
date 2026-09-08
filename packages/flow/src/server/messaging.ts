import { z } from 'zod';
import type { MessagingService } from '../services/types.js';

const evolution = z.object({ serverUrl: z.url(), apiKey: z.string().min(1), instanceName: z.string().min(1) });
const meta = z.object({ phoneNumberId: z.string().regex(/^\d+$/), accessToken: z.string().min(1) });
export interface MessagingConnection { provider: 'evolution' | 'meta'; status: string; credentials: unknown }
export interface WhatsAppConfig { enabled?: boolean; graphVersion?: string; timeoutMs?: number; fetch?: typeof fetch }
export type ResolveConnection = (connectionId: string) => Promise<MessagingConnection | null>;

/** Resolves credentials within the execution's organization; disabled unless explicitly enabled. */
export class WhatsAppMessagingService implements MessagingService {
  constructor(private readonly config: WhatsAppConfig, private readonly resolve: ResolveConnection) {}

  private async send(id: string, phone: string, kind: 'text' | 'media' | 'template', value: string, extra?: string, caption?: string, typing = false) {
    if (this.config.enabled !== true) throw new Error('Envio ao WhatsApp desativado (WHATSAPP_SEND_ENABLED=false).');
    const to = phone.replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(to)) throw new Error('Telefone inválido: informe DDI e número.');
    const connection = await this.resolve(id);
    if (!connection || connection.status !== 'connected') throw new Error('Conexão WhatsApp indisponível nesta organização.');
    let url: string;
    let headers: Record<string, string>;
    let body: Record<string, unknown>;
    if (kind === 'media') {
      if (!['image', 'video', 'document', 'audio'].includes(extra || '')) throw new Error('Tipo de mídia não suportado.');
      const parsed = z.url().safeParse(value);
      if (!parsed.success || !/^https?:\/\//.test(value)) throw new Error('Mídia deve ter uma URL HTTP(S) acessível ao provedor.');
    }
    if (connection.provider === 'evolution') {
      const parsed = evolution.safeParse(connection.credentials);
      if (!parsed.success) throw new Error('Credenciais da Evolution incompletas.');
      const creds = parsed.data;
      const base = new URL(creds.serverUrl);
      if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('URL da Evolution inválida.');
      if (kind === 'template') throw new Error('Templates oficiais requerem uma conexão WhatsApp Cloud API (Meta).');
      const endpoint = kind === 'text' ? 'sendText' : extra === 'audio' ? 'sendWhatsAppAudio' : 'sendMedia';
      url = `${creds.serverUrl.replace(/\/+$/, '')}/message/${endpoint}/${encodeURIComponent(creds.instanceName)}`;
      headers = { apikey: creds.apiKey, 'Content-Type': 'application/json' };
      body = kind === 'text' ? { number: to, text: value, delay: typing ? 1200 : 0, linkPreview: false }
        : extra === 'audio' ? { number: to, audio: value }
        : { number: to, mediatype: extra, media: value, caption: caption ?? '', fileName: new URL(value).pathname.split('/').pop() || 'media' };
    } else {
      const parsed = meta.safeParse(connection.credentials);
      if (!parsed.success) throw new Error('Credenciais da Meta incompletas.');
      const version = this.config.graphVersion || 'v21.0';
      if (!/^v\d+\.\d+$/.test(version)) throw new Error('META_GRAPH_VERSION inválida.');
      url = `https://graph.facebook.com/${version}/${parsed.data.phoneNumberId}/messages`;
      headers = { Authorization: `Bearer ${parsed.data.accessToken}`, 'Content-Type': 'application/json' };
      body = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
      if (kind === 'text') Object.assign(body, { type: 'text', text: { body: value } });
      else if (kind === 'template') Object.assign(body, { type: 'template', template: { name: value, language: { code: extra } } });
      else Object.assign(body, { type: extra, [extra!]: { link: value, ...(caption && extra !== 'audio' ? { caption } : {}) } });
    }
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(url, { method: 'POST', headers, body: JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000) });
    } catch { throw new Error('WhatsApp: falha de rede ou timeout; confirme a entrega antes de reenviar.'); }
    if (!response.ok) throw new Error(`WhatsApp ${connection.provider}: HTTP ${response.status}.`);
    let data: any;
    try { data = await response.json(); } catch { throw new Error('WhatsApp retornou uma resposta inválida.'); }
    const messageId = connection.provider === 'evolution' ? data.key?.id : data.messages?.[0]?.id;
    if (typeof messageId !== 'string' || !messageId) throw new Error('WhatsApp não confirmou o ID da mensagem.');
    return { messageId };
  }
  sendText(id: string, phone: string, text: string, options?: { typing?: boolean }) { return this.send(id, phone, 'text', text, undefined, undefined, options?.typing); }
  sendMedia(id: string, phone: string, url: string, type: string, caption?: string) { return this.send(id, phone, 'media', url, type, caption); }
  sendTemplate(id: string, phone: string, name: string, language: string) { return this.send(id, phone, 'template', name, language); }
}
