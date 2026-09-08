import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { testDatabase, asUser } from './helpers/database.js';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { createBlankFlow } from '../packages/flow/src/index.js';

describe('Phase 3 — Login, Organizations, RLS, Invitations and S2S API Keys', () => {
  let db: PGlite;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const invitee = randomUUID();
  const stranger = randomUUID();

  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    db = await testDatabase();
    for (const uid of [ownerA, ownerB, invitee, stranger]) {
      await db.query('insert into auth.users(id, email) values($1, $2)', [uid, `${uid}@test.local`]);
    }

    // Create organizations
    orgA = await asUser(db, ownerA, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Organizacao Alpha') as id");
      return res.rows[0]!.id;
    });

    orgB = await asUser(db, ownerB, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Organizacao Beta') as id");
      return res.rows[0]!.id;
    });
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('PostgreSQL RLS & Invitation Token Lifecycle', () => {
    it('creates an invitation with cryptographically secure token and enforces RLS', async () => {
      const token = '1234567890abcdef1234567890abcdef12345678';
      await asUser(db, ownerA, async () => {
        const inv = await db.query(
          `select * from public.create_invitation($1, $2, 'agent', $3)`,
          [orgA, 'consultor@alpha.com', token]
        );
        expect(inv.rows).toHaveLength(1);
      });

      // User in Org A can view invitations of Org A
      await asUser(db, ownerA, async () => {
        const res = await db.query('select * from public.invitations where organization_id = $1', [orgA]);
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].email).toBe('consultor@alpha.com');
      });

      // User in Org B cannot view Org A invitations
      await asUser(db, ownerB, async () => {
        const res = await db.query('select * from public.invitations where organization_id = $1', [orgA]);
        expect(res.rows).toHaveLength(0);
      });

      // Stranger cannot view Org A invitations
      await asUser(db, stranger, async () => {
        const res = await db.query('select * from public.invitations');
        expect(res.rows).toHaveLength(0);
      });
    });

    it('allows an invited user to accept invitation and join the organization', async () => {
      const token = 'abcdef1234567890abcdef1234567890abcdef12';
      await asUser(db, ownerA, async () => {
        await db.query(
          `select * from public.create_invitation($1, $2, 'agent', $3)`,
          [orgA, 'novo_agente@alpha.com', token]
        );
      });

      // Invitee accepts the invitation
      const joinedOrg = await asUser(db, invitee, async () => {
        const res = await db.query<{ accept_invitation: string }>(
          `select public.accept_invitation($1) as accept_invitation`,
          [token]
        );
        return res.rows[0]!.accept_invitation;
      });

      expect(joinedOrg).toBe(orgA);

      // Verify membership has been established
      const members = await asUser(db, invitee, async () => {
        const res = await db.query<{ role: string }>(
          `select role from public.organization_members where organization_id = $1 and user_id = $2`,
          [orgA, invitee]
        );
        return res.rows;
      });

      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('agent');

      // Invitation is one-time use (deleted upon acceptance)
      await asUser(db, ownerA, async () => {
        const res = await db.query('select * from public.invitations where token = $1', [token]);
        expect(res.rows).toHaveLength(0);
      });

      // Attempting to re-use token fails
      await expect(
        asUser(db, invitee, async () => {
          await db.query(`select public.accept_invitation($1)`, [token]);
        })
      ).rejects.toThrow();
    });

    it('rejects expired invitations', async () => {
      const expiredToken = 'expired000000000000000000000000000000000';
      // Insert an expired invitation directly
      await db.query(
        `insert into public.invitations(organization_id, email, role, token, expires_at)
         values($1, $2, 'viewer', $3, now() - interval '1 hour')`,
        [orgA, 'expirado@alpha.com', expiredToken]
      );

      await expect(
        asUser(db, stranger, async () => {
          await db.query(`select public.accept_invitation($1)`, [expiredToken]);
        })
      ).rejects.toThrow();
    });
  });

  describe('OrganizationRepository & API Key Hashing / Verification', () => {
    it('creates API key with prefix, sha256 hash and scopes', async () => {
      // Mock db client for OrganizationRepository
      const fakeDb: any = {
        from: (table: string) => ({
          insert: (record: any) => ({
            select: () => ({
              single: async () => ({
                data: { id: randomUUID(), ...record, created_at: new Date().toISOString() },
                error: null,
              }),
            }),
          }),
        }),
      };

      const repo = new database.OrganizationRepository(fakeDb);
      const { rawKey, key } = await repo.createApiKey(orgA, 'Chave de Teste', 'admin', ['flows:read', 'flows:write']);

      expect(rawKey.startsWith('sdr_live_')).toBe(true);
      expect(rawKey.length).toBeGreaterThan(32);
      expect(key.key_prefix).toBe(rawKey.slice(0, 14));
      expect(key.key_hash).toBe(createHash('sha256').update(rawKey).digest('hex'));
      expect(key.scopes).toEqual(['flows:read', 'flows:write']);
    });

    it('verifies valid API key correctly', async () => {
      const secret = 'sdr_live_112233445566778899aabbccddeeff00';
      const keyHash = createHash('sha256').update(secret).digest('hex');
      const fakeRow = {
        id: randomUUID(),
        organization_id: orgA,
        role: 'admin',
        scopes: ['flows:read', 'flows:write'],
        expires_at: null,
      };

      const fakeDb: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: fakeRow, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };

      const repo = new database.OrganizationRepository(fakeDb);
      const result = await repo.verifyApiKey(secret);

      expect(result.valid).toBe(true);
      expect(result.organizationId).toBe(orgA);
      expect(result.role).toBe('admin');
      expect(result.scopes).toEqual(['flows:read', 'flows:write']);
    });

    it('rejects expired API keys', async () => {
      const secret = 'sdr_live_expired112233445566778899aabbcc';
      const fakeRow = {
        id: randomUUID(),
        organization_id: orgA,
        role: 'viewer',
        scopes: ['flows:read'],
        expires_at: new Date(Date.now() - 3600000).toISOString(),
      };

      const fakeDb: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: fakeRow, error: null }),
            }),
          }),
        }),
      };

      const repo = new database.OrganizationRepository(fakeDb);
      const result = await repo.verifyApiKey(secret);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expirada');
    });

    it('rejects invalid key formats or non-existing keys', async () => {
      const fakeDb: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };

      const repo = new database.OrganizationRepository(fakeDb);
      expect((await repo.verifyApiKey('invalid_prefix_key')).valid).toBe(false);
      expect((await repo.verifyApiKey('sdr_live_nonexistent')).valid).toBe(false);
    });
  });

  describe('API Dual Auth Middleware & Team Management Endpoints', () => {
    const config = {
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-key',
      serviceRoleKey: 'service-key',
    };

    it('authenticates S2S requests via X-API-Key header and grants access', async () => {
      const rawKey = 'sdr_live_valid_key_for_test_1234567890';
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValue({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['flows:read'],
        keyId: 'key-123',
      });

      vi.spyOn(database.FlowRepository.prototype, 'list').mockResolvedValue([
        { id: 'flow-1', name: 'Fluxo 1', organization_id: orgA } as any,
      ]);

      const res = await request(createApp(config))
        .get(`/api/organizations/${orgA}/flows`)
        .set('X-API-Key', rawKey);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'flow-1', name: 'Fluxo 1', organization_id: orgA }]);
    });

    it('blocks API Key when attempting cross-organization access', async () => {
      const rawKey = 'sdr_live_valid_key_for_org_a';
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValue({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['flows:read'],
        keyId: 'key-123',
      });

      // Target Org B with Org A's key
      const res = await request(createApp(config))
        .get(`/api/organizations/${orgB}/flows`)
        .set('X-API-Key', rawKey);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Sem acesso a esta organização');
    });

    it('enforces granular scope checks for API keys', async () => {
      const rawKey = 'sdr_live_read_only_key';
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValue({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['flows:read'], // missing flows:write
        keyId: 'key-ro',
      });

      const res = await request(createApp(config))
        .post(`/api/organizations/${orgA}/flows`)
        .set('X-API-Key', rawKey)
        .send({ name: 'Novo Fluxo', graph: createBlankFlow() });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Permissão insuficiente. Escopo necessário: flows:write');
    });

    it('allows invitations and members listing via API', async () => {
      const rawKey = 'sdr_live_admin_key';
      vi.spyOn(database.OrganizationRepository.prototype, 'verifyApiKey').mockResolvedValue({
        valid: true,
        organizationId: orgA,
        role: 'admin',
        scopes: ['admin'],
        keyId: 'key-admin',
      });

      vi.spyOn(database.OrganizationRepository.prototype, 'listMembers').mockResolvedValue([
        { organization_id: orgA, user_id: ownerA, role: 'owner', created_at: new Date().toISOString() },
      ]);

      const res = await request(createApp(config))
        .get(`/api/organizations/${orgA}/members`)
        .set('X-API-Key', rawKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].role).toBe('owner');
    });
  });
});
