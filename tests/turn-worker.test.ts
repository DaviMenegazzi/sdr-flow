import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RedisTurnBuffer, type RedisTurnBufferDependencies } from '../packages/runtime/src/turns/redis-buffer.js';

// Fase 2 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.4, 8.8): debounce/lock semantics for the
// canonical queue, exercised with an in-memory Redis/BullMQ double — the same
// dependency-injection pattern used by the canonical queue, extended to cover lock renewal
// and lock loss.

const state = {
  jobs: [] as Array<{ name: string; data: any; options: any }>,
  processor: undefined as undefined | ((job: { data: any }) => Promise<any>),
  strings: new Map<string, string>(),
  sortedSets: new Map<string, Array<{ score: number; member: string }>>(),
  evalCalls: [] as string[],
};

function dependencies(overrides: Partial<RedisTurnBufferDependencies> = {}): RedisTurnBufferDependencies {
  return {
    redis: {
      async eval(script, keyCount, ...args) {
        if (script.includes('ZCARD')) {
          state.evalCalls.push('org_priority');
          const [key, nowStr, member, cutoffStr] = args.map(String);
          const now = Number(nowStr);
          const cutoff = Number(cutoffStr);
          const entries = (state.sortedSets.get(key!) || []).filter(entry => entry.score > cutoff);
          entries.push({ score: now, member: member! });
          state.sortedSets.set(key!, entries);
          return entries.length;
        }
        if (script.includes("redis.call('INCR'")) {
          state.evalCalls.push('incr_zadd');
          const [generationKey, eventsKey, member] = args.map(String);
          const generation = Number(state.strings.get(generationKey!) || 0) + 1;
          state.strings.set(generationKey!, String(generation));
          const entries = state.sortedSets.get(eventsKey!) || [];
          entries.push({ score: generation, member: member! });
          state.sortedSets.set(eventsKey!, entries);
          return generation;
        }
        if (script.includes('PEXPIRE')) {
          state.evalCalls.push('renew');
          const [lockKey, lockToken, ttl] = args.map(String);
          if (keyCount === 1 && state.strings.get(lockKey!) === lockToken) {
            state.strings.set(`${lockKey}:ttl`, ttl!);
            return 1;
          }
          return 0;
        }
        state.evalCalls.push('release');
        const [lockKey, lockToken] = args.map(String);
        if (keyCount === 1 && state.strings.get(lockKey!) === lockToken) {
          state.strings.delete(lockKey!);
          return 1;
        }
        return 0;
      },
      async get(key) { return state.strings.get(key) ?? null; },
      async set(key, value) {
        if (state.strings.has(key)) return null;
        state.strings.set(key, value);
        return 'OK';
      },
      async zrangebyscore(key, _min, max) {
        return (state.sortedSets.get(key) || []).filter(entry => entry.score <= max).map(entry => entry.member);
      },
      async zremrangebyscore(key, _min, max) {
        const entries = state.sortedSets.get(key) || [];
        const remaining = entries.filter(entry => entry.score > max);
        state.sortedSets.set(key, remaining);
        return entries.length - remaining.length;
      },
      async quit() { return 'OK'; },
    },
    queue: {
      async add(name, data, options) {
        state.jobs.push({ name, data, options });
        return { id: String(options.jobId) };
      },
      async close() {},
    },
    createWorker(processor) {
      state.processor = processor;
      return { async close() {} };
    },
    ...overrides,
  };
}

describe('RedisTurnBuffer (canonical queue debounce + lock)', () => {
  beforeEach(() => {
    state.jobs.length = 0;
    state.processor = undefined;
    state.strings.clear();
    state.sortedSets.clear();
    state.evalCalls.length = 0;
  });

  it('supersedes older generations and hands the final job every accumulated inbound event id, in order', async () => {
    const handled: string[][] = [];
    const buffer = new RedisTurnBuffer('redis://localhost:6379/0', 'sdr-turns', async turn => {
      handled.push(turn.inboundEventIds);
      return { status: 'executed' };
    }, dependencies());

    const common = { kind: 'published' as const, organizationId: 'org-1', connectionId: 'conn-1', conversationKey: 'conn-1:5511999999999', windowSeconds: 8 };
    const eventId1 = randomUUID();
    const eventId2 = randomUUID();
    await buffer.enqueue({ ...common, inboundEventId: eventId1 });
    await buffer.enqueue({ ...common, inboundEventId: eventId2 });

    const oldResult = await state.processor!({ data: state.jobs[0]!.data });
    const latestResult = await state.processor!({ data: state.jobs[1]!.data });

    expect(oldResult.status).toBe('superseded');
    expect(latestResult.status).toBe('executed');
    expect(handled).toEqual([[eventId1, eventId2]]);
    await buffer.close();
  });

  it('deprioritizes an organization that bursts many turns, without penalizing an idle one (cross-org fairness)', async () => {
    const buffer = new RedisTurnBuffer('redis://localhost:6379/0', 'sdr-turns', async () => ({ status: 'executed' }), dependencies());

    for (let i = 0; i < 4; i++) {
      await buffer.enqueue({ kind: 'published', organizationId: 'org-busy', connectionId: 'conn-1', conversationKey: `conn-1:lead-${i}`, windowSeconds: 5, inboundEventId: randomUUID() });
    }
    await buffer.enqueue({ kind: 'published', organizationId: 'org-idle', connectionId: 'conn-2', conversationKey: 'conn-2:lead-0', windowSeconds: 5, inboundEventId: randomUUID() });

    const priorities = state.jobs.map(job => job.options.priority as number);
    // org-busy's four turns queue up behind each other (0, 1, 2, 3)...
    expect(priorities.slice(0, 4)).toEqual([0, 1, 2, 3]);
    // ...but org-idle's turn — its first in the window — still gets the fast lane (0),
    // regardless of how much load org-busy has already piled up.
    expect(priorities[4]).toBe(0);
    await buffer.close();
  });

  it('validates enqueued jobs against ConversationTurnJobV1 — schemaVersion and correlationId are always present', async () => {
    const buffer = new RedisTurnBuffer('redis://localhost:6379/0', 'sdr-turns', async () => ({ status: 'executed' }), dependencies());
    await buffer.enqueue({ kind: 'published', organizationId: 'org-1', connectionId: 'conn-1', conversationKey: 'k', windowSeconds: 5, inboundEventId: randomUUID() });
    const job = state.jobs[0]!.data;
    expect(job.schemaVersion).toBe(1);
    expect(typeof job.correlationId).toBe('string');
    expect(job.correlationId.length).toBeGreaterThan(0);
    await buffer.close();
  });

  it('renews the lock periodically during a long-running turn, keeping isCurrent() true past the initial TTL', async () => {
    let resolveHandler!: () => void;
    const handlerGate = new Promise<void>(resolve => { resolveHandler = resolve; });
    let observedIsCurrentDuring: boolean | undefined;

    const buffer = new RedisTurnBuffer(
      'redis://localhost:6379/0',
      'sdr-turns',
      async turn => {
        await handlerGate;
        observedIsCurrentDuring = await turn.isCurrent();
        return { status: 'executed' };
      },
      dependencies({ lockTtlMs: 50, lockRenewIntervalMs: 10 }),
    );

    await buffer.enqueue({ kind: 'published', organizationId: 'org-1', connectionId: 'conn-1', conversationKey: 'k', windowSeconds: 5, inboundEventId: randomUUID() });
    const processing = state.processor!({ data: state.jobs[0]!.data });

    // Real timers: the renewal interval is real (setInterval), so wait past several renewal
    // cycles (and past the original lock TTL) before letting the handler finish.
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(state.evalCalls.filter(call => call === 'renew').length).toBeGreaterThanOrEqual(2);

    resolveHandler();
    const result = await processing;

    expect(result.status).toBe('executed');
    expect(observedIsCurrentDuring).toBe(true);
    await buffer.close();
  }, 10000);

  it('isCurrent() reports false once a newer generation has taken over the lock', async () => {
    let capturedIsCurrent: (() => Promise<boolean>) | undefined;
    let resolveHandler!: () => void;
    const handlerGate = new Promise<void>(resolve => { resolveHandler = resolve; });

    const buffer = new RedisTurnBuffer(
      'redis://localhost:6379/0',
      'sdr-turns',
      async turn => {
        capturedIsCurrent = turn.isCurrent;
        await handlerGate;
        return { status: 'executed' };
      },
      dependencies(),
    );

    const common = { kind: 'published' as const, organizationId: 'org-1', connectionId: 'conn-1', conversationKey: 'k', windowSeconds: 5 };
    await buffer.enqueue({ ...common, inboundEventId: randomUUID() });
    const firstJob = state.jobs[0]!.data;
    const processing = state.processor!({ data: firstJob });
    for (let i = 0; i < 20 && !capturedIsCurrent; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(capturedIsCurrent).toBeDefined();

    expect(await capturedIsCurrent!()).toBe(true);

    // A new message arrives mid-flight: bumps the generation counter directly (as a concurrent
    // enqueue() call would), without going through this same in-flight job.
    await buffer.enqueue({ ...common, inboundEventId: randomUUID() });

    expect(await capturedIsCurrent!()).toBe(false);

    resolveHandler();
    await processing;
    await buffer.close();
  });
});
