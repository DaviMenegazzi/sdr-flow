import { beforeEach, describe, expect, it } from 'vitest';
import {
  bufferWindowSeconds,
  ConversationTurnQueue,
  type ConversationTurnQueueDependencies,
} from '../apps/api/src/conversation-turn-queue.js';

const state = {
  jobs: [] as Array<{ name: string; data: any; options: any }>,
  processor: undefined as undefined | ((job: { data: any }) => Promise<any>),
  strings: new Map<string, string>(),
  sortedSets: new Map<string, Array<{ score: number; member: string }>>(),
};

function dependencies(): ConversationTurnQueueDependencies {
  return {
    redis: {
      async eval(script, keyCount, ...args) {
        if (script.includes("redis.call('INCR'")) {
          const [generationKey, messagesKey, member] = args.map(String);
          const generation = Number(state.strings.get(generationKey!) || 0) + 1;
          state.strings.set(generationKey!, String(generation));
          const entries = state.sortedSets.get(messagesKey!) || [];
          entries.push({ score: generation, member: member! });
          state.sortedSets.set(messagesKey!, entries);
          return generation;
        }
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
  };
}

function event(messageId: string, textContent: string) {
  return {
    messageId,
    remoteJid: '5511999999999@s.whatsapp.net',
    phone: '5511999999999',
    textContent,
    messageType: 'text',
    fromMe: false,
  };
}

describe('persistent conversation turn debounce', () => {
  beforeEach(() => {
    state.jobs.length = 0;
    state.processor = undefined;
    state.strings.clear();
    state.sortedSets.clear();
  });

  it('reads and bounds the quiet window from input.buffer', () => {
    expect(bufferWindowSeconds({ nodes: [] })).toBe(0);
    expect(bufferWindowSeconds({ nodes: [{ type: 'input.buffer', config: { windowSeconds: 8 } }] })).toBe(8);
    expect(bufferWindowSeconds({ nodes: [{ type: 'input.buffer', config: { windowSeconds: 999 } }] })).toBe(120);
  });

  it('supersedes the old job and executes the latest generation with every buffered message', async () => {
    const handled: string[][] = [];
    const queue = new ConversationTurnQueue('redis://localhost:6379/0', async turn => {
      handled.push(turn.events.map(item => item.textContent));
      return { status: 'executed' };
    }, dependencies());
    const common = { kind: 'published' as const, target: 'connection-1', conversationKey: 'org-1:conversation-1', windowSeconds: 8 };

    await queue.enqueue({ ...common, event: event('message-1', 'Olá') });
    await queue.enqueue({ ...common, event: event('message-2', 'quero saber o preço') });

    const oldResult = await state.processor!({ data: state.jobs[0]!.data });
    const latestResult = await state.processor!({ data: state.jobs[1]!.data });

    expect(oldResult.status).toBe('superseded');
    expect(latestResult.status).toBe('executed');
    expect(handled).toEqual([['Olá', 'quero saber o preço']]);
    await queue.close();
  });

  it('keeps the batch when a message arrives while the current turn is executing', async () => {
    const batches: string[][] = [];
    let queue: ConversationTurnQueue;
    queue = new ConversationTurnQueue('redis://localhost:6379/0', async turn => {
      batches.push(turn.events.map(item => item.textContent));
      if (batches.length === 1) {
        await queue.enqueue({
          kind: 'standalone',
          target: 'instance-1',
          conversationKey: 'org-1:conversation-1',
          windowSeconds: 8,
          event: event('message-2', 'e também quero os horários'),
        });
        expect(await turn.isCurrent()).toBe(false);
        return { status: 'superseded' };
      }
      return { status: 'executed' };
    }, dependencies());

    await queue.enqueue({
      kind: 'standalone',
      target: 'instance-1',
      conversationKey: 'org-1:conversation-1',
      windowSeconds: 8,
      event: event('message-1', 'quero saber o preço'),
    });
    const firstResult = await state.processor!({ data: state.jobs[0]!.data });
    const secondResult = await state.processor!({ data: state.jobs[1]!.data });

    expect(firstResult.status).toBe('superseded');
    expect(secondResult.status).toBe('executed');
    expect(batches).toEqual([
      ['quero saber o preço'],
      ['quero saber o preço', 'e também quero os horários'],
    ]);
    await queue.close();
  });
});
