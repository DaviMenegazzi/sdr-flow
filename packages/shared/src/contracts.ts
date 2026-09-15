import { z } from 'zod';

// Versioned job/event contracts shared between apps/api, apps/worker and apps/web, per
// docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 6.2.6. Every contract carries an explicit
// `schemaVersion` so a future breaking change can add a V2 without touching in-flight jobs
// deserialized with the old shape.

export const conversationTurnJobV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('published'),
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
  conversationKey: z.string().min(1),
  conversationId: z.uuid().optional(),
  flowId: z.string().optional(),
  flowVersionId: z.string().optional(),
  generation: z.number().int().nonnegative(),
  inboundEventIds: z.array(z.uuid()).default([]),
  correlationId: z.uuid(),
});
export type ConversationTurnJobV1 = z.infer<typeof conversationTurnJobV1Schema>;

export const traceEventV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  organizationId: z.uuid(),
  executionId: z.uuid(),
  nodeId: z.string().min(1),
  sequence: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().max(2000).optional(),
  occurredAt: z.string().datetime(),
});
export type TraceEventV1 = z.infer<typeof traceEventV1Schema>;

export const realtimeEventTypesV1 = [
  'inbox:conversation.created',
  'inbox:conversation.updated',
  'inbox:message.created',
  'inbox:message.updated',
  'execution:started',
  'step:start',
  'step:complete',
  'step:failed',
  'execution:completed',
  'system:resync_required',
] as const;
export const realtimeEventTypeV1Schema = z.enum(realtimeEventTypesV1);
export type RealtimeEventTypeV1 = z.infer<typeof realtimeEventTypeV1Schema>;

export const realtimeEventV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  type: realtimeEventTypeV1Schema,
  eventId: z.uuid(),
  organizationId: z.uuid(),
  connectionId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  occurredAt: z.string().datetime(),
  payload: z.unknown().optional(),
});
export type RealtimeEventV1 = z.infer<typeof realtimeEventV1Schema>;
