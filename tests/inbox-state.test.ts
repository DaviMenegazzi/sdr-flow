import { describe, expect, it } from 'vitest';
import {
  applyRealtimeEvent,
  appendMessageDeduped,
  matchesFilters,
  sortByLastMessageAt,
  upsertConversation,
  removeConversation,
  type ConversationItem,
  type MessageItem,
} from '../apps/web/src/inbox/inbox-state.js';

// Fase 5 (11.3, 11.6.1-2/6): pure reducer tests — no DOM, no WebSocket, no fetch.

function conv(overrides: Partial<ConversationItem> & { id: string }): ConversationItem {
  return {
    stage: 'NEW_CONVERSATION',
    bot_paused: false,
    handled_by: 'AI',
    assigned_user_id: null,
    last_message_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    lead: { id: 'lead-1', phone: '5511999999999', name: 'Lead', city: null, interest: null, urgency: null, memory: {} },
    connection: { id: 'conn-1', name: 'WA', provider: 'evolution', phone_number: null },
    ...overrides,
  };
}

describe('inbox-state', () => {
  it('sortByLastMessageAt orders most-recent first, falling back to created_at when null', () => {
    const list = [
      conv({ id: 'a', last_message_at: '2026-01-01T10:00:00.000Z' }),
      conv({ id: 'b', last_message_at: null, created_at: '2026-01-01T12:00:00.000Z' }),
      conv({ id: 'c', last_message_at: '2026-01-01T11:00:00.000Z' }),
    ];
    expect(sortByLastMessageAt(list).map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('upsertConversation merges fields for a known id and re-sorts', () => {
    const list = [conv({ id: 'a', last_message_at: '2026-01-01T10:00:00.000Z' }), conv({ id: 'b', last_message_at: '2026-01-01T09:00:00.000Z' })];
    const next = upsertConversation(list, { id: 'b', stage: 'CONVERTED', last_message_at: '2026-01-01T12:00:00.000Z' });
    expect(next.map(c => c.id)).toEqual(['b', 'a']);
    expect(next[0]!.stage).toBe('CONVERTED');
  });

  it('upsertConversation is a no-op for an id not already in the list (thin payload cannot render a new row)', () => {
    const list = [conv({ id: 'a' })];
    const next = upsertConversation(list, { id: 'unknown', stage: 'CONVERTED' });
    expect(next).toBe(list);
  });

  it('removeConversation drops the matching id only', () => {
    const list = [conv({ id: 'a' }), conv({ id: 'b' })];
    expect(removeConversation(list, 'a').map(c => c.id)).toEqual(['b']);
  });

  it('appendMessageDeduped does not duplicate an id already present', () => {
    const msg: MessageItem = { id: 'm1', sender: 'lead', direction: 'INBOUND', content: 'oi', created_at: '2026-01-01T00:00:00.000Z' };
    const once = appendMessageDeduped([], msg);
    const twice = appendMessageDeduped(once, msg);
    expect(twice).toHaveLength(1);
  });

  it('matchesFilters checks connection, stage and handledBy independently', () => {
    const c = conv({ id: 'a', stage: 'QUALIFYING', handled_by: 'AI', connection: { id: 'conn-1', name: 'WA', provider: 'evolution', phone_number: null } });
    expect(matchesFilters(c, { connectionId: 'ALL', stage: 'ALL', handledBy: 'ALL' })).toBe(true);
    expect(matchesFilters(c, { connectionId: 'conn-2', stage: 'ALL', handledBy: 'ALL' })).toBe(false);
    expect(matchesFilters(c, { connectionId: 'ALL', stage: 'CONVERTED', handledBy: 'ALL' })).toBe(false);
    expect(matchesFilters(c, { connectionId: 'ALL', stage: 'ALL', handledBy: 'HUMAN' })).toBe(false);
  });

  describe('applyRealtimeEvent', () => {
    const filters = { connectionId: 'ALL', stage: 'ALL', handledBy: 'ALL' as const };

    it('inbox:conversation.created flags needsListRefresh without touching local state', () => {
      const state = { conversations: [conv({ id: 'a' })], messages: [], selectedId: null };
      const delta = applyRealtimeEvent(state, { type: 'inbox:conversation.created', payload: { id: 'new' } }, filters);
      expect(delta.needsListRefresh).toBe(true);
      expect(delta.conversations).toBe(state.conversations);
    });

    it('inbox:conversation.updated patches a known conversation in place', () => {
      const state = { conversations: [conv({ id: 'a', stage: 'NEW_CONVERSATION' })], messages: [], selectedId: null };
      const delta = applyRealtimeEvent(state, { type: 'inbox:conversation.updated', payload: { id: 'a', stage: 'CONVERTED', handled_by: 'AI' } }, filters);
      expect(delta.conversations[0]!.stage).toBe('CONVERTED');
    });

    it('inbox:conversation.updated removes the conversation once it no longer matches the active stage filter', () => {
      const stageFilter = { connectionId: 'ALL', stage: 'QUALIFYING', handledBy: 'ALL' as const };
      const state = { conversations: [conv({ id: 'a', stage: 'QUALIFYING' })], messages: [], selectedId: null };
      const delta = applyRealtimeEvent(state, { type: 'inbox:conversation.updated', payload: { id: 'a', stage: 'CONVERTED' } }, stageFilter);
      expect(delta.conversations).toHaveLength(0);
    });

    it('inbox:conversation.updated patches selectedConvPatch only when the event targets the open conversation', () => {
      const state = { conversations: [conv({ id: 'a' })], messages: [], selectedId: 'a' };
      const delta = applyRealtimeEvent(state, { type: 'inbox:conversation.updated', payload: { id: 'a', bot_paused: true } }, filters);
      expect(delta.selectedConvPatch).toEqual({ id: 'a', bot_paused: true });

      const stateOther = { ...state, selectedId: 'b' };
      const deltaOther = applyRealtimeEvent(stateOther, { type: 'inbox:conversation.updated', payload: { id: 'a', bot_paused: true } }, filters);
      expect(deltaOther.selectedConvPatch).toBeNull();
    });

    it('inbox:message.created updates the conversation preview and appends to open messages, deduped by id', () => {
      const state = {
        conversations: [conv({ id: 'a', last_message_at: '2026-01-01T00:00:00.000Z' })],
        messages: [{ id: 'm0', sender: 'lead' as const, direction: 'INBOUND' as const, content: 'oi', created_at: '2026-01-01T00:00:00.000Z' }],
        selectedId: 'a',
      };
      const payload = { id: 'm1', conversationId: 'a', sender: 'ai' as const, direction: 'OUTBOUND' as const, content: 'Olá!', created_at: '2026-01-02T00:00:00.000Z' };
      const delta = applyRealtimeEvent(state, { type: 'inbox:message.created', conversationId: 'a', payload }, filters);

      expect(delta.conversations[0]!.last_message?.content).toBe('Olá!');
      expect(delta.conversations[0]!.last_message_at).toBe('2026-01-02T00:00:00.000Z');
      expect(delta.messages.map(m => m.id)).toEqual(['m0', 'm1']);

      // Re-applying the same event must not duplicate the message (11.6.2).
      const deltaAgain = applyRealtimeEvent({ ...state, messages: delta.messages }, { type: 'inbox:message.created', conversationId: 'a', payload }, filters);
      expect(deltaAgain.messages).toHaveLength(2);
    });

    it('inbox:message.created carries message_type through to both the card preview and the appended message', () => {
      const state = { conversations: [conv({ id: 'a' })], messages: [], selectedId: 'a' };
      const payload = { id: 'm1', conversationId: 'a', sender: 'lead' as const, direction: 'INBOUND' as const, content: '', created_at: '2026-01-02T00:00:00.000Z', message_type: 'audio' };
      const delta = applyRealtimeEvent(state, { type: 'inbox:message.created', conversationId: 'a', payload }, filters);

      expect(delta.conversations[0]!.last_message?.message_type).toBe('audio');
      expect(delta.messages[0]!.message_type).toBe('audio');
    });

    it('inbox:message.created for a conversation not currently selected does not touch messages', () => {
      const state = { conversations: [conv({ id: 'a' })], messages: [], selectedId: 'other' };
      const payload = { id: 'm1', conversationId: 'a', sender: 'lead' as const, direction: 'INBOUND' as const, content: 'oi', created_at: '2026-01-02T00:00:00.000Z' };
      const delta = applyRealtimeEvent(state, { type: 'inbox:message.created', conversationId: 'a', payload }, filters);
      expect(delta.messages).toHaveLength(0);
      expect(delta.conversations[0]!.last_message_at).toBe('2026-01-02T00:00:00.000Z');
    });

    it('system:resync_required signals a full resync', () => {
      const state = { conversations: [], messages: [], selectedId: null };
      const delta = applyRealtimeEvent(state, { type: 'system:resync_required' }, filters);
      expect(delta.needsFullResync).toBe(true);
    });
  });
});
