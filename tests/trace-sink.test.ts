import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RedisTraceSink } from '../packages/runtime/src/trace/trace-sink.js';

// Fase 3 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 9.4.8): a node with an oversized
// input/output payload must be truncated with a marker before it ever reaches Redis or
// Postgres, not crash the worker or bloat the stream indefinitely.

const ORG_ID = randomUUID();
const EXECUTION_ID = randomUUID();

function fakeRedis() {
  const calls: any[] = [];
  return {
    calls,
    client: {
      xadd: vi.fn((...args: any[]) => { calls.push(args); return Promise.resolve('1-0'); }),
      on: vi.fn(),
      quit: vi.fn(),
    },
  };
}

function fieldsFromXaddCall(args: any[]): Record<string, string> {
  // args = [streamKey, '*', field1, value1, field2, value2, ...]
  const flat = args.slice(2);
  const fields: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
  return fields;
}

describe('RedisTraceSink', () => {
  it('appends a step as a versioned event with all required fields', async () => {
    const redis = fakeRedis();
    const sink = new RedisTraceSink(redis.client as any);
    await sink.append({ organizationId: ORG_ID, executionId: EXECUTION_ID, nodeId: 'node-1', sequence: 3, durationMs: 12.6, input: { a: 1 }, output: { b: 2 } });

    expect(redis.client.xadd).toHaveBeenCalledTimes(1);
    const fields = fieldsFromXaddCall(redis.calls[0]);
    expect(fields.organizationId).toBe(ORG_ID);
    expect(fields.executionId).toBe(EXECUTION_ID);
    expect(fields.nodeId).toBe('node-1');
    expect(fields.sequence).toBe('3');
    expect(fields.durationMs).toBe('13'); // rounded
    expect(JSON.parse(fields.input)).toEqual({ a: 1 });
    expect(JSON.parse(fields.output)).toEqual({ b: 2 });
  });

  it('truncates an oversized payload with a marker instead of forwarding it whole', async () => {
    const redis = fakeRedis();
    const sink = new RedisTraceSink(redis.client as any);
    const hugeOutput = { text: 'x'.repeat(50_000) };
    await sink.append({ organizationId: ORG_ID, executionId: EXECUTION_ID, nodeId: 'node-1', sequence: 1, durationMs: 1, output: hugeOutput });

    const fields = fieldsFromXaddCall(redis.calls[0]);
    const parsedOutput = JSON.parse(fields.output);
    expect(parsedOutput.truncated).toBe(true);
    expect(parsedOutput.originalLength).toBeGreaterThan(8000);
    expect(fields.output.length).toBeLessThan(9000);
  });

  it('never throws on unserializable input — falls back to a safe marker', async () => {
    const redis = fakeRedis();
    const sink = new RedisTraceSink(redis.client as any);
    const circular: any = {};
    circular.self = circular;

    await expect(sink.append({ organizationId: ORG_ID, executionId: EXECUTION_ID, nodeId: 'node-1', sequence: 1, durationMs: 1, input: circular })).resolves.toBeUndefined();
    const fields = fieldsFromXaddCall(redis.calls[0]);
    expect(JSON.parse(fields.input)).toEqual({ unserializable: true });
  });
});
