import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { conversationTurnJobV1Schema, type ConversationTurnJobV1 } from '@sdr/shared';

// Debounce + distributed-lock buffer shared by the turn producer (apps/api) and the turn
// consumer (apps/worker), per docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 8.3-8.4.
// Redis carries only ids and a short-lived buffer; the authoritative payload for each event
// lives in public.inbound_events and is re-read by the handler at process time.

const BUFFER_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 60 * 1000;
export const SUPERSEDED_TURN_ERROR = 'conversation_turn_superseded';

export interface EnqueueTurnInput {
  kind: 'published';
  organizationId: string;
  connectionId: string;
  conversationKey: string;
  conversationId?: string;
  flowId?: string;
  flowVersionId?: string;
  windowSeconds: number;
  /** The inbound_events.id that (re)triggers or extends this turn's debounce window. */
  inboundEventId: string;
}

export interface BufferedTurn {
  job: ConversationTurnJobV1;
  /** Every inbound_events id accumulated in this conversation's buffer up to this generation, in arrival order. */
  inboundEventIds: string[];
  /** True while this job is still the newest generation and still holds the conversation lock. */
  isCurrent(): Promise<boolean>;
}

export interface TurnResult {
  status: string;
  [key: string]: unknown;
}

type TurnHandler = (turn: BufferedTurn) => Promise<TurnResult>;

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
  add(name: string, data: ConversationTurnJobV1, options: Record<string, unknown>): Promise<unknown>;
  getJobCounts?(...types: string[]): Promise<Record<string, number>>;
  close(): Promise<void>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

interface WorkerCommands {
  close(): Promise<void>;
  on?(event: 'error' | 'ready', listener: (error?: Error) => void): unknown;
}

export interface RedisTurnBufferDependencies {
  redis?: RedisCommands;
  queue?: QueueCommands;
  createWorker?: (processor: (job: { data: ConversationTurnJobV1; id?: string }) => Promise<TurnResult>) => WorkerCommands;
  /** Overridable for tests: avoids waiting out the real renewal interval. */
  lockRenewIntervalMs?: number;
  lockTtlMs?: number;
  concurrency?: number;
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
    events: `${prefix}:events`,
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

/**
 * Debounces messages per conversation on a BullMQ queue and hands the accumulated batch to
 * `handler` exactly once per logical turn, holding a renewed distributed lock for the
 * duration. Only the newest generation's job ever calls the handler — older generations are
 * short-circuited as 'superseded' before any external effect runs (queue.process below).
 */
export class RedisTurnBuffer {
  private readonly queue: QueueCommands;
  private readonly worker?: WorkerCommands;
  private readonly redis: RedisCommands;
  private readonly lockTtlMs: number;
  private readonly lockRenewIntervalMs: number;

  constructor(
    redisUrl: string,
    private readonly queueName: string,
    handler?: TurnHandler,
    dependencies: RedisTurnBufferDependencies = {},
  ) {
    const connection = connectionOptions(redisUrl);
    this.redis = dependencies.redis || new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = dependencies.queue || new Queue(queueName, { connection });
    this.lockTtlMs = dependencies.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.lockRenewIntervalMs = dependencies.lockRenewIntervalMs ?? DEFAULT_LOCK_RENEW_INTERVAL_MS;
    if (handler) {
      this.worker = dependencies.createWorker
        ? dependencies.createWorker(job => this.process(job, handler))
        : new Worker(
            queueName,
            job => this.process(job as Job<ConversationTurnJobV1>, handler),
            { connection, concurrency: dependencies.concurrency ?? (Number(process.env.TURN_WORKER_CONCURRENCY) || 5) },
          );
    }
    this.queue.on?.('error', error => console.error(`[RedisTurnBuffer:${queueName}] Redis/queue error:`, error));
    this.worker?.on?.('error', error => console.error(`[RedisTurnBuffer:${queueName}] Worker error:`, error));
  }

  async enqueue(input: EnqueueTurnInput): Promise<{ generation: number; delayMs: number }> {
    const keys = redisKeys(input.conversationKey);
    const generation = Number(await this.redis.eval(
      `local generation = redis.call('INCR', KEYS[1])
       redis.call('ZADD', KEYS[2], generation, ARGV[1])
       redis.call('EXPIRE', KEYS[1], ARGV[2])
       redis.call('EXPIRE', KEYS[2], ARGV[2])
       return generation`,
      2,
      keys.generation,
      keys.events,
      input.inboundEventId,
      String(BUFFER_TTL_SECONDS),
    ));
    const delayMs = Math.max(0, Math.round(input.windowSeconds * 1000));

    const job: ConversationTurnJobV1 = {
      schemaVersion: 1,
      kind: input.kind,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      conversationKey: input.conversationKey,
      conversationId: input.conversationId,
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      generation,
      inboundEventIds: [input.inboundEventId],
      correlationId: randomUUID(),
    };
    conversationTurnJobV1Schema.parse(job);

    await this.queue.add(
      'conversation-turn',
      job,
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

  /** Waiting/delayed/active/failed counts for the canonical queue, for alerting (8.7). */
  async counts(): Promise<{ waiting: number; delayed: number; active: number; failed: number }> {
    const counts = (await this.queue.getJobCounts?.('waiting', 'delayed', 'active', 'failed')) || {};
    return {
      waiting: counts.waiting || 0,
      delayed: counts.delayed || 0,
      active: counts.active || 0,
      failed: counts.failed || 0,
    };
  }

  private async process(job: { data: ConversationTurnJobV1; id?: string }, handler: TurnHandler): Promise<TurnResult> {
    const input = conversationTurnJobV1Schema.parse(job.data);
    const keys = redisKeys(input.conversationKey);
    const currentGeneration = Number(await this.redis.get(keys.generation) || 0);
    if (currentGeneration !== input.generation) {
      return { status: 'superseded', generation: input.generation, currentGeneration };
    }

    const lockToken = randomUUID();
    const acquired = await this.redis.set(keys.lock, lockToken, 'PX', this.lockTtlMs, 'NX');
    if (acquired !== 'OK') throw new Error('conversation_turn_locked');

    const renewLock = async (): Promise<boolean> => {
      const renewed = await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`,
        1,
        keys.lock,
        lockToken,
        this.lockTtlMs,
      );
      return renewed === 1;
    };
    let lockHeld = true;
    const renewalTimer = setInterval(() => {
      void renewLock().then(ok => { lockHeld = ok; });
    }, this.lockRenewIntervalMs);
    // Node/BullMQ workers stay alive on their own; never let this timer keep the process up.
    (renewalTimer as unknown as { unref?: () => void }).unref?.();

    try {
      const generationAfterLock = Number(await this.redis.get(keys.generation) || 0);
      if (generationAfterLock !== input.generation) {
        return { status: 'superseded', generation: input.generation, currentGeneration: generationAfterLock };
      }

      const inboundEventIds = await this.redis.zrangebyscore(keys.events, '-inf', input.generation);
      if (inboundEventIds.length === 0) return { status: 'empty', generation: input.generation };

      const isCurrent = async () => {
        if (!lockHeld) return false;
        const [generationNow, lockNow] = await Promise.all([
          this.redis.get(keys.generation),
          this.redis.get(keys.lock),
        ]);
        return Number(generationNow || 0) === input.generation && lockNow === lockToken;
      };

      const result = await handler({ job: input, inboundEventIds, isCurrent });

      if (result.status === 'error') throw new Error(String(result.error || 'conversation_turn_failed'));
      if (result.status === 'superseded') return result;

      await this.redis.zremrangebyscore(keys.events, '-inf', input.generation);
      return result;
    } finally {
      clearInterval(renewalTimer);
      await this.redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
        1,
        keys.lock,
        lockToken,
      );
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue.close(), this.redis.quit()]);
  }
}
