import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TraceBatchWriter } from '../packages/runtime/src/trace/trace-batch-writer.js';
import type { StreamConsumerCommands, StreamEntry } from '../packages/runtime/src/trace/stream-commands.js';

// Fase 3 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 9.2, 9.4): batches flow_execution_steps
// writes instead of one insert per node. Exercised against an in-memory StreamConsumerCommands
// double (same dependency-injection pattern as the other runtime tests) since there's no real
// Redis in this environment — see docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 12.1 for why that
// homologation stays pending.

function makeStream() {
  const pending = new Map<string, StreamEntry>();
  const acked: string[] = [];
  let seq = 0;
  const commands: StreamConsumerCommands = {
    async ensureGroup() {},
    async readGroup(_key, _group, _consumer, count) {
      const entries = [...pending.values()].slice(0, count);
      return entries;
    },
    async claimStale() {
      return []; // exercised separately below
    },
    async ack(_key, _group, ids) {
      for (const id of ids) { pending.delete(id); acked.push(id); }
    },
  };
  return {
    commands,
    acked,
    push(fields: Record<string, string>) {
      const id = `${Date.now()}-${seq++}`;
      pending.set(id, { id, fields });
      return id;
    },
    pendingCount: () => pending.size,
  };
}

function stepFields(overrides: Partial<{ organizationId: string; executionId: string; nodeId: string; sequence: number; durationMs: number; input: unknown; output: unknown; error: string }> = {}) {
  return {
    organizationId: overrides.organizationId ?? 'org-1',
    executionId: overrides.executionId ?? 'exec-1',
    nodeId: overrides.nodeId ?? 'node-1',
    sequence: String(overrides.sequence ?? 1),
    durationMs: String(overrides.durationMs ?? 5),
    occurredAt: new Date().toISOString(),
    input: JSON.stringify(overrides.input ?? { a: 1 }),
    output: JSON.stringify(overrides.output ?? { b: 2 }),
    error: overrides.error ?? '',
  };
}

function makeDb(upsertImpl: (rows: any[], opts: any) => { error: any }) {
  const calls: Array<{ rows: any[]; opts: any }> = [];
  const db: any = {
    from: vi.fn(() => ({
      upsert: vi.fn((rows: any[], opts: any) => {
        calls.push({ rows, opts });
        return Promise.resolve(upsertImpl(rows, opts));
      }),
    })),
  };
  return { db, calls };
}

describe('TraceBatchWriter', () => {
  it('writes an entire batch in a single upsert call and acks only after a successful write', async () => {
    const stream = makeStream();
    for (let i = 1; i <= 5; i++) stream.push(stepFields({ sequence: i }));
    const { db, calls } = makeDb(() => ({ error: null }));

    const writer = new TraceBatchWriter({ db, streamCommands: stream.commands, batchSize: 30 });
    const written = await writer.runOnce();

    expect(written).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rows).toHaveLength(5);
    expect(calls[0]!.opts).toMatchObject({ onConflict: 'execution_id,sequence', ignoreDuplicates: true });
    expect(stream.acked).toHaveLength(5);
    expect(stream.pendingCount()).toBe(0);
  });

  it('never acks entries when the Supabase write fails — they stay pending for retry/reclaim', async () => {
    const stream = makeStream();
    stream.push(stepFields({ sequence: 1 }));
    stream.push(stepFields({ sequence: 2 }));
    const { db } = makeDb(() => ({ error: { message: 'db unavailable' } }));
    const onError = vi.fn();

    const writer = new TraceBatchWriter({ db, streamCommands: stream.commands, batchSize: 30, onError });
    await writer.runOnce();

    expect(stream.acked).toHaveLength(0);
    expect(stream.pendingCount()).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('caps a single write request to batchSize entries even with a larger backlog', async () => {
    const stream = makeStream();
    for (let i = 1; i <= 50; i++) stream.push(stepFields({ sequence: i }));
    const { db, calls } = makeDb(() => ({ error: null }));

    const writer = new TraceBatchWriter({ db, streamCommands: stream.commands, batchSize: 20 });
    const firstBatch = await writer.runOnce();

    expect(firstBatch).toBe(20);
    expect(calls[0]!.rows).toHaveLength(20);
    // A 50-node execution therefore needs ceil(50/20) = 3 batch writes total (9.4.9), not 50.
    expect(Math.ceil(50 / 20)).toBe(3);
  });

  it('acks and drops entries whose fields cannot be parsed, instead of retrying them forever', async () => {
    const stream = makeStream();
    stream.push({ organizationId: 'org-1' }); // missing executionId/nodeId/sequence
    const { db, calls } = makeDb(() => ({ error: null }));

    const writer = new TraceBatchWriter({ db, streamCommands: stream.commands });
    const handled = await writer.runOnce();

    expect(handled).toBe(1);
    expect(calls).toHaveLength(0); // never reached the DB — nothing valid to write
    expect(stream.acked).toHaveLength(1);
  });

  it('reclaims stale (crashed-consumer) entries ahead of fresh ones, up to batchSize', async () => {
    const staleEntry: StreamEntry = { id: 'stale-1', fields: stepFields({ sequence: 99 }) };
    const commands: StreamConsumerCommands = {
      async ensureGroup() {},
      claimStale: vi.fn(async () => [staleEntry]),
      readGroup: vi.fn(async () => []),
      ack: vi.fn(async () => {}),
    };
    const { db, calls } = makeDb(() => ({ error: null }));

    const writer = new TraceBatchWriter({ db, streamCommands: commands, batchSize: 10 });
    const handled = await writer.runOnce();

    expect(handled).toBe(1);
    expect(calls[0]!.rows[0]).toMatchObject({ sequence: 99 });
    expect(commands.readGroup).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), 9, expect.any(Number));
  });
});
