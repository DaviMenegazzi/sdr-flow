import IORedis from 'ioredis';

// Narrow seam over ioredis's raw XADD/XREADGROUP/XAUTOCLAIM/XACK calls, so TraceBatchWriter's
// loop logic (claim stale -> read batch -> write -> ack) can be tested with a plain in-memory
// fake instead of a real Redis instance.

export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

export interface StreamConsumerCommands {
  ensureGroup(streamKey: string, group: string): Promise<void>;
  /** Blocks up to blockMs waiting for new entries; returns [] on timeout. */
  readGroup(streamKey: string, group: string, consumer: string, count: number, blockMs: number): Promise<StreamEntry[]>;
  /** Reclaims entries idle longer than minIdleMs from dead/slow consumers (crash recovery — 9.4.5). */
  claimStale(streamKey: string, group: string, consumer: string, minIdleMs: number, count: number): Promise<StreamEntry[]>;
  ack(streamKey: string, group: string, ids: string[]): Promise<void>;
}

export class IORedisStreamCommands implements StreamConsumerCommands {
  constructor(private readonly redis: IORedis) {}

  async ensureGroup(streamKey: string, group: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', streamKey, group, '$', 'MKSTREAM');
    } catch (err: any) {
      if (!String(err?.message || '').includes('BUSYGROUP')) throw err;
    }
  }

  async readGroup(streamKey: string, group: string, consumer: string, count: number, blockMs: number): Promise<StreamEntry[]> {
    const reply = await this.redis.xreadgroup('GROUP', group, consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', streamKey, '>') as
      | [string, [string, string[]][]][]
      | null;
    if (!reply || reply.length === 0) return [];
    const [, entries] = reply[0]!;
    return entries.map(([id, flat]) => ({ id, fields: flatToFields(flat) }));
  }

  async claimStale(streamKey: string, group: string, consumer: string, minIdleMs: number, count: number): Promise<StreamEntry[]> {
    const reply = await this.redis.xautoclaim(streamKey, group, consumer, minIdleMs, '0-0', 'COUNT', count) as
      [string, [string, string[]][], string[]];
    const [, entries] = reply;
    return entries.map(([id, flat]) => ({ id, fields: flatToFields(flat) }));
  }

  async ack(streamKey: string, group: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.redis.xack(streamKey, group, ...ids);
  }
}

function flatToFields(flat: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) fields[flat[i]!] = flat[i + 1]!;
  return fields;
}
