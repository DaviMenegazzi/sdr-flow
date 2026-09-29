import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker, DelayedError, type Job } from 'bullmq';
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

// Cross-org fairness (8.x follow-up: the single global TURN_WORKER_CONCURRENCY pool has no
// per-organization guarantee, so one client's burst can starve every other client's queue).
// A sliding window of recent enqueues per organization, converted into BullMQ job priority:
// an org that has enqueued many turns in the last ORG_FAIRNESS_WINDOW_MS gets a higher
// (lower-precedence) priority number, so an idle org's turns jump the queue ahead of a busy
// org's backlog once both are ready to run. No per-job decrement bookkeeping is needed —
// entries simply age out of the window, so this can't leak or drift on a worker crash or a
// BullMQ retry, unlike a naive increment-at-enqueue/decrement-at-completion counter would.
const ORG_FAIRNESS_WINDOW_MS = 60_000;
const MAX_JOB_PRIORITY = 2_097_151;

// Per-agent concurrency (ai_agents.max_concurrent_replies): a Redis sorted set of slot tokens
// scored by expiry. A turn takes a slot before running the flow and gives it back afterwards;
// a crashed worker's slot simply expires with the conversation lock TTL. A turn that finds
// every slot busy is pushed back into the delayed set without spending a retry attempt, so
// the message waits its turn instead of being dropped.
const AGENT_BUSY_BASE_DELAY_MS = 2_000;
const AGENT_BUSY_JITTER_MS = 3_000;
export const AGENT_CONCURRENCY_ERROR = 'agent_concurrency_limit';

function agentSlotsKey(agentId: string): string {
  return `sdr:agent:slots:${agentId}`;
}

export interface EnqueueTurnInput {
  kind: 'published';
  organizationId: string;
  connectionId: string;
  conversationKey: string;
  conversationId?: string;
  agentId?: string;
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
  createWorker?: (processor: (job: DelayableJob, token?: string) => Promise<TurnResult>) => WorkerCommands;
  /** max_concurrent_replies of the agent; null/undefined = no per-agent limit. */
  agentConcurrencyLimit?: (agentId: string) => Promise<number | null | undefined>;
  /** Overridable for tests: avoids waiting out the real renewal interval. */
  lockRenewIntervalMs?: number;
  lockTtlMs?: number;
  concurrency?: number;
}

type DelayableJob = { data: ConversationTurnJobV1; id?: string; moveToDelayed?: (timestamp: number, token?: string) => Promise<void> };

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

function orgLoadKey(organizationId: string): string {
  return `sdr:turn:org-load:${organizationId}`;
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
  private readonly agentConcurrencyLimit?: (agentId: string) => Promise<number | null | undefined>;

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
    this.agentConcurrencyLimit = dependencies.agentConcurrencyLimit;
    if (handler) {
      this.worker = dependencies.createWorker
        ? dependencies.createWorker((job, token) => this.process(job, handler, token))
        : new Worker(
            queueName,
            (job, token) => this.process(job as Job<ConversationTurnJobV1>, handler, token),
            { connection, concurrency: dependencies.concurrency ?? (Number(process.env.TURN_WORKER_CONCURRENCY) || 5) },
          );
    }
    this.queue.on?.('error', error => console.error(`[RedisTurnBuffer:${queueName}] Redis/queue error:`, error));
    this.worker?.on?.('error', error => console.error(`[RedisTurnBuffer:${queueName}] Worker error:`, error));
  }

  /**
   * Recent-load-based BullMQ priority for this organization (see ORG_FAIRNESS_WINDOW_MS
   * above). Counts this call's own entry, so an org with nothing else in the last window
   * gets priority 0 — BullMQ's "no explicit priority" fast lane, processed before any
   * explicitly prioritized job.
   */
  private async orgPriority(organizationId: string): Promise<number> {
    const now = Date.now();
    const count = Number(await this.redis.eval(
      `redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
       redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
       redis.call('EXPIRE', KEYS[1], ARGV[4])
       return redis.call('ZCARD', KEYS[1])`,
      1,
      orgLoadKey(organizationId),
      now,
      randomUUID(),
      now - ORG_FAIRNESS_WINDOW_MS,
      String(Math.ceil(ORG_FAIRNESS_WINDOW_MS / 1000)),
    ));
    return Math.max(0, Math.min(MAX_JOB_PRIORITY, count - 1));
  }

  async enqueue(input: EnqueueTurnInput): Promise<{ generation: number; delayMs: number }> {
    const keys = redisKeys(input.conversationKey);
    const [generation, priority] = await Promise.all([
      this.redis.eval(
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
      ).then(Number),
      this.orgPriority(input.organizationId),
    ]);
    const delayMs = Math.max(0, Math.round(input.windowSeconds * 1000));

    const job: ConversationTurnJobV1 = {
      schemaVersion: 1,
      kind: input.kind,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      conversationKey: input.conversationKey,
      conversationId: input.conversationId,
      agentId: input.agentId,
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
        priority,
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

  /** Takes one of the agent's slots; false when all max_concurrent_replies are in use. */
  private async acquireAgentSlot(agentId: string, limit: number, token: string): Promise<boolean> {
    const now = Date.now();
    const acquired = await this.redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
       if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
       redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
       redis.call('PEXPIRE', KEYS[1], ARGV[5])
       return 1`,
      1,
      agentSlotsKey(agentId),
      now,
      limit,
      now + this.lockTtlMs,
      token,
      this.lockTtlMs,
    );
    return Number(acquired) === 1;
  }

  private async renewAgentSlot(agentId: string, token: string): Promise<void> {
    await this.redis.eval(
      `if redis.call('ZSCORE', KEYS[1], ARGV[1]) then redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1]) redis.call('PEXPIRE', KEYS[1], ARGV[3]) end return 1`,
      1,
      agentSlotsKey(agentId),
      token,
      Date.now() + this.lockTtlMs,
      this.lockTtlMs,
    );
  }

  private async releaseAgentSlot(agentId: string, token: string): Promise<void> {
    await this.redis.eval(`return redis.call('ZREM', KEYS[1], ARGV[1])`, 1, agentSlotsKey(agentId), token);
  }

  private async process(job: DelayableJob, handler: TurnHandler, workerToken?: string): Promise<TurnResult> {
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
    let agentSlotToken: string | null = null;
    const renewalTimer = setInterval(() => {
      void renewLock().then(ok => { lockHeld = ok; });
      if (agentSlotToken && input.agentId) void this.renewAgentSlot(input.agentId, agentSlotToken);
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

      const agentId = input.agentId;
      const agentLimit = agentId && this.agentConcurrencyLimit ? await this.agentConcurrencyLimit(agentId) : null;
      if (agentId && agentLimit && agentLimit > 0) {
        if (!(await this.acquireAgentSlot(agentId, agentLimit, lockToken))) {
          const retryAt = Date.now() + AGENT_BUSY_BASE_DELAY_MS + Math.floor(Math.random() * AGENT_BUSY_JITTER_MS);
          if (job.moveToDelayed && workerToken) {
            await job.moveToDelayed(retryAt, workerToken);
            throw new DelayedError();
          }
          throw new Error(AGENT_CONCURRENCY_ERROR);
        }
        agentSlotToken = lockToken;
      }

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
      if (agentSlotToken && input.agentId) await this.releaseAgentSlot(input.agentId, agentSlotToken);
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
