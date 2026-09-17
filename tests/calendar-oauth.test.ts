import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase, asUser } from './helpers/database.js';
import { CalendarRepository, encryptCredentials, decryptCredentials } from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { GoogleCalendarClient } from '../packages/flow/src/index.js';

describe('Google Calendar OAuth & Multi-Tenant Supabase Integration', () => {
  let db: PGlite;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const viewerA = randomUUID();

  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-only-calendar-oauth-encryption-key');
    db = await testDatabase();

    for (const uid of [ownerA, ownerB, viewerA]) {
      await db.query('insert into auth.users(id, email) values($1, $2)', [uid, `${uid}@test.local`]);
    }

    orgA = await asUser(db, ownerA, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Organizacao Alfa') as id");
      return res.rows[0]!.id;
    });

    orgB = await asUser(db, ownerB, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Organizacao Beta') as id");
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

  describe('Postgres Schema, RLS & Security Functions', () => {
    it('creates an OAuth state and consumes it exactly once via security definer RPC', async () => {
      const state = 'test_state_nonce_12345';

      // Insert state
      await db.query('select public.create_oauth_state($1, $2, $3, $4, $5)', [
        orgA,
        ownerA,
        state,
        'google_calendar',
        '/integrations?test=true',
      ]);

      // First consume: must return stored row
      const firstRes = await db.query<{ organization_id: string; user_id: string; provider: string; redirect_url: string }>(
        'select * from public.verify_and_consume_oauth_state($1)',
        [state],
      );
      expect(firstRes.rows).toHaveLength(1);
      expect(firstRes.rows[0]!.organization_id).toBe(orgA);
      expect(firstRes.rows[0]!.user_id).toBe(ownerA);
      expect(firstRes.rows[0]!.redirect_url).toBe('/integrations?test=true');

      // Second consume: must be empty (single-use token protection)
      const secondRes = await db.query('select * from public.verify_and_consume_oauth_state($1)', [state]);
      expect(secondRes.rows).toHaveLength(0);
    });

    it('stores encrypted credentials in private schema and retrieves via RPC', async () => {
      // Create account in orgA as ownerA
      const accountId = await asUser(db, ownerA, async () => {
        const res = await db.query<{ id: string }>(
          "insert into public.calendar_accounts(organization_id, account_email, account_name) values($1, 'dr.alfa@clinica.com', 'Dr. Alfa') returning id",
          [orgA],
        );
        return res.rows[0]!.id;
      });

      const creds = { refresh_token: '1//refresh_token_secret_xyz', client_id: 'cid' };
      const ciphertext = encryptCredentials(creds);

      // Save credentials via RPC
      await db.query('select public.set_calendar_credentials($1, $2, $3)', [orgA, accountId, ciphertext]);

      // Retrieve credentials via RPC
      const res = await db.query<{ get_calendar_credentials: string }>(
        'select public.get_calendar_credentials($1)',
        [accountId],
      );
      expect(res.rows[0]!.get_calendar_credentials).toBe(ciphertext);

      const decrypted = decryptCredentials<typeof creds>(res.rows[0]!.get_calendar_credentials);
      expect(decrypted.refresh_token).toBe('1//refresh_token_secret_xyz');
    });

    it('enforces RLS isolation on calendar_accounts', async () => {
      // Owner A can see accounts in Org A
      const accountsForA = await asUser(db, ownerA, async () => {
        return (await db.query<{ id: string }>('select id from public.calendar_accounts where organization_id = $1', [orgA])).rows;
      });
      expect(accountsForA.length).toBeGreaterThanOrEqual(1);

      // Owner B cannot see accounts in Org A
      const accountsForB = await asUser(db, ownerB, async () => {
        return (await db.query<{ id: string }>('select id from public.calendar_accounts where organization_id = $1', [orgA])).rows;
      });
      expect(accountsForB).toHaveLength(0);

      // Owner B cannot insert account into Org A
      await asUser(db, ownerB, async () => {
        await expect(
          db.query("insert into public.calendar_accounts(organization_id, account_email) values($1, 'intruder@b.com')", [orgA]),
        ).rejects.toThrow();
      });
    });
  });

  describe('CalendarRepository query builder & credentials resolution', () => {
    it('scopes listAccounts by organization and orders by created_at', async () => {
      const query: any = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.order = vi.fn().mockResolvedValue({
        data: [{ id: 'acc-1', organization_id: 'org-1', account_email: 'test@org.com', status: 'connected' }],
        error: null,
      });
      const fakeDb = { from: vi.fn(() => query) };
      const repo = new CalendarRepository(fakeDb as any);

      const accounts = await repo.listAccounts('org-1');
      expect(fakeDb.from).toHaveBeenCalledWith('calendar_accounts');
      expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.account_email).toBe('test@org.com');
    });

    it('resolves active credentials by selecting latest connected account and calling RPC', async () => {
      const creds = { refresh_token: '1//resolved_token', client_id: 'cid' };
      const ciphertext = encryptCredentials(creds);

      const query: any = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.order = vi.fn(() => query);
      query.limit = vi.fn(() => query);
      query.maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'acc-active' },
        error: null,
      });

      const fakeDb = {
        from: vi.fn(() => query),
        rpc: vi.fn().mockResolvedValue({
          data: ciphertext,
          error: null,
        }),
      };

      const repo = new CalendarRepository(fakeDb as any);
      const resolved = await repo.resolveActiveAccountCredentials<typeof creds>('org-1');

      expect(fakeDb.from).toHaveBeenCalledWith('calendar_accounts');
      expect(fakeDb.rpc).toHaveBeenCalledWith('get_calendar_credentials', { p_account: 'acc-active' });
      expect(resolved?.refresh_token).toBe('1//resolved_token');
    });

    it('returns null when organization has no connected calendar accounts', async () => {
      const query: any = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.order = vi.fn(() => query);
      query.limit = vi.fn(() => query);
      query.maybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const fakeDb = { from: vi.fn(() => query), rpc: vi.fn() };
      const repo = new CalendarRepository(fakeDb as any);

      const resolved = await repo.resolveActiveAccountCredentials('org-empty');
      expect(resolved).toBeNull();
      expect(fakeDb.rpc).not.toHaveBeenCalled();
    });
  });

  describe('Google Calendar Client Multi-Account Behavior', () => {
    it('creates GoogleCalendarClient with custom account refresh token', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'new_fresh_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new GoogleCalendarClient(mockFetch as any, {
        client_id: 'cid',
        client_secret: 'csec',
        refresh_token: 'refresh_org_specific',
      });

      expect(client).toBeInstanceOf(GoogleCalendarClient);
    });

    it('refreshes a stale stored access_token on 401 and retries once instead of failing', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Request had invalid authentication credentials.' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'refreshed_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ summary: 'Agenda Principal' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));

      // Simulates a stored credential where the ~1h access_token has expired
      // between OAuth connect time and this turn, but the refresh_token is still valid.
      const client = new GoogleCalendarClient(mockFetch as any, {
        client_id: 'cid',
        client_secret: 'csec',
        refresh_token: 'refresh_org_specific',
        access_token: 'stale_expired_access_token',
      });

      const name = await client.getCalendarName('primary');

      expect(name).toBe('Agenda Principal');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // First call must use the stale token directly (no refresh yet)
      expect((mockFetch.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer stale_expired_access_token',
      });
      // Second call is the token refresh against Google's OAuth endpoint
      expect(mockFetch.mock.calls[1]![0]).toBe('https://oauth2.googleapis.com/token');
      // Third call is the retried request with the freshly refreshed token
      expect((mockFetch.mock.calls[2]![1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer refreshed_token',
      });
    });

    it('throws the original 401 error when there is no refresh_token to recover with', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Request had invalid authentication credentials.' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = new GoogleCalendarClient(mockFetch as any, { access_token: 'stale_expired_access_token' });

      await expect(client.getCalendarName('primary')).rejects.toThrow('invalid authentication credentials');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('API OAuth Configuration & Endpoints', () => {
    it('creates API with Google OAuth configurations without errors', async () => {
      const app = createApp({
        supabaseUrl: 'http://127.0.0.1:54321',
        anonKey: 'test-anon-key',
        serviceRoleKey: 'test-service-role-key',
        googleOAuthClientId: 'test-google-client-id.apps.googleusercontent.com',
        googleOAuthClientSecret: 'test-google-client-secret',
        googleOAuthRedirectUri: 'http://localhost:3001/api/integrations/google/callback',
      });

      expect(app).toBeDefined();
    });
  });
});
