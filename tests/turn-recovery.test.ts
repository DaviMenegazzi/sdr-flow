import { describe, expect, it, vi } from 'vitest';
import { dispatchPendingInboundEvents } from '../packages/runtime/src/turns/outbox-dispatcher.js';

// Fase 2 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.3.6, 13.3 "webhook aceito durante falha
// Redis"): the outbox dispatcher recovers inbound_events that were durably accepted (Fase 1)
// but never made it into the canonical queue — a Redis outage right after accept_inbound_event
// is exactly this case. Exercised against a mocked Supabase-JS-shaped client, since packages/db
// only speaks that API, not PGlite's raw SQL interface.

function pendingRow(overrides: Partial<{ id: string; connection_id: string; organization_id: string; normalized_payload: any; attempt_count: number; status: string }> = {}) {
  return {
    id: overrides.id ?? 'event-1',
    connection_id: overrides.connection_id ?? 'conn-1',
    organization_id: overrides.organization_id ?? 'org-1',
    provider_message_id: 'wa-1',
    normalized_payload: overrides.normalized_payload ?? { phone: '5511999999999' },
    attempt_count: overrides.attempt_count ?? 0,
    status: overrides.status ?? 'received',
  };
}

/** A full resolve+enqueue-capable db double, used when a test needs the dispatcher to succeed. */
function makeResolvableDb(rows: ReturnType<typeof pendingRow>[]) {
  const db: any = {
    from: vi.fn((table: string) => {
      if (table === 'inbound_events') {
        const q: any = {};
        for (const m of ['select', 'in', 'lte', 'order']) q[m] = vi.fn(() => q);
        q.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
        return q;
      }
      if (table === 'connections') {
        const q: any = { select: () => q, eq: () => q, single: async () => ({ data: { organization_id: 'org-1', owner_user_id: 'user-1', agent_id: 'agent-1' }, error: null }) };
        return q;
      }
      if (table === 'ai_agents') {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'agent-1', flow_id: 'flow-1', active_flow_version_id: 'v1', status: 'active' } }) };
        return q;
      }
      if (table === 'flows') {
        const q: any = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: { id: 'flow-1', name: 'F', published_version_id: 'v1' } }) };
        return q;
      }
      if (table === 'flow_versions') {
        const q: any = { select: () => q, eq: () => q, single: async () => ({ data: { id: 'v1', graph: { nodes: [] } }, error: null }) };
        return q;
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    }),
    rpc: vi.fn(),
  };
  const marks: Array<{ eventId: string; status: string; error?: string }> = [];
  db.rpc = vi.fn((name: string, args: any) => {
    if (name === 'mark_inbound_event_status') marks.push({ eventId: args.p_event_id, status: args.p_status, error: args.p_error });
    return Promise.resolve({ data: null, error: null });
  });
  return { db, marks };
}

/** A minimal db double for tests that never need to reach the resolve step. */
function makeSimpleDb(rows: ReturnType<typeof pendingRow>[]) {
  const marks: Array<{ eventId: string; status: string; error?: string }> = [];
  const db: any = {
    from: vi.fn((table: string) => {
      if (table === 'inbound_events') {
        const q: any = {};
        for (const m of ['select', 'in', 'lte', 'order']) q[m] = vi.fn(() => q);
        q.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
        return q;
      }
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }) };
    }),
    rpc: vi.fn((name: string, args: any) => {
      if (name === 'mark_inbound_event_status') marks.push({ eventId: args.p_event_id, status: args.p_status, error: args.p_error });
      return Promise.resolve({ data: null, error: null });
    }),
  };
  return { db, marks };
}

describe('dispatchPendingInboundEvents (outbox recovery)', () => {
  it('re-enqueues a pending event and marks it processing', async () => {
    const row = pendingRow();
    const { db, marks } = makeResolvableDb([row]);
    const enqueue = vi.fn().mockResolvedValue({ generation: 1, delayMs: 0 });

    const result = await dispatchPendingInboundEvents({ db, buffer: { enqueue } });

    expect(result).toMatchObject({ scanned: 1, requeued: 1, gaveUp: 0, resolutionFailed: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(marks).toEqual([{ eventId: 'event-1', status: 'processing', error: undefined }]);
  });

  it('gives up on events that already exhausted their retry budget, without touching them', async () => {
    const row = pendingRow({ attempt_count: 5 });
    const { db } = makeSimpleDb([row]);
    const enqueue = vi.fn();
    const result = await dispatchPendingInboundEvents({ db, buffer: { enqueue } });
    expect(result).toMatchObject({ scanned: 1, requeued: 0, gaveUp: 1, resolutionFailed: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('marks an event failed (not silently dropped) when the payload is missing a phone', async () => {
    const row = pendingRow({ normalized_payload: {} });
    const { db, marks } = makeSimpleDb([row]);
    const enqueue = vi.fn();
    const result = await dispatchPendingInboundEvents({ db, buffer: { enqueue } });
    expect(result.resolutionFailed).toBe(1);
    expect(marks).toEqual([{ eventId: 'event-1', status: 'failed', error: 'missing_phone_in_payload' }]);
  });
});
