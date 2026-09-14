import { randomUUID } from 'node:crypto';
import type { ServiceDb } from '../inbound/inbound-event-repository.js';
import { TRACE_STREAM_KEY } from './trace-sink.js';
import type { StreamConsumerCommands, StreamEntry } from './stream-commands.js';

// Consumer-group batch writer for the execution trace stream
// (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 9.2.5-9). Accumulates steps by count or a short
// window, writes them to flow_execution_steps in one request, and only XACKs entries that were
// actually persisted (9.2.8) — a failed Supabase write leaves entries pending for the next
// pass or a stale-claim recovery after a crash (9.2.9), never silently dropped.

export const DEFAULT_CONSUMER_GROUP = 'trace-writers';
const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_BLOCK_MS = 2000;
const DEFAULT_CLAIM_IDLE_MS = 60_000;
const DEFAULT_IDLE_LOOP_DELAY_MS = 250;

export interface TraceBatchWriterOptions {
  db: ServiceDb;
  streamCommands: StreamConsumerCommands;
  streamKey?: string;
  consumerGroup?: string;
  consumerName?: string;
  batchSize?: number;
  blockMs?: number;
  claimIdleMs?: number;
  onBatchWritten?: (rows: Array<{ executionId: string; sequence: number }>) => void;
  onError?: (error: unknown) => void;
}

interface ParsedEntry {
  streamId: string;
  organizationId: string;
  executionId: string;
  nodeId: string;
  sequence: number;
  durationMs: number;
  input: unknown;
  output: unknown;
  error: string | null;
}

function parseEntry(entry: StreamEntry): ParsedEntry | null {
  const f = entry.fields;
  if (!f.organizationId || !f.executionId || !f.nodeId || f.sequence === undefined) return null;
  const parseJson = (raw: string | undefined) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };
  return {
    streamId: entry.id,
    organizationId: f.organizationId,
    executionId: f.executionId,
    nodeId: f.nodeId,
    sequence: Number(f.sequence),
    durationMs: Number(f.durationMs || 0),
    input: parseJson(f.input),
    output: parseJson(f.output),
    error: f.error || null,
  };
}

export class TraceBatchWriter {
  private readonly db: ServiceDb;
  private readonly streamCommands: StreamConsumerCommands;
  private readonly streamKey: string;
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private readonly batchSize: number;
  private readonly blockMs: number;
  private readonly claimIdleMs: number;
  private readonly onBatchWritten?: (rows: Array<{ executionId: string; sequence: number }>) => void;
  private readonly onError?: (error: unknown) => void;
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(options: TraceBatchWriterOptions) {
    this.db = options.db;
    this.streamCommands = options.streamCommands;
    this.streamKey = options.streamKey ?? TRACE_STREAM_KEY;
    this.consumerGroup = options.consumerGroup ?? DEFAULT_CONSUMER_GROUP;
    this.consumerName = options.consumerName ?? `writer-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS;
    this.claimIdleMs = options.claimIdleMs ?? DEFAULT_CLAIM_IDLE_MS;
    this.onBatchWritten = options.onBatchWritten;
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    await this.streamCommands.ensureGroup(this.streamKey, this.consumerGroup);
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  /** One iteration, exposed directly for tests — claim stale entries, read a batch, write it. */
  async runOnce(): Promise<number> {
    const stale = await this.streamCommands.claimStale(this.streamKey, this.consumerGroup, this.consumerName, this.claimIdleMs, this.batchSize);
    const fresh = stale.length >= this.batchSize
      ? []
      : await this.streamCommands.readGroup(this.streamKey, this.consumerGroup, this.consumerName, this.batchSize - stale.length, this.blockMs);
    const entries = [...stale, ...fresh];
    if (entries.length === 0) return 0;
    await this.writeBatch(entries);
    return entries.length;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const count = await this.runOnce();
        if (count === 0) await new Promise(resolve => setTimeout(resolve, DEFAULT_IDLE_LOOP_DELAY_MS));
      } catch (err) {
        this.onError?.(err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async writeBatch(entries: StreamEntry[]): Promise<void> {
    const parsed = entries.map(parseEntry).filter((e): e is ParsedEntry => e !== null);
    if (parsed.length === 0) {
      // Malformed entries can never be parsed correctly by retrying — ack them so they don't
      // block the stream forever, but never let them silently look like a successful write.
      await this.streamCommands.ack(this.streamKey, this.consumerGroup, entries.map(e => e.id));
      return;
    }

    const rows = parsed.map(p => ({
      organization_id: p.organizationId,
      execution_id: p.executionId,
      node_id: p.nodeId,
      sequence: p.sequence,
      input: p.input,
      output: p.output,
      duration_ms: p.durationMs,
      error: p.error,
    }));

    const { error } = await this.db
      .from('flow_execution_steps')
      .upsert(rows as any, { onConflict: 'execution_id,sequence', ignoreDuplicates: true });

    if (error) {
      // Never ack on a failed write (9.2.8) — these entries stay pending and are either
      // re-delivered to this same consumer or reclaimed by claimStale after a crash.
      this.onError?.(error);
      return;
    }

    await this.streamCommands.ack(this.streamKey, this.consumerGroup, parsed.map(p => p.streamId));
    this.onBatchWritten?.(parsed.map(p => ({ executionId: p.executionId, sequence: p.sequence })));
  }
}
