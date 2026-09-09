import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { queueNames } from '@sdr/shared';
import type { InboundMessageEvent } from './webhook.js';

const BUFFER_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_MS = 5 * 60 * 1000;
export const SUPERSEDED_TURN_ERROR = 'conversation_turn_superseded';

export interface ConversationTurnInput {
  kind: 'published' | 'standalone';
  target: string;
  conversationKey: string;
  windowSeconds: number;
  event: InboundMessageEvent;
  metadata?: Record<string, unknown>;
}

export interface BufferedConversationTurn {
  kind: ConversationTurnInput['kind'];
  target: string;
  conversationKey: string;
  generation: number;
  events: InboundMessageEvent[];
  metadata?: Record<string, unknown>;
  isCurrent(): Promise<boolean>;
}

export interface ConversationTurnResult {
  status: string;
  [key: string]: unknown;
}

type TurnHandler = (turn: BufferedConversationTurn) => Promise<ConversationTurnResult>;

interface RedisCommands {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<string | null>;
  zrangebyscore(key: string, min: string, max: number): Promise<string[]>;
  zremrangebyscore(key: string, min: string, max: number): Promise<number>;
  quit(): Promise<unknown>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

interface QueueCommands {
  add(name: string, data: ConversationTurnInput & { generation: number }, options: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

interface WorkerCommands {
  close(): Promise<void>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface ConversationTurnQueueDependencies {
  redis?: RedisCommands;
  queue?: QueueCommands;
  createWorker?: (
    processor: (job: { data: ConversationTurnInput & { generation: number } }) => Promise<ConversationTurnResult>,
  ) => WorkerCommands;
}

function connectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

function redisKeys(conversationKey: string) {
  const digest = createHash('sha256').update(conversationKey).digest('hex');
  const prefix = `sdr:turn:${digest}`;
  return {
    digest,
    generation: `${prefix}:generation`,
    messages: `${prefix}:messages`,
    lock: `${prefix}:lock`,
  };
}

export function bufferWindowSeconds(graph: { nodes?: Array<{ type?: string; config?: Record<string, unknown> }> }): number {
  const node = graph.nodes?.find(candidate => candidate.type === 'input.buffer');
  if (!node) return 0;
  const configured = Number(node.config?.windowSeconds);
  if (!Number.isFinite(configured)) return 5;
  return Math.min(120, Math.max(5, Math.round(configured)));
}

export class ConversationTurnQueue {
  private readonly queue: QueueCommands;
  private readonly worker: WorkerCommands;
  private readonly redis: RedisCommands;

  constructor(redisUrl: string, private readonly handler: TurnHandler, dependencies: ConversationTurnQueueDependencies = {}) {
    const connection = connectionOptions(redisUrl);
    this.redis = dependencies.redis || new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = dependencies.queue || new Queue(queueNames.inboundDebounce, { connection });
    this.worker = dependencies.createWorker
      ? dependencies.createWorker(job => this.process(job))
      : new Worker(
          queueNames.inboundDebounce,
          job => this.process(job as Job<ConversationTurnInput & { generation: number }>),
          { connection, concurrency: 10 },
        );
    this.queue.on?.('error', error => console.error('[ConversationTurnQueue] Redis/queue error:', error));
    this.worker.on?.('error', error => console.error('[ConversationTurnQueue] Worker error:', error));
  }

  async enqueue(input: ConversationTurnInput): Promise<{ generation: number; delayMs: number }> {
    const keys = redisKeys(input.conversationKey);
    const member = JSON.stringify({ nonce: randomUUID(), event: input.event });
    const generation = Number(await this.redis.eval(
      `local generation = redis.call('INCR', KEYS[1])
       redis.call('ZADD', KEYS[2], generation, ARGV[1])
       redis.call('EXPIRE', KEYS[1], ARGV[2])
       redis.call('EXPIRE', KEYS[2], ARGV[2])
       return generation`,
      2,
      keys.generation,
      keys.messages,
      member,
      String(BUFFER_TTL_SECONDS),
    ));
    const delayMs = Math.max(0, Math.round(input.windowSeconds * 1000));

    await this.queue.add(
      'conversation-turn',
      { ...input, generation },
      {
        jobId: `${keys.digest}-${generation}`,
        delay: delayMs,
        attempts: 12,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 2000 },
      },
    );

    return { generation, delayMs };
  }

  private async process(job: { data: ConversationTurnInput & { generation: number } }): Promise<ConversationTurnResult> {
    const input = job.data;
    const keys = redisKeys(input.conversationKey);
    const currentGeneration = Number(await this.redis.get(keys.generation) || 0);
    if (currentGeneration !== input.generation) {
      return { status: 'superseded', generation: input.generation, currentGeneration };
    }

    const lockToken = randomUUID();
    const acquired = await this.redis.set(keys.lock, lockToken, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') throw new Error('conversation_turn_locked');

    try {
      const generationAfterLock = Number(await this.redis.get(keys.generation) || 0);
      if (generationAfterLock !== input.generation) {
        return { status: 'superseded', generation: input.generation, currentGeneration: generationAfterLock };
      }

      const rawItems = await this.redis.zrangebyscore(keys.messages, '-inf', input.generation);
      const events = rawItems.flatMap(raw => {
        try {
          const parsed = JSON.parse(raw) as { event?: InboundMessageEvent };
          return parsed.event ? [parsed.event] : [];
        } catch {
          return [];
        }
      });
      if (events.length === 0) return { status: 'empty', generation: input.generation };

      const isCurrent = async () => Number(await this.redis.get(keys.generation) || 0) === input.generation;
      const result = await this.handler({
        kind: input.kind,
        target: input.target,
        conversationKey: input.conversationKey,
        generation: input.generation,
        events,
        metadata: input.metadata,
        isCurrent,
      });

      if (result.status === 'error') throw new Error(String(result.error || 'conversation_turn_failed'));
      if (result.status === 'superseded') return result;

      await this.redis.zremrangebyscore(keys.messages, '-inf', input.generation);
      return result;
    } finally {
      await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
        1,
        keys.lock,
        lockToken,
      );
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.worker.close(), this.queue.close(), this.redis.quit()]);
  }
}
