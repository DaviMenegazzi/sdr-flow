import { markInboundEventStatus, type ServiceDb } from '../inbound/inbound-event-repository.js';
import { resolveAndEnqueueTurn, type TurnProducerDeps } from './turn-producer.js';

// Sweeps public.inbound_events for events accepted durably but never (successfully) enqueued —
// the case a Redis outage after accept_inbound_event leaves behind
// (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.3.6, 13.3 "webhook aceito durante falha Redis").
// Idempotent: re-enqueuing an event whose turn already ran just produces a fresh, superseded-or-
// harmless generation (BullMQ's deterministic jobId and the turn buffer's generation counter
// absorb the duplicate), so running this on a schedule with overlap is safe.

const MAX_ATTEMPTS_BEFORE_GIVING_UP = 5;
const BATCH_SIZE = 100;

export interface DispatchOutboxResult {
  scanned: number;
  requeued: number;
  gaveUp: number;
  resolutionFailed: number;
}

export async function dispatchPendingInboundEvents(deps: TurnProducerDeps): Promise<DispatchOutboxResult> {
  const db: ServiceDb = deps.db;
  const { data, error } = await db
    .from('inbound_events')
    .select('id, connection_id, organization_id, provider_message_id, normalized_payload, attempt_count, status')
    .in('status', ['received', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  const result: DispatchOutboxResult = { scanned: data?.length || 0, requeued: 0, gaveUp: 0, resolutionFailed: 0 };
  for (const row of data || []) {
    if (row.attempt_count >= MAX_ATTEMPTS_BEFORE_GIVING_UP) {
      result.gaveUp++;
      continue;
    }
    const payload = row.normalized_payload as { phone?: string } | null;
    if (!payload?.phone) {
      await markInboundEventStatus(db, row.organization_id, row.id, 'failed', 'missing_phone_in_payload');
      result.resolutionFailed++;
      continue;
    }
    const resolved = await resolveAndEnqueueTurn(deps, { connectionId: row.connection_id, eventId: row.id, phone: payload.phone });
    if (resolved.status === 'queued') {
      await markInboundEventStatus(db, resolved.organizationId, row.id, 'processing');
      result.requeued++;
    } else {
      await markInboundEventStatus(db, row.organization_id, row.id, 'failed', resolved.status);
      result.resolutionFailed++;
    }
  }
  return result;
}
