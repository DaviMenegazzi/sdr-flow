import { describe, expect, it, vi } from 'vitest';
import { ConversationRepository } from '../packages/db/src/conversation-repository.js';

describe('ConversationRepository.getMessages', () => {
  it('scopes by organization and conversation, then returns the requested history chronologically', async () => {
    const newestFirst = [
      { id: 'm3', content: 'Quero sim', sender: 'lead', direction: 'INBOUND' },
      { id: 'm2', content: 'O cartão Smart custa R$ 69,90', sender: 'ai', direction: 'OUTBOUND' },
      { id: 'm1', content: 'Quero conhecer', sender: 'lead', direction: 'INBOUND' },
    ];
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.limit = vi.fn().mockResolvedValue({ data: newestFirst.map(row => ({ ...row })), error: null });
    const db = { from: vi.fn(() => query) };
    const repository = new ConversationRepository(db as any);

    const messages = await repository.getMessages('org-1', 'conversation-1', 15);

    expect(db.from).toHaveBeenCalledWith('messages');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'organization_id', 'org-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'conversation_id', 'conversation-1');
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(15);
    expect(messages.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
