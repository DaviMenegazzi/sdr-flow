import { randomUUID } from 'node:crypto';
import { realtimeEventV1Schema, type RealtimeEventTypeV1 } from '@sdr/shared';
import type { ExecutionEventPublisher } from './event-publisher.js';

// Single construction point for the versioned inbox:* / system:* events (Fase 5, 11.1), used by
// both apps/api's inbox routes (human takeover/release/stage/message) and
// packages/runtime/src/turns/turn-processor.ts (lead messages, flow-driven messages and stage
// changes). Validated against realtimeEventV1Schema before publish so a caller mistake fails
// loudly here instead of shipping a malformed frame to every subscribed browser.

export interface PublishRealtimeEventInput {
  type: RealtimeEventTypeV1;
  organizationId: string;
  connectionId?: string;
  conversationId?: string;
  payload?: unknown;
}

export async function publishRealtimeEvent(
  publisher: ExecutionEventPublisher,
  input: PublishRealtimeEventInput
): Promise<void> {
  const event = realtimeEventV1Schema.parse({
    schemaVersion: 1,
    type: input.type,
    eventId: randomUUID(),
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    conversationId: input.conversationId,
    occurredAt: new Date().toISOString(),
    payload: input.payload,
  });
  await publisher.publish(event);
}
