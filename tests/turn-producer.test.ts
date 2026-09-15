import { describe, expect, it, vi } from 'vitest';
import { resolveTurnFlow, resolveAndEnqueueTurn } from '../packages/runtime/src/turns/turn-producer.js';

// Fase 2 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.3.6, 8.5): the "which flow applies, and
// how long to debounce" resolution shared by the webhook's hot path and the outbox dispatcher.
// Uses a mocked Supabase-JS-shaped client (same pattern as tests/webhook-api.test.ts) since
// packages/db's repositories only speak that API, not PGlite's raw SQL interface.

function chain(result: { data: any; error?: any }) {
  const query: any = {};
  for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn().mockResolvedValue(result);
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  return query;
}

function makeDb(byTable: Record<string, { data: any; error?: any }>) {
  return {
    from: vi.fn((table: string) => chain(byTable[table] ?? { data: null })),
  } as any;
}

const graphWithBuffer = { nodes: [{ type: 'input.buffer', config: { windowSeconds: 12 } }] };

describe('resolveTurnFlow', () => {
  it('fails fast when the connection does not exist', async () => {
    const db = makeDb({ connections: { data: null, error: { message: 'not found' } } });
    const result = await resolveTurnFlow(db, 'conn-missing');
    expect(result.status).toBe('connection_not_found');
  });

  it('fails when no active agent is assigned to the connection', async () => {
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: null },
    });
    const result = await resolveTurnFlow(db, 'conn-1');
    expect(result.status).toBe('assigned_agent_not_found');
    expect((result as any).organizationId).toBe('org-1');
  });

  it('fails when the organization has no published flow', async () => {
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: null, active_flow_version_id: null, status: 'active' } },
      flows: { data: null },
    });
    const result = await resolveTurnFlow(db, 'conn-1');
    expect(result.status).toBe('no_published_flow');
  });

  it('fails when the pinned/published flow_version cannot be loaded', async () => {
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: null, status: 'active' } },
      flows: { data: { id: 'flow-1', name: 'F', published_version_id: 'v1' } },
      flow_versions: { data: null },
    });
    const result = await resolveTurnFlow(db, 'conn-1');
    expect(result.status).toBe('invalid_flow_version');
  });

  it('resolves the pinned flow version and reads the debounce window from its graph', async () => {
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'v2', status: 'active' } },
      flows: { data: { id: 'flow-1', name: 'F', published_version_id: 'v1' } },
      flow_versions: { data: { id: 'v2', graph: graphWithBuffer } },
    });
    const result = await resolveTurnFlow(db, 'conn-1');
    expect(result).toMatchObject({ status: 'resolved', organizationId: 'org-1', flowId: 'flow-1', flowVersionId: 'v2', windowSeconds: 12 });
  });

  it('prefers the agent-scoped active_flow_version_id over the flow\'s currently published version', async () => {
    // This is exactly the "no version swap mid-debounce" guarantee (8.3.5): whichever version
    // was pinned wins, even if a newer one has since been published on the same flow.
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'v-pinned', status: 'active' } },
      flows: { data: { id: 'flow-1', name: 'F', published_version_id: 'v-newer' } },
      flow_versions: { data: { id: 'v-pinned', graph: { nodes: [] } } },
    });
    const result = await resolveTurnFlow(db, 'conn-1');
    expect(result.status).toBe('resolved');
    expect((result as any).flowVersionId).toBe('v-pinned');
  });

  it('returns the immutable version metadata and graph used by active-flow cards', async () => {
    // The mutable draft can differ from the version pinned to this connection.
    // Cards must display the latter, exactly as the worker will execute it.
    const publishedGraph = { nodes: [{ type: 'guard.test_mode', config: { enabled: true, phone: '5511999999999' } }] };
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'v-pinned', status: 'active' } },
      flows: {
        data: {
          id: 'flow-1',
          name: 'Fluxo publicado',
          draft: { nodes: [{ type: 'guard.test_mode', config: { enabled: false } }] },
          published_version_id: 'v-newer',
        },
      },
      flow_versions: {
        data: {
          id: 'v-pinned',
          version: 3,
          created_at: '2026-09-15T12:34:56.000Z',
          graph: publishedGraph,
        },
      },
    });

    const result = await resolveTurnFlow(db, 'conn-1');

    expect(result).toMatchObject({
      status: 'resolved',
      flowId: 'flow-1',
      flowVersionId: 'v-pinned',
      flowName: 'Fluxo publicado',
      flowVersion: 3,
      flowVersionCreatedAt: '2026-09-15T12:34:56.000Z',
      graph: publishedGraph,
    });
  });
});

describe('resolveAndEnqueueTurn', () => {
  it('enqueues with the resolved flow/version and a connection+phone conversationKey', async () => {
    const db = makeDb({
      connections: { data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' } },
      ai_agents: { data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'v2', status: 'active' } },
      flows: { data: { id: 'flow-1', name: 'F', published_version_id: 'v1' } },
      flow_versions: { data: { id: 'v2', graph: graphWithBuffer } },
    });
    const enqueue = vi.fn().mockResolvedValue({ generation: 3, delayMs: 12000 });
    const result = await resolveAndEnqueueTurn({ db, buffer: { enqueue } }, { connectionId: 'conn-1', eventId: 'event-1', phone: '5511999999999' });

    expect(result).toMatchObject({ status: 'queued', organizationId: 'org-1', flowId: 'flow-1', flowVersionId: 'v2', generation: 3, delayMs: 12000 });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'published',
      organizationId: 'org-1',
      connectionId: 'conn-1',
      conversationKey: 'conn-1:5511999999999',
      flowVersionId: 'v2',
      windowSeconds: 12,
      inboundEventId: 'event-1',
    }));
  });

  it('never calls enqueue when resolution fails', async () => {
    const db = makeDb({ connections: { data: null, error: {} } });
    const enqueue = vi.fn();
    const result = await resolveAndEnqueueTurn({ db, buffer: { enqueue } }, { connectionId: 'conn-missing', eventId: 'event-1', phone: '5511999999999' });
    expect(result.status).toBe('connection_not_found');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
