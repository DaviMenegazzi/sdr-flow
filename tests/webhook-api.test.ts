import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import * as database from '../packages/db/src/index.js';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { parseEvolutionWebhook, processInboundWebhook } from '../apps/api/src/webhook.js';

describe('API Webhook & Inbound Gateway', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps group identity separate from the participant who sent the message', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: {
          id: 'group-message-1',
          remoteJid: '120363000000000000@g.us',
          participant: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        // Evolution's pushName belongs to the participant, never the group itself.
        pushName: 'Mariana Souza',
        chat: { subject: 'Clientes Vida Card' },
        message: { conversation: 'Bom dia, pessoal!' },
      },
    });

    expect(event).toMatchObject({
      phone: '120363000000000000',
      isGroup: true,
      groupName: 'Clientes Vida Card',
      senderName: 'Mariana Souza',
      senderJid: '5511999999999@s.whatsapp.net',
    });
  });
  it('falls back to key.participantAlt for the sending participant when others are absent', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: { id: 'group-lid-1', remoteJid: '120363000000000001@g.us', participantAlt: '5511988887777@s.whatsapp.net', fromMe: false },
        pushName: 'Fulano',
        chat: { subject: 'Grupo X' },
        message: { conversation: 'oi' },
      },
    });
    expect(event).toMatchObject({ senderJid: '5511988887777@s.whatsapp.net' });
  });
  it('normalizes a sticker message', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: { id: 'sticker-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        pushName: 'Ana',
        message: { stickerMessage: { url: 'https://example.com/sticker.webp', mimetype: 'image/webp' } },
      },
    });
    expect(event).toMatchObject({ messageType: 'sticker', textContent: '' });
  });
  it('normalizes a contact and a location message', () => {
    const contact = parseEvolutionWebhook({
      data: {
        key: { id: 'contact-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        message: { contactMessage: { displayName: 'Fulano', vcard: 'BEGIN:VCARD\nEND:VCARD' } },
      },
    });
    expect(contact).toMatchObject({ messageType: 'contact' });

    const location = parseEvolutionWebhook({
      data: {
        key: { id: 'location-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        message: { locationMessage: { degreesLatitude: -29.7, degreesLongitude: -53.7 } },
      },
    });
    expect(location).toMatchObject({ messageType: 'location' });
  });
  it('unwraps a view-once (V2) media message to detect its real type and caption', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: { id: 'vo-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        message: { viewOnceMessageV2: { message: { imageMessage: { url: 'https://example.com/a.jpg', caption: 'Olha só' } } } },
      },
    });
    expect(event).toMatchObject({ messageType: 'image', textContent: 'Olha só' });
  });
  it('unwraps an ephemeral (disappearing) message to detect its real type', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: { id: 'eph-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        message: { ephemeralMessage: { message: { audioMessage: { url: 'https://example.com/a.ogg' } } } },
      },
    });
    expect(event).toMatchObject({ messageType: 'audio' });
  });
  it('falls back to unknown for an unrecognized non-text payload instead of a silently empty text bubble', () => {
    const event = parseEvolutionWebhook({
      data: {
        key: { id: 'reaction-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        message: { reactionMessage: { text: '👍', key: { id: 'other-msg' } } },
      },
    });
    expect(event).toMatchObject({ messageType: 'unknown', textContent: '' });
  });
  it('still treats a genuinely empty message payload as text (no regression for protocol-only deliveries)', () => {
    const event = parseEvolutionWebhook({
      data: { key: { id: 'empty-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false }, message: {} },
    });
    expect(event).toMatchObject({ messageType: 'text', textContent: '' });
  });
  it('never names the lead after the connected number (instance owner) pushName on a fromMe message', async () => {
    const organizationId = '00000000-0000-4000-8000-00000000000a';
    const empty: any = { select: () => empty, eq: () => empty, order: () => empty, limit: async () => ({ data: [], error: null }) };
    vi.spyOn(database, 'serviceDatabase').mockReturnValue({
      from: () => empty,
      rpc: async (name: string) => name === 'accept_inbound_event'
        ? { data: [{ event_id: 'evt-1', organization_id: organizationId, is_new: true, status: 'received' }], error: null }
        : { data: null, error: null },
    } as any);
    const findOrCreateLead = vi.spyOn(database.ConversationRepository.prototype, 'findOrCreateLead').mockResolvedValue({ id: 'lead-1' } as any);
    vi.spyOn(database.ConversationRepository.prototype, 'findOrCreateConversation').mockResolvedValue({ id: 'conv-1' } as any);

    // Sent from the connected phone itself: Evolution sets pushName to the owner's profile name.
    const event = parseEvolutionWebhook({
      data: { key: { id: 'from-me-1', remoteJid: '5555999940634@s.whatsapp.net', fromMe: true }, pushName: 'Danieli', message: { conversation: 'deu certo' } },
    })!;
    await processInboundWebhook('00000000-0000-4000-8000-000000000001', event, { supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test' }, {
      provider: 'evolution', inlineFallback: false, eventPublisher: {} as any, debugRegistry: {} as any,
    });

    expect(findOrCreateLead).toHaveBeenCalledWith(organizationId, '00000000-0000-4000-8000-000000000001', '5555999940634', null);
  });
  it('authenticates Meta challenge and signed status events before processing', async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'connection' } }) };
    vi.spyOn(database, 'serviceDatabase').mockReturnValue({ from: () => query } as any);
    vi.spyOn(database.ConnectionRepository.prototype, 'getConnectionCredentials').mockResolvedValue({ phoneNumberId: '123', wabaId: '456', accessToken: 'test', appSecret: 'test-secret', verifyToken: 'verify-test' });
    const app = createApp({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test' });
    const path = '/api/webhooks/meta/00000000-0000-4000-8000-000000000002';
    expect((await request(app).get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' })).status).toBe(403);
    const challenge = await request(app).get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-test', 'hub.challenge': '12345' });
    expect(challenge.status).toBe(200); expect(challenge.text).toBe('12345');
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    expect((await request(app).post(path).type('json').send(body)).status).toBe(401);
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
    const status = await request(app).post(path).set('x-hub-signature-256', signature).type('json').send(body);
    expect(status.status).toBe(200); expect(status.body.result.status).toBe('ignored');
  });
  it('rejects Evolution requests with a missing or wrong per-connection token', async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'connection' } }) };
    vi.spyOn(database, 'serviceDatabase').mockReturnValue({ from: () => query } as any);
    vi.spyOn(database.ConnectionRepository.prototype, 'getConnectionCredentials').mockResolvedValue({ serverUrl: 'https://evo.example', apiKey: 'test', webhookToken: 'expected-token' });
    const app = createApp({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test' });
    const res = await request(app).post('/api/webhooks/evolution/00000000-0000-4000-8000-000000000001').set('x-webhook-token', 'wrong')
      .send({ data: { key: { id: 'id', remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: 'Olá' } } });
    expect(res.status).toBe(401);
  });
  it('rejects Evolution webhook when persistence is not configured', async () => {
    const app = createApp();
    const connectionId = '00000000-0000-4000-8000-000000000001';

    const payload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '5511999998888@s.whatsapp.net',
          fromMe: false,
          id: 'msg-evo-12345',
        },
        pushName: 'Carlos Silva',
        message: {
          conversation: 'Olá, gostaria de saber mais sobre os planos',
        },
      },
    };

    const res = await request(app)
      .post(`/api/webhooks/evolution/${connectionId}`)
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Supabase');
    expect(res.body.result).toBeUndefined();
  });

  it('does not acknowledge failed requests as successfully processed', async () => {
    const app = createApp();
    const connectionId = '00000000-0000-4000-8000-000000000001';

    const payload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '5511999998888@s.whatsapp.net',
          fromMe: false,
          id: 'msg-duplicate-unique-key',
        },
        message: { conversation: 'Mensagem teste' },
      },
    };

    // Failure is explicit; it must not poison deduplication.
    const first = await request(app)
      .post(`/api/webhooks/evolution/${connectionId}`)
      .send(payload);
    expect(first.status).toBe(503);
    expect(first.body.error).toContain('Supabase');

    // Retrying an unprocessed request still reports missing configuration.
    const second = await request(app)
      .post(`/api/webhooks/evolution/${connectionId}`)
      .send(payload);
    expect(second.status).toBe(503);
    expect(second.body.error).toContain('Supabase');
    expect(second.body.result).toBeUndefined();
  });

  it('rejects Meta webhook when persistence is not configured', async () => {
    const app = createApp();
    const connectionId = '00000000-0000-4000-8000-000000000002';

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-123',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Ana Costa' }, wa_id: '5511988887777' }],
                messages: [
                  {
                    from: '5511988887777',
                    id: 'wamid.meta12345',
                    type: 'text',
                    text: { body: 'Informações sobre contratação' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post(`/api/webhooks/meta/${connectionId}`)
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Supabase');
    expect(res.body.result).toBeUndefined();
  });

  it('rejects invalid connection UUID on webhook endpoint', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/webhooks/evolution/invalid-uuid')
      .send({ data: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ID de conexão inválido');
  });
});
