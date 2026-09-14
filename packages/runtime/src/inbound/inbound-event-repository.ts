import type { serviceDatabase } from '@sdr/db';

// Thin wrapper around the RPCs from supabase/migrations/202609141001_inbound_events.sql,
// shared by the turn producer (apps/api, calls accept) and the turn processor (apps/worker,
// calls markStatus and fetchByIds). Moved out of apps/api/src/webhook.ts so both processes use
// the exact same accept/read/mark logic instead of two copies drifting apart.

export type ServiceDb = ReturnType<typeof serviceDatabase>;

export interface NormalizedInboundPayload {
  remoteJid: string;
  phone: string;
  textContent: string;
  messageType: string;
  mediaUrl?: string | null;
  fromMe: boolean;
  senderName?: string | null;
}

export interface AcceptedInboundEvent {
  eventId: string;
  organizationId: string;
  isNew: boolean;
  status: string;
}

export interface StoredInboundEvent {
  id: string;
  createdAt: string;
  /** Null when the provider delivered no message id (see the migration's NULL-never-conflicts note). */
  providerMessageId: string | null;
  payload: NormalizedInboundPayload;
}

export async function acceptInboundEvent(
  db: ServiceDb,
  connectionId: string,
  provider: 'evolution' | 'meta',
  provider_message_id: string | null | undefined,
  conversationKey: string,
  payload: NormalizedInboundPayload,
): Promise<AcceptedInboundEvent> {
  const { data, error } = await db.rpc('accept_inbound_event', {
    p_connection_id: connectionId,
    p_provider: provider,
    p_provider_message_id: provider_message_id || null,
    p_conversation_key: conversationKey,
    p_normalized_payload: payload as any,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { event_id: string; organization_id: string; is_new: boolean; status: string };
  return { eventId: row.event_id, organizationId: row.organization_id, isNew: row.is_new, status: row.status };
}

/** Best-effort status transition — observability only, never blocks the caller's main flow. */
export async function markInboundEventStatus(
  db: ServiceDb,
  organizationId: string,
  eventId: string,
  status: 'processing' | 'processed' | 'failed',
  error?: string,
): Promise<void> {
  try {
    await db.rpc('mark_inbound_event_status', { p_organization_id: organizationId, p_event_id: eventId, p_status: status, p_error: error ?? null });
  } catch (err) {
    console.warn('[inbound-event-repository] Falha ao atualizar status do inbound_event:', err);
  }
}

/**
 * Re-reads the authoritative payload for a batch of accepted events, ordered deterministically
 * by created_at then id (8.4.3) — the source of truth a BullMQ job never carries directly
 * (section 4/5: jobs hold ids, not payloads).
 */
export async function fetchInboundEventsByIds(db: ServiceDb, organizationId: string, ids: string[]): Promise<StoredInboundEvent[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from('inbound_events')
    .select('id, created_at, provider_message_id, normalized_payload')
    .eq('organization_id', organizationId)
    .in('id', ids)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    providerMessageId: row.provider_message_id,
    payload: row.normalized_payload as unknown as NormalizedInboundPayload,
  }));
}
