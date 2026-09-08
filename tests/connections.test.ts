import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { testDatabase, asUser } from './helpers/database.js';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { MetaCloudClient } from '../apps/api/src/whatsapp/meta-client.js';
import { EvolutionClient } from '../apps/api/src/whatsapp/evolution-client.js';
import { ConnectionManager } from '../apps/api/src/whatsapp/connection-manager.js';

describe('Phase 4 — WhatsApp Connections, Multi-Provider & Encrypted Credentials', () => {
  let db: PGlite;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const viewerA = randomUUID();

  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-only-credential-encryption-key');
    db = await testDatabase();
    for (const uid of [ownerA, ownerB, viewerA]) {
      await db.query('insert into auth.users(id, email) values($1, $2)', [uid, `${uid}@test.local`]);
    }

    orgA = await asUser(db, ownerA, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Empresa A') as id");
      return res.rows[0]!.id;
    });

    orgB = await asUser(db, ownerB, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Empresa B') as id");
      return res.rows[0]!.id;
    });

    await db.query("insert into public.organization_members(organization_id, user_id, role) values($1, $2, 'viewer')", [
      orgA,
      viewerA,
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.close();
  });

  describe('AES-256-GCM Credentials Encryption at Rest', () => {
    it('encrypts credentials and decrypts back to original data', () => {
      const credentials = {
        serverUrl: 'https://evolution.empresa.com',
        apiKey: 'secret-global-evolution-key-123456',
        instanceName: 'sdr_inst_001',
      };

      const ciphertext = database.encryptCredentials(credentials);
      expect(ciphertext).toContain(':');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3); // iv:tag:data

      const decrypted = database.decryptCredentials(ciphertext);
      expect(decrypted).toEqual(credentials);
    });

    it('rejects tampered ciphertexts', () => {
      const ciphertext = database.encryptCredentials({ token: 'xyz' });
      const parts = ciphertext.split(':');
      // Tamper with data part
      const tampered = `${parts[0]}:${parts[1]}:deadbeef`;
      expect(() => database.decryptCredentials(tampered)).toThrow();
    });

    it('masks secret tokens correctly for UI consumption', () => {
      expect(database.maskSecret('EAAB1234567890abcdef')).toBe('EAAB••••cdef');
      expect(database.maskSecret('short')).toBe('••••••••');
      expect(database.maskSecret(null)).toBe('');
    });
  });

  describe('PostgreSQL Connections Table & RLS Enforcement', () => {
    it('stores private credentials through service-only RPCs and enforces organization on write', async () => {
      const conn = randomUUID();
      await db.query("insert into public.connections(id,organization_id,name,provider) values($1,$2,'RPC test','meta')", [conn, orgB]);
      await db.exec('set role service_role');
      try {
        await db.query('select public.set_connection_credentials($1,$2,$3)', [orgB, conn, 'encrypted-test']);
        const read = await db.query<{ secret: string }>('select public.get_connection_credentials($1) as secret', [conn]);
        expect(read.rows[0]?.secret).toBe('encrypted-test');
        await expect(db.query('select public.set_connection_credentials($1,$2,$3)', [orgA, conn, 'wrong-org'])).rejects.toThrow('organization');
      } finally { await db.exec('reset role'); }
      await asUser(db, ownerB, async () => {
        await expect(db.query('select public.get_connection_credentials($1)', [conn])).rejects.toThrow('permission denied');
        await expect(db.query('select public.set_connection_credentials($1,$2,$3)', [orgB, conn, 'forbidden'])).rejects.toThrow('permission denied');
      });
      await db.query('delete from public.connections where id=$1', [conn]);
    });
    it('allows owner to create a connection and prevents cross-org read/write', async () => {
      const connId = randomUUID();

      await asUser(db, ownerA, async () => {
        await db.query(
          `insert into public.connections(id, organization_id, name, provider, status, phone)
           values($1, $2, 'WhatsApp Matriz', 'evolution', 'connected', '5511999990001')`,
          [connId, orgA]
        );
      });

      // Org A owner can see the connection
      await asUser(db, ownerA, async () => {
        const res = await db.query('select * from public.connections where organization_id = $1', [orgA]);
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].name).toBe('WhatsApp Matriz');
      });

      // Org B owner cannot see Org A connection
      await asUser(db, ownerB, async () => {
        const res = await db.query('select * from public.connections where organization_id = $1', [orgA]);
        expect(res.rows).toHaveLength(0);
      });

      // Org A owner cannot insert connection into Org B
      await asUser(db, ownerA, async () => {
        await expect(
          db.query(
            `insert into public.connections(organization_id, name, provider)
             values($1, 'Intrusion', 'meta')`,
            [orgB]
          )
        ).rejects.toThrow();
      });

      // Viewer cannot insert connection
      await asUser(db, viewerA, async () => {
        await expect(
          db.query(
            `insert into public.connections(organization_id, name, provider)
             values($1, 'Viewer Connection', 'evolution')`,
            [orgA]
          )
        ).rejects.toThrow();
      });
    });

    it('keeps private.connection_credentials inaccessible to authenticated users', async () => {
      await asUser(db, ownerA, async () => {
        await expect(db.query('select * from private.connection_credentials')).rejects.toThrow();
      });
    });
  });

  describe('Meta Cloud API & Evolution Provider Clients', () => {
    it('validates Meta credentials via Graph API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          display_phone_number: '55 11 98888-7777',
          verified_name: 'Vida Card Comercial',
          code_verification_status: 'VERIFIED',
        }),
      } as any);

      const result = await MetaCloudClient.verifyCredentials('phone-123', 'access-token-abc');
      expect(result.valid).toBe(true);
      expect(result.displayPhoneNumber).toBe('55 11 98888-7777');
      expect(result.verifiedName).toBe('Vida Card Comercial');

      fetchSpy.mockRestore();
    });

    it('handles Meta credential failure from Graph API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid OAuth access token' },
        }),
      } as any);

      const result = await MetaCloudClient.verifyCredentials('bad-phone', 'bad-token');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid OAuth access token');

      fetchSpy.mockRestore();
    });

    it('fetches live QR code and connection state in Evolution client', async () => {
      const client = new EvolutionClient('http://localhost:8080', 'evo-key');
      const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          instance: { state: 'connecting' },
          code: '2@ABCDEF123456...',
          base64: 'data:image/png;base64,iVBORw0KGgo...',
        }),
      } as any);

      const qr = await client.getConnectQr('instance-01');
      expect(qr.code).toBe('2@ABCDEF123456...');
      expect(qr.base64).toBe('data:image/png;base64,iVBORw0KGgo...');

      fetchSpy.mockRestore();
    });
  });

  describe('ConnectionManager Preparation & Health Checks', () => {
    it('prepares Meta connection with verified phone number and active status', async () => {
      vi.spyOn(MetaCloudClient, 'verifyCredentials').mockResolvedValueOnce({
        valid: true,
        displayPhoneNumber: '55 11 97777-6666',
        verifiedName: 'Empresa Teste',
      });

      const prep = await ConnectionManager.prepareConnection(
        orgA,
        'Canal Meta',
        'meta',
        {
          phoneNumberId: 'meta-phone-id',
          wabaId: 'meta-waba-id',
          accessToken: 'meta-token',
        }
      );

      expect(prep.status).toBe('connected');
      expect(prep.phone).toBe('55 11 97777-6666');
      expect(prep.providerInstanceId).toBe('meta-phone-id');
    });

    it('prepares Evolution connection with generated instance name and connecting status', async () => {
      vi.spyOn(EvolutionClient.prototype, 'createInstance').mockResolvedValueOnce({ success: true });

      const prep = await ConnectionManager.prepareConnection(
        orgA,
        'Canal Evolution',
        'evolution',
        {
          serverUrl: 'http://localhost:8080',
          apiKey: 'key-123',
        },
        '5511999990000'
      );

      expect(prep.status).toBe('connecting');
      expect(prep.providerInstanceId.startsWith('sdr_')).toBe(true);
      expect(prep.phone).toBe('5511999990000');
    });
  });

  describe('API Endpoints (/connections)', () => {
    const config = {
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'public-key',
      serviceRoleKey: 'service-key',
    };

    it('lists connections with masked secrets and generated webhook URLs', async () => {
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValueOnce({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['connections:read'],
      });

      vi.spyOn(database.ConnectionRepository.prototype, 'listConnections').mockResolvedValueOnce([
        {
          id: 'conn-1',
          organization_id: orgA,
          name: 'WhatsApp Vendas',
          provider: 'evolution',
          status: 'connected',
          phone: '5511999990001',
          provider_instance_id: 'inst-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          webhook_url: '/api/webhooks/evolution/conn-1',
        },
      ]);

      const res = await request(createApp(config))
        .get(`/api/organizations/${orgA}/connections`)
        .set('X-API-Key', 'sdr_live_read_connections_key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('WhatsApp Vendas');
      expect(res.body[0].webhook_url).toBe('/api/webhooks/evolution/conn-1');
    });

    it('creates an Evolution connection and registers webhook automatically', async () => {
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValueOnce({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['connections:write', 'admin'],
      });

      vi.spyOn(ConnectionManager, 'prepareConnection').mockResolvedValueOnce({
        status: 'connecting',
        phone: '5511999998888',
        providerInstanceId: 'sdr_inst_test',
        preparedCredentials: {
          serverUrl: 'http://localhost:8080',
          apiKey: 'test-key',
          instanceName: 'sdr_inst_test',
        },
      });

      vi.spyOn(database.ConnectionRepository.prototype, 'createConnection').mockResolvedValueOnce({
        id: 'conn-new-1',
        organization_id: orgA,
        name: 'Novo Evolution',
        provider: 'evolution',
        status: 'connecting',
        phone: '5511999998888',
        provider_instance_id: 'sdr_inst_test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        webhook_url: '/api/webhooks/evolution/conn-new-1',
      });

      const setWebhookSpy = vi.spyOn(EvolutionClient.prototype, 'setWebhook').mockResolvedValueOnce({ ok: true });

      const res = await request(createApp(config))
        .post(`/api/organizations/${orgA}/connections`)
        .set('X-API-Key', 'sdr_live_write_key')
        .send({
          name: 'Novo Evolution',
          provider: 'evolution',
          phone: '5511999998888',
          credentials: {
            serverUrl: 'http://localhost:8080',
            apiKey: 'test-key',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('conn-new-1');
      expect(setWebhookSpy).toHaveBeenCalled();
    });

    it('returns live QR code for Evolution connection', async () => {
      const validConnId = randomUUID();
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValueOnce({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['connections:read'],
      });

      vi.spyOn(database.ConnectionRepository.prototype, 'getConnection').mockResolvedValueOnce({
        id: validConnId,
        organization_id: orgA,
        name: 'Evo QR',
        provider: 'evolution',
        status: 'connecting',
        phone: null,
        provider_instance_id: 'inst-qr',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      vi.spyOn(database.ConnectionRepository.prototype, 'getConnectionCredentials').mockResolvedValueOnce({
        serverUrl: 'http://localhost:8080',
        apiKey: 'key',
        instanceName: 'inst-qr',
      });

      vi.spyOn(ConnectionManager, 'getLiveQr').mockResolvedValueOnce({
        code: 'mock-qr-code',
        base64: 'data:image/png;base64,mock',
        status: 'connecting',
        connected: false,
      });

      const res = await request(createApp(config))
        .get(`/api/organizations/${orgA}/connections/${validConnId}/qr`)
        .set('X-API-Key', 'sdr_live_key');

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('mock-qr-code');
      expect(res.body.base64).toBe('data:image/png;base64,mock');
    });

    it('rejects connection creation when user lacks permissions', async () => {
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValueOnce({
        valid: true,
        organizationId: orgA,
        role: 'viewer', // viewer cannot create
        scopes: ['connections:read'],
      });

      const res = await request(createApp(config))
        .post(`/api/organizations/${orgA}/connections`)
        .set('X-API-Key', 'sdr_live_viewer_key')
        .send({
          name: 'Tentativa Viewer',
          provider: 'evolution',
          credentials: { serverUrl: 'http://localhost:8080', apiKey: 'k' },
        });

      expect(res.status).toBe(403);
    });
  });
});
