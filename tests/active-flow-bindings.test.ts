import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const config = {
  supabaseUrl: 'https://example.supabase.co',
  anonKey: 'public-test-key',
  serviceRoleKey: 'private-test-key',
};

function query(result: { data: unknown; error?: unknown }) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (onfulfilled: (value: typeof result) => unknown, onrejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onfulfilled, onrejected);
  return chain;
}

afterEach(() => vi.restoreAllMocks());

describe('Active flow bindings', () => {
  it('returns the connection-pinned immutable version, not the flow draft or a newer global publication', async () => {
    const publishedGraph = {
      schemaVersion: 1,
      nodes: [{ id: 'test-guard', type: 'guard.test_mode', position: { x: 0, y: 0 }, config: { enabled: true, phone: '5511999999999' } }],
      edges: [],
    };
    const connection = { id: 'connection-1', name: 'WhatsApp Produção', provider_instance_id: 'whatsapp-prod', organization_id: organizationId, owner_user_id: userId, agent_id: 'agent-1' };
    let connectionReads = 0;
    const db = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'organizations') return query({ data: { tier: 'pre-venda' }, error: null });
        if (table === 'organization_members') return query({ data: { role: 'admin' }, error: null });
        if (table === 'profiles') return query({ data: { role: 'admin', status: 'active' }, error: null });
        if (table === 'connections') {
          connectionReads += 1;
          return query(connectionReads === 1 ? { data: [connection], error: null } : { data: connection, error: null });
        }
        if (table === 'ai_agents') {
          return query({ data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'version-2', status: 'active' }, error: null });
        }
        if (table === 'flows') {
          return query({
            data: {
              id: 'flow-1',
              name: 'Pré-venda F03',
              draft: { schemaVersion: 1, nodes: [], edges: [] },
              published_version_id: 'version-3',
            },
            error: null,
          });
        }
        if (table === 'flow_versions') {
          return query({
            data: {
              id: 'version-2',
              version: 2,
              created_at: '2026-09-11T17:33:30.000Z',
              graph: publishedGraph,
            },
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    vi.spyOn(database, 'userDatabase').mockReturnValue(db as unknown as database.UserDatabase);

    const response = await request(createApp(config))
      .get(`/api/organizations/${organizationId}/active-flows`)
      .auth('verified-token', { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        connection: { id: 'connection-1', name: 'WhatsApp Produção', instanceName: 'whatsapp-prod' },
        flow: {
          id: 'flow-1',
          name: 'Pré-venda F03',
          versionId: 'version-2',
          version: 2,
          publishedAt: '2026-09-11T17:33:30.000Z',
          graph: publishedGraph,
        },
      },
    ]);
  });
});
