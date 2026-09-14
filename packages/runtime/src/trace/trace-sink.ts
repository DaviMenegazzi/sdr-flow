import IORedis from 'ioredis';
import { ExecutionRepository } from '@sdr/db';
import { traceEventV1Schema, type TraceEventV1 } from '@sdr/shared';
import type { ServiceDb } from '../inbound/inbound-event-repository.js';

// Redis Stream producer for execution trace steps (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md
// 9.2). executeFlow's onStepComplete hook calls append() instead of inserting into Postgres
// directly — the stream is durable transport, Postgres (written by TraceBatchWriter) remains
// the authoritative destination. Truncates oversized node payloads before they ever reach
// Redis or Postgres (9.4.8) instead of letting one huge node blow up either.

export const TRACE_STREAM_KEY = 'sdr:execution-traces:v1';
const MAX_PAYLOAD_CHARS = 8000;

function sanitizePayload(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? null) ?? 'null';
  } catch {
    json = JSON.stringify({ unserializable: true });
  }
  if (json.length <= MAX_PAYLOAD_CHARS) return json;
  return JSON.stringify({ truncated: true, originalLength: json.length, preview: json.slice(0, MAX_PAYLOAD_CHARS) });
}

export interface TraceStepInput {
  organizationId: string;
  executionId: string;
  nodeId: string;
  sequence: number;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface TraceSink {
  append(step: TraceStepInput): Promise<void>;
  close(): Promise<void>;
}

export class RedisTraceSink implements TraceSink {
  private readonly redis: IORedis;
  private readonly ownsConnection: boolean;

  constructor(redisUrlOrClient: string | IORedis) {
    if (typeof redisUrlOrClient === 'string') {
      this.redis = new IORedis(redisUrlOrClient, { maxRetriesPerRequest: null });
      this.ownsConnection = true;
    } else {
      this.redis = redisUrlOrClient;
      this.ownsConnection = false;
    }
  }

  async append(step: TraceStepInput): Promise<void> {
    const event: TraceEventV1 = traceEventV1Schema.parse({
      schemaVersion: 1,
      organizationId: step.organizationId,
      executionId: step.executionId,
      nodeId: step.nodeId,
      sequence: step.sequence,
      durationMs: Math.max(0, Math.round(step.durationMs)),
      occurredAt: new Date().toISOString(),
    });
    await this.redis.xadd(
      TRACE_STREAM_KEY,
      '*',
      'organizationId', event.organizationId,
      'executionId', event.executionId,
      'nodeId', event.nodeId,
      'sequence', String(event.sequence),
      'durationMs', String(event.durationMs),
      'occurredAt', event.occurredAt,
      'input', sanitizePayload(step.input),
      'output', sanitizePayload(step.output),
      'error', step.error ?? '',
    );
  }

  async close(): Promise<void> {
    if (this.ownsConnection) await this.redis.quit();
  }
}

/** Explicit in-memory test double — writes nothing durable. Never used outside tests. */
export class InMemoryTraceSink implements TraceSink {
  readonly appended: TraceStepInput[] = [];
  async append(step: TraceStepInput): Promise<void> {
    this.appended.push(step);
  }
  async close(): Promise<void> {}
}

/**
 * Dev-without-Redis fallback: writes each step straight to Postgres, one insert per node —
 * the pre-Phase-3 behavior, intentionally preserved only for TURN_PROCESSING_MODE=api (no
 * separate worker, no Redis at all). Never used when a real queue/worker is configured.
 */
export class DirectPostgresTraceSink implements TraceSink {
  private readonly execRepo: ExecutionRepository;
  constructor(db: ServiceDb) {
    this.execRepo = new ExecutionRepository(db);
  }
  async append(step: TraceStepInput): Promise<void> {
    await this.execRepo.recordStep({
      organizationId: step.organizationId,
      executionId: step.executionId,
      nodeId: step.nodeId,
      sequence: step.sequence,
      input: step.input,
      output: step.output,
      durationMs: step.durationMs,
      error: step.error,
    });
  }
  async close(): Promise<void> {}
}
