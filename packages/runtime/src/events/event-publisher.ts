import IORedis from 'ioredis';
import type { FlowExecutionEvent, RealtimeEventV1 } from '@sdr/shared';

// Bridges execution events from the worker process (where flows now run) back to the API
// process (where the authenticated WebSocket server lives), per
// docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 8.6. The channel is best-effort transport:
// losing it must never turn a successful execution into a false failure (8.6), it only delays
// or drops the live view — Postgres remains the source of truth for recovery.
//
// Fase 5 (11.1) widens this same bus to also carry the versioned inbox:* realtime events —
// one transport, two payload shapes, discriminated downstream (apps/api/src/ws.ts) by the
// presence of `schemaVersion` (only RealtimeEventV1 has it).

const CHANNEL = 'sdr:execution-events:v1';

export type RealtimeEvent = FlowExecutionEvent | RealtimeEventV1;

export interface ExecutionEventPublisher {
  publish(event: RealtimeEvent): Promise<void>;
  close(): Promise<void>;
}

export interface ExecutionEventSubscriber {
  subscribe(onEvent: (event: RealtimeEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export class RedisExecutionEventPublisher implements ExecutionEventPublisher {
  private readonly redis: IORedis;

  constructor(redisUrl: string) {
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.redis.on('error', error => console.error('[RedisExecutionEventPublisher] Redis error:', error));
  }

  async publish(event: RealtimeEvent): Promise<void> {
    try {
      await this.redis.publish(CHANNEL, JSON.stringify(event));
    } catch (error) {
      // Best-effort: the execution already succeeded or failed on its own merits by the time
      // this is called: a lost live-update channel must not be reported as a failed turn.
      console.warn('[RedisExecutionEventPublisher] Falha ao publicar evento de execução (não bloqueante):', error);
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export class RedisExecutionEventSubscriber implements ExecutionEventSubscriber {
  private readonly redis: IORedis;

  constructor(redisUrl: string) {
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.redis.on('error', error => console.error('[RedisExecutionEventSubscriber] Redis error:', error));
  }

  async subscribe(onEvent: (event: RealtimeEvent) => void): Promise<void> {
    await this.redis.subscribe(CHANNEL);
    this.redis.on('message', (channel, message) => {
      if (channel !== CHANNEL) return;
      try {
        onEvent(JSON.parse(message) as RealtimeEvent);
      } catch (error) {
        console.warn('[RedisExecutionEventSubscriber] Evento de execução malformado ignorado:', error);
      }
    });
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** Explicit in-memory test double — never used as a silent production fallback. */
export class InMemoryExecutionEventBus implements ExecutionEventPublisher, ExecutionEventSubscriber {
  private listeners: Array<(event: RealtimeEvent) => void> = [];

  async publish(event: RealtimeEvent): Promise<void> {
    for (const listener of this.listeners) listener(event);
  }

  async subscribe(onEvent: (event: RealtimeEvent) => void): Promise<void> {
    this.listeners.push(onEvent);
  }

  async close(): Promise<void> {
    this.listeners = [];
  }
}
