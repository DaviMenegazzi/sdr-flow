// Pure, DOM-free state helpers for the Inbox (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 11.3):
// upsert-by-id, ordering, filter-based removal, message de-duplication and realtime-delta
// application, extracted out of InboxPage.tsx so they are directly unit-testable (see
// tests/inbox-state.test.ts) without a DOM or a WebSocket.

export interface ConversationItem {
  id: string;
  stage: string;
  bot_paused: boolean;
  handled_by: 'AI' | 'HUMAN' | 'SYSTEM';
  assigned_user_id: string | null;
  last_message_at: string | null;
  created_at: string;
  lead: {
    id: string;
    phone: string;
    name: string | null;
    city: string | null;
    interest: string | null;
    urgency: string | null;
    memory: Record<string, unknown>;
  };
  connection?: {
    id: string;
    name: string;
    provider: string;
    phone_number: string | null;
  } | null;
  deal?: {
    id: string;
    title: string;
    status: string;
    score: number | null;
  } | null;
  last_message?: {
    id: string;
    sender: string;
    direction: string;
    content: string;
    created_at: string;
  } | null;
}

export interface MessageItem {
  id: string;
  sender: 'lead' | 'ai' | 'human' | 'system';
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  created_at: string;
}

export interface InboxFilters {
  connectionId: string; // 'ALL' or a connection id
  stage: string; // 'ALL' or a conversation_stage
  handledBy: 'ALL' | 'AI' | 'HUMAN';
}

export function matchesFilters(
  conv: Pick<ConversationItem, 'stage' | 'handled_by'> & { connection?: { id: string } | null },
  filters: InboxFilters
): boolean {
  if (filters.connectionId !== 'ALL' && conv.connection?.id !== filters.connectionId) return false;
  if (filters.stage !== 'ALL' && conv.stage !== filters.stage) return false;
  if (filters.handledBy !== 'ALL' && conv.handled_by !== filters.handledBy) return false;
  return true;
}

export function sortByLastMessageAt(list: ConversationItem[]): ConversationItem[] {
  return [...list].sort((a, b) => {
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
    return bt - at;
  });
}

/** No-op when `id` isn't already in `list` — a thin realtime patch is never enough to render a
 * brand-new row (missing the lead sub-object), so the caller must trigger a snapshot refresh
 * instead (see needsListRefresh on inbox:conversation.created). */
export function upsertConversation(
  list: ConversationItem[],
  patch: Partial<ConversationItem> & { id: string }
): ConversationItem[] {
  const idx = list.findIndex(c => c.id === patch.id);
  if (idx === -1) return list;
  const next = [...list];
  next[idx] = { ...next[idx]!, ...patch };
  return sortByLastMessageAt(next);
}

export function removeConversation(list: ConversationItem[], id: string): ConversationItem[] {
  return list.filter(c => c.id !== id);
}

export function appendMessageDeduped(list: MessageItem[], message: MessageItem): MessageItem[] {
  if (list.some(m => m.id === message.id)) return list;
  return [...list, message];
}

export interface InboxRealtimeEvent {
  type: string;
  conversationId?: string;
  payload?: unknown;
}

export interface InboxState {
  conversations: ConversationItem[];
  messages: MessageItem[];
  selectedId: string | null;
}

export interface InboxRealtimeDelta {
  conversations: ConversationItem[];
  messages: MessageItem[];
  /** Patch to merge into the currently selected conversation's detail view, if targeted. */
  selectedConvPatch: (Partial<ConversationItem> & { id: string }) | null;
  /** A conversation was created or reappeared under the current filters — payload is too thin
   * to render; caller should issue one REST refresh (not a timer). */
  needsListRefresh: boolean;
  /** Server asked the client to discard incremental state and reload from scratch. */
  needsFullResync: boolean;
}

/**
 * Applies one realtime event to Inbox state. Pure: no fetch, no timers, no DOM. Handles, per
 * 11.3: upsert by id, last_message_at ordering, message de-dup by id, and removing a
 * conversation once it no longer matches the active filters.
 */
export function applyRealtimeEvent(state: InboxState, event: InboxRealtimeEvent, filters: InboxFilters): InboxRealtimeDelta {
  let conversations = state.conversations;
  let messages = state.messages;
  let selectedConvPatch: (Partial<ConversationItem> & { id: string }) | null = null;
  let needsListRefresh = false;
  let needsFullResync = false;

  if (event.type === 'inbox:conversation.created') {
    needsListRefresh = true;
  } else if (event.type === 'inbox:conversation.updated') {
    const patch = event.payload as (Partial<ConversationItem> & { id: string }) | undefined;
    if (patch?.id) {
      const existing = conversations.find(c => c.id === patch.id);
      if (existing) {
        const merged = { ...existing, ...patch };
        conversations = matchesFilters(merged, filters) ? upsertConversation(conversations, patch) : removeConversation(conversations, patch.id);
      }
      if (state.selectedId === patch.id) selectedConvPatch = patch;
    }
  } else if (event.type === 'inbox:message.created') {
    const payload = event.payload as
      | { id: string; conversationId: string; sender: MessageItem['sender']; direction: MessageItem['direction']; content: string; created_at: string }
      | undefined;
    if (payload?.conversationId) {
      if (conversations.some(c => c.id === payload.conversationId)) {
        conversations = upsertConversation(conversations, {
          id: payload.conversationId,
          last_message_at: payload.created_at,
          last_message: { id: payload.id, sender: payload.sender, direction: payload.direction, content: payload.content, created_at: payload.created_at },
        });
      }
      if (state.selectedId === payload.conversationId) {
        messages = appendMessageDeduped(messages, {
          id: payload.id,
          sender: payload.sender,
          direction: payload.direction,
          content: payload.content,
          created_at: payload.created_at,
        });
      }
    }
  } else if (event.type === 'system:resync_required') {
    needsFullResync = true;
  }

  return { conversations, messages, selectedConvPatch, needsListRefresh, needsFullResync };
}
