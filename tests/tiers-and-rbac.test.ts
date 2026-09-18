import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import { asUser, testDatabase } from './helpers/database.js';
import { createApp } from '../apps/api/src/app.js';
import {
  type OrgTier,
  type MemberRole,
  CAPABILITIES,
  getCapabilities,
  hasCapability,
} from '../packages/shared/src/index.js';

describe('Tiers, RBAC and Multi-User Isolation', () => {
  describe('Static Capability Matrix (@sdr/shared)', () => {
    it('pre-venda: allows inbox, dashboard and agents, blocks integrations and payment gates', () => {
      const ownerCaps = getCapabilities('pre-venda', 'owner');
      expect(ownerCaps).toContain('inbox:read');
      expect(ownerCaps).toContain('inbox:reply');
      expect(ownerCaps).toContain('dashboard:read');
      expect(ownerCaps).toContain('agents:manage');
      expect(ownerCaps).not.toContain('integrations:manage');
      expect(ownerCaps).not.toContain('payment_gates:manage');

      expect(hasCapability('pre-venda', 'owner', 'integrations:manage')).toBe(false);
      expect(hasCapability('pre-venda', 'agent', 'dashboard:read')).toBe(true);
      expect(hasCapability('pre-venda', 'agent', 'agents:manage')).toBe(true);
      expect(hasCapability('pre-venda', 'agent', 'integrations:manage')).toBe(false);
    });

    it('vendedor: allows inbox, dashboard, agents and integrations, blocks payment gates', () => {
      const ownerCaps = getCapabilities('vendedor', 'owner');
      expect(ownerCaps).toContain('inbox:read');
      expect(ownerCaps).toContain('dashboard:read');
      expect(ownerCaps).toContain('agents:manage');
      expect(ownerCaps).toContain('integrations:manage');
      expect(ownerCaps).not.toContain('payment_gates:manage');

      expect(hasCapability('vendedor', 'owner', 'integrations:manage')).toBe(true);
      expect(hasCapability('vendedor', 'owner', 'payment_gates:manage')).toBe(false);
      expect(hasCapability('vendedor', 'admin', 'integrations:manage')).toBe(true);
      expect(hasCapability('vendedor', 'admin', 'payment_gates:manage')).toBe(false);
    });

    it('vendedor-senior: allows inbox, dashboard, agents, integrations and payment gates', () => {
      const ownerCaps = getCapabilities('vendedor-senior', 'owner');
      expect(ownerCaps).toContain('inbox:read');
      expect(ownerCaps).toContain('dashboard:read');
      expect(ownerCaps).toContain('agents:manage');
      expect(ownerCaps).toContain('integrations:manage');
      expect(ownerCaps).toContain('payment_gates:manage');

      expect(hasCapability('vendedor-senior', 'owner', 'payment_gates:manage')).toBe(true);
      expect(hasCapability('vendedor-senior', 'admin', 'payment_gates:manage')).toBe(true);
      expect(hasCapability('vendedor-senior', 'agent', 'payment_gates:manage')).toBe(false);
    });

    it('all tiers give access to agents for members', () => {
      const tiers: OrgTier[] = ['pre-venda', 'vendedor', 'vendedor-senior'];
      for (const tier of tiers) {
        expect(hasCapability(tier, 'owner', 'agents:manage')).toBe(true);
        expect(hasCapability(tier, 'admin', 'agents:manage')).toBe(true);
        expect(hasCapability(tier, 'agent', 'agents:manage')).toBe(true);
      }
    });
  });

  describe('PostgreSQL RLS & Multi-User in Same Organization', () => {
    let db: PGlite;
    const ownerA = randomUUID();
    const adminA = randomUUID();
    const agentA = randomUUID();
    const ownerB = randomUUID();
    let orgA: string;
    let orgB: string;
    let connA: string;
    let agentOrgA: string;

    beforeAll(async () => {
      db = await testDatabase();
      for (const id of [ownerA, adminA, agentA, ownerB]) {
        await db.query(
          "insert into auth.users(id, email, raw_user_meta_data) values($1, $2, $3)",
          [id, `${id}@example.test`, JSON.stringify({ display_name: `User ${id.slice(0, 4)}` })]
        );
      }

      // Provision organizations
      orgA = (
        await db.query<{ default_organization_id: string }>(
          'select default_organization_id from public.profiles where user_id=$1',
          [ownerA]
        )
      ).rows[0]!.default_organization_id;

      orgB = (
        await db.query<{ default_organization_id: string }>(
          'select default_organization_id from public.profiles where user_id=$1',
          [ownerB]
        )
      ).rows[0]!.default_organization_id;

      // Add adminA and agentA as members in orgA
      await db.query(
        "insert into public.organization_members(organization_id, user_id, role) values($1, $2, 'admin'), ($1, $3, 'agent')",
        [orgA, adminA, agentA]
      );

      // Create a connection in orgA by ownerA
      connA = randomUUID();
      agentOrgA = (
        await db.query<{ id: string }>(
          'select id from public.ai_agents where owner_user_id=$1 and is_default',
          [ownerA]
        )
      ).rows[0]!.id;

      await db.query(
        "insert into public.connections(id, organization_id, owner_user_id, agent_id, name, provider, status) values($1, $2, $3, $4, 'WhatsApp OrgA', 'evolution', 'connected')",
        [connA, orgA, ownerA, agentOrgA]
      );
    });

    afterAll(async () => {
      await db?.close();
    });

    it('allows admin and agent of the same organization to see connections created by owner', async () => {
      // Owner can see
      await asUser(db, ownerA, async () => {
        const rows = await db.query('select id from public.connections where organization_id=$1', [orgA]);
        expect(rows.rows.map((r: any) => r.id)).toContain(connA);
      });

      // Admin in same org can see (fixes Blind Spot 3)
      await asUser(db, adminA, async () => {
        const rows = await db.query('select id from public.connections where organization_id=$1', [orgA]);
        expect(rows.rows.map((r: any) => r.id)).toContain(connA);
      });

      // Agent in same org can see
      await asUser(db, agentA, async () => {
        const rows = await db.query('select id from public.connections where organization_id=$1', [orgA]);
        expect(rows.rows.map((r: any) => r.id)).toContain(connA);
      });

      // Owner of OrgB CANNOT see connection of OrgA
      await asUser(db, ownerB, async () => {
        const rows = await db.query('select id from public.connections where organization_id=$1', [orgA]);
        expect(rows.rows).toEqual([]);
      });
    });

    it('allows members of the same organization to see agents configured in that org', async () => {
      // Admin in same org can see agents
      await asUser(db, adminA, async () => {
        const rows = await db.query('select id from public.ai_agents where organization_id=$1', [orgA]);
        expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      });

      // Agent in same org can see agents
      await asUser(db, agentA, async () => {
        const rows = await db.query('select id from public.ai_agents where organization_id=$1', [orgA]);
        expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      });

      // Owner of OrgB CANNOT see agents of OrgA
      await asUser(db, ownerB, async () => {
        const rows = await db.query('select id from public.ai_agents where organization_id=$1', [orgA]);
        expect(rows.rows).toEqual([]);
      });
    });

    it('allows admin of the organization to assign agent to connection', async () => {
      await asUser(db, adminA, async () => {
        const result = await db.query<{ id: string }>(
          'select * from public.assign_agent_to_connection($1, $2)',
          [connA, agentOrgA]
        );
        expect(result.rows).toHaveLength(1);
      });
    });

    it('persists and enforces the tier column in organizations table', async () => {
      // Default tier is pre-venda
      const initial = await db.query<{ tier: string }>(
        'select tier from public.organizations where id=$1',
        [orgA]
      );
      expect(initial.rows[0]?.tier).toBe('pre-venda');

      // Update to vendedor
      await db.query("update public.organizations set tier='vendedor' where id=$1", [orgA]);
      const updated = await db.query<{ tier: string }>(
        'select tier from public.organizations where id=$1',
        [orgA]
      );
      expect(updated.rows[0]?.tier).toBe('vendedor');

      // Update to vendedor-senior
      await db.query("update public.organizations set tier='vendedor-senior' where id=$1", [orgA]);
      const senior = await db.query<{ tier: string }>(
        'select tier from public.organizations where id=$1',
        [orgA]
      );
      expect(senior.rows[0]?.tier).toBe('vendedor-senior');
    });
  });

  describe('API Dynamic Organization Resolution & Capability Gating', () => {
    const orgPreVenda = '00000000-0000-4000-8000-000000000001';
    const orgVendedor = '00000000-0000-4000-8000-000000000002';
    const orgSenior = '00000000-0000-4000-8000-000000000003';
    const otherOrg = '00000000-0000-4000-8000-000000000099';
    const testUserId = '00000000-0000-4000-8000-000000000010';

    const config = {
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-key',
      serviceRoleKey: 'service-key',
    };

    function mockUserDb(tier: OrgTier = 'pre-venda', role: MemberRole = 'owner', memberOfTarget = true) {
      return {
        auth: {
          getUser: async () => ({
            data: { user: { id: testUserId, email: 'user@example.com' } },
            error: null,
          }),
        },
        from: (table: string) => {
          return {
            select: (_fields: string) => ({
              eq: (_col1: string, val1: string) => ({
                maybeSingle: async () => {
                  if (table === 'profiles') {
                    return {
                      data: {
                        role: 'client',
                        status: 'active',
                        default_organization_id: orgPreVenda,
                      },
                      error: null,
                    };
                  }
                  if (table === 'organizations') {
                    return { data: { tier }, error: null };
                  }
                  return { data: null, error: null };
                },
                eq: (_col2: string, _val2: string) => ({
                  maybeSingle: async () => {
                    if (table === 'organization_members') {
                      if (!memberOfTarget) return { data: null, error: null };
                      return { data: { role }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          };
        },
      } as any;
    }

    it('/api/me returns active organization tier and computed capabilities', async () => {
      const databaseMod = await import('../packages/db/src/index.js');
      const spy = vi.spyOn(databaseMod, 'userDatabase').mockReturnValue(mockUserDb('pre-venda', 'agent'));

      const app = createApp(config);
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.orgTier).toBe('pre-venda');
      expect(res.body.memberRole).toBe('agent');
      expect(res.body.capabilities).toContain('inbox:read');
      expect(res.body.capabilities).toContain('dashboard:read');
      expect(res.body.capabilities).toContain('agents:manage');
      expect(res.body.capabilities).not.toContain('integrations:manage');

      spy.mockRestore();
    });

    it('/api/me respects X-Organization-Id and rejects unauthorized orgs with 403', async () => {
      const databaseMod = await import('../packages/db/src/index.js');
      // User is not a member of otherOrg
      const spy = vi.spyOn(databaseMod, 'userDatabase').mockReturnValue(mockUserDb('pre-venda', 'owner', false));

      const app = createApp(config);
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Organization-Id', otherOrg);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Acesso negado');

      spy.mockRestore();
    });

    it('blocks integrations in pre-venda tier with 403', async () => {
      const databaseMod = await import('../packages/db/src/index.js');
      const spy = vi.spyOn(databaseMod, 'userDatabase').mockReturnValue(mockUserDb('pre-venda', 'owner'));

      const app = createApp(config);
      const res = await request(app)
        .get(`/api/organizations/${orgPreVenda}/integrations/calendar/accounts`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.requiredCapability).toBe('integrations:manage');

      spy.mockRestore();
    });

    it('blocks payment gates in vendedor tier with 403', async () => {
      const databaseMod = await import('../packages/db/src/index.js');
      const spy = vi.spyOn(databaseMod, 'userDatabase').mockReturnValue(mockUserDb('vendedor', 'owner'));

      const app = createApp(config);
      const res = await request(app)
        .get(`/api/organizations/${orgVendedor}/integrations/payment-gates`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.requiredCapability).toBe('payment_gates:manage');

      spy.mockRestore();
    });

    it('allows payment gates in vendedor-senior tier', async () => {
      const databaseMod = await import('../packages/db/src/index.js');
      const spy = vi.spyOn(databaseMod, 'userDatabase').mockReturnValue(mockUserDb('vendedor-senior', 'owner'));

      const app = createApp(config);
      const res = await request(app)
        .get(`/api/organizations/${orgSenior}/integrations/payment-gates`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.gateways).toHaveLength(3);
      expect(res.body.gateways.map((g: any) => g.id)).toEqual(['asaas', 'mercado_pago', 'stripe']);

      spy.mockRestore();
    });
  });
});
