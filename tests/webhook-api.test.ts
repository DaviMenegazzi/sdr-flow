import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import * as database from '../packages/db/src/index.js';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { idempotencyGate } from '../apps/api/src/webhook.js';

describe('API Webhook & Inbound Gateway', () => {
  afterEach(() => vi.restoreAllMocks());
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
  beforeEach(() => {
    idempotencyGate.clear();
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
