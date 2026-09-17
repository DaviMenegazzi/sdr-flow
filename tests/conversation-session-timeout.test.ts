import { describe, expect, it, vi } from 'vitest';
import { ConversationRepository } from '../packages/db/src/conversation-repository.js';
import { InboxRepository } from '../packages/db/src/inbox-repository.js';
import { MemoryService } from '../packages/flow/src/services/memory.js';
import { executors } from '../packages/flow/src/executors/index.js';
import type { FlowContext, FlowServices } from '../packages/flow/src/index.js';

describe('Conversation 15-Minute Session Timeout & Context Window', () => {
  describe('ConversationRepository.findOrCreateConversation', () => {
    it('returns the active conversation if activity occurred within 15 minutes', async () => {
      const activeConv = {
        id: 'conv-active',
        organization_id: 'org-1',
        connection_id: 'conn-1',
        lead_id: 'lead-1',
        stage: 'QUALIFYING',
        last_message_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      };

      const query: any = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.not = vi.fn(() => query);
      query.order = vi.fn(() => query);
      query.maybeSingle = vi.fn().mockResolvedValue({ data: activeConv, error: null });

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'conversations') return query;
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const repo = new ConversationRepository(db as any);
      const result = await repo.findOrCreateConversation('org-1', 'conn-1', 'lead-1', null, {
        sessionTimeoutMinutes: 15,
      });

      expect(result.id).toBe('conv-active');
      expect(query.maybeSingle).toHaveBeenCalled();
    });

    it('marks conversation CLOSED, resets volatile lead state, and creates a NEW conversation if inactive >= 15 min', async () => {
      const expiredTime = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
      const staleConv = {
        id: 'conv-stale',
        organization_id: 'org-1',
        connection_id: 'conn-1',
        lead_id: 'lead-1',
        stage: 'HUMAN_HANDOFF',
        last_message_at: expiredTime,
      };

      const convSelectQuery: any = {};
      convSelectQuery.select = vi.fn(() => convSelectQuery);
      convSelectQuery.eq = vi.fn(() => convSelectQuery);
      convSelectQuery.not = vi.fn(() => convSelectQuery);
      convSelectQuery.order = vi.fn(() => convSelectQuery);
      convSelectQuery.maybeSingle = vi.fn().mockResolvedValue({ data: staleConv, error: null });

      const convUpdateQuery: any = {};
      convUpdateQuery.update = vi.fn(() => convUpdateQuery);
      convUpdateQuery.eq = vi.fn(() => convUpdateQuery);

      const convInsertQuery: any = {};
      const newConv = {
        id: 'conv-new',
        organization_id: 'org-1',
        connection_id: 'conn-1',
        lead_id: 'lead-1',
        stage: 'NEW_CONVERSATION',
        handled_by: 'AI',
        bot_paused: false,
      };
      convInsertQuery.insert = vi.fn(() => convInsertQuery);
      convInsertQuery.select = vi.fn(() => convInsertQuery);
      convInsertQuery.single = vi.fn().mockResolvedValue({ data: newConv, error: null });

      // Lead mock for volatile state reset
      const initialLeadMem = {
        name: 'Carlos Silva',
        city: 'Curitiba',
        interest: 'Plano Odontológico',
        notes: 'Cliente interessado em implantes',
        objections: ['Preço alto'],
        conversation_state: { stage: 'HANDOFF_PENDING', last_action: 'offer_human' },
        custom_fields: { selected_slot_iso: '2026-09-12T14:00:00Z', proximo_passo: 'agendar' },
        attributes: {
          conversation_state: { stage: 'HANDOFF_PENDING' },
          selected_slot_iso: '2026-09-12T14:00:00Z',
          proximo_passo: 'agendar',
        },
      };

      const leadSelectQuery: any = {};
      leadSelectQuery.select = vi.fn(() => leadSelectQuery);
      leadSelectQuery.eq = vi.fn(() => leadSelectQuery);
      leadSelectQuery.single = vi.fn().mockResolvedValue({ data: { id: 'lead-1', memory: initialLeadMem }, error: null });

      const leadUpdateQuery: any = {};
      leadUpdateQuery.update = vi.fn(() => leadUpdateQuery);
      leadUpdateQuery.eq = vi.fn(() => leadUpdateQuery);

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'conversations') {
            return {
              select: convSelectQuery.select,
              update: convUpdateQuery.update,
              insert: convInsertQuery.insert,
            };
          }
          if (table === 'leads') {
            return {
              select: leadSelectQuery.select,
              update: leadUpdateQuery.update,
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const leadRef = { memory: { ...initialLeadMem } };
      const repo = new ConversationRepository(db as any);
      const result = await repo.findOrCreateConversation('org-1', 'conn-1', 'lead-1', null, {
        sessionTimeoutMinutes: 15,
        lead: leadRef,
      });

      // 1. Stale conversation updated to CLOSED
      expect(convUpdateQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'CLOSED',
        })
      );

      // 1b. The gap that closed the session (~20 min) rides along on the new conversation, so
      // downstream nodes can tell "reopened after a short gap" apart from "reopened after days".
      expect(result.resumedAfterGapMinutes).toBeGreaterThanOrEqual(19);
      expect(result.resumedAfterGapMinutes).toBeLessThanOrEqual(21);

      // 2. New conversation created with stage NEW_CONVERSATION
      expect(convInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'NEW_CONVERSATION',
          handled_by: 'AI',
          bot_paused: false,
        })
      );
      expect(result.id).toBe('conv-new');

      // 3. Volatile lead state reset: stable fields preserved, volatile fields cleared
      expect(leadUpdateQuery.update).toHaveBeenCalled();
      const updatedMemArg = leadUpdateQuery.update.mock.calls[0][0].memory;
      expect(updatedMemArg.name).toBe('Carlos Silva');
      expect(updatedMemArg.city).toBe('Curitiba');
      expect(updatedMemArg.interest).toBe('Plano Odontológico');
      expect(updatedMemArg.notes).toBe('Cliente interessado em implantes');
      expect(updatedMemArg.objections).toEqual([]);
      expect(updatedMemArg.conversation_state.stage).toBe('NEW_CONVERSATION');
      expect(updatedMemArg.custom_fields.selected_slot_iso).toBeUndefined();
      expect(updatedMemArg.custom_fields.proximo_passo).toBeUndefined();

      // In-memory leadRef mutated
      expect(leadRef.memory.conversation_state.stage).toBe('NEW_CONVERSATION');
      expect((leadRef.memory as any).custom_fields.selected_slot_iso).toBeUndefined();
    });

    it('reports a multi-day gap so a bare greeting is not read as resuming a days-old interest', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const staleConv = {
        id: 'conv-stale-old', organization_id: 'org-1', connection_id: 'conn-1', lead_id: 'lead-1',
        stage: 'HANDOFF_PENDING', last_message_at: threeDaysAgo,
      };

      const convSelectQuery: any = {};
      convSelectQuery.select = vi.fn(() => convSelectQuery);
      convSelectQuery.eq = vi.fn(() => convSelectQuery);
      convSelectQuery.not = vi.fn(() => convSelectQuery);
      convSelectQuery.order = vi.fn(() => convSelectQuery);
      convSelectQuery.maybeSingle = vi.fn().mockResolvedValue({ data: staleConv, error: null });

      const convUpdateQuery: any = {};
      convUpdateQuery.update = vi.fn(() => convUpdateQuery);
      convUpdateQuery.eq = vi.fn(() => convUpdateQuery);

      const convInsertQuery: any = {};
      const newConv = { id: 'conv-new-2', organization_id: 'org-1', connection_id: 'conn-1', lead_id: 'lead-1', stage: 'NEW_CONVERSATION', handled_by: 'AI', bot_paused: false };
      convInsertQuery.insert = vi.fn(() => convInsertQuery);
      convInsertQuery.select = vi.fn(() => convInsertQuery);
      convInsertQuery.single = vi.fn().mockResolvedValue({ data: newConv, error: null });

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'conversations') return { select: convSelectQuery.select, update: convUpdateQuery.update, insert: convInsertQuery.insert };
          if (table === 'leads') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })) };
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const repo = new ConversationRepository(db as any);
      const result = await repo.findOrCreateConversation('org-1', 'conn-1', 'lead-1', null, { sessionTimeoutMinutes: 15 });

      expect(result.id).toBe('conv-new-2');
      expect(result.resumedAfterGapMinutes).toBeGreaterThanOrEqual(3 * 24 * 60 - 1);
    });
  });

  describe('InboxRepository.release', () => {
    it('resets conversation to stage NEW_CONVERSATION and clears volatile turn state on lead', async () => {
      const convData = {
        id: 'conv-100',
        organization_id: 'org-1',
        lead_id: 'lead-1',
        stage: 'HUMAN_HANDOFF',
        handled_by: 'HUMAN',
      };

      const convSelectQuery: any = {};
      convSelectQuery.select = vi.fn(() => convSelectQuery);
      convSelectQuery.eq = vi.fn(() => convSelectQuery);
      convSelectQuery.single = vi.fn().mockResolvedValue({ data: convData, error: null });
      convSelectQuery.maybeSingle = vi.fn().mockResolvedValue({ data: convData, error: null });

      const convUpdateQuery: any = {};
      convUpdateQuery.update = vi.fn(() => convUpdateQuery);
      convUpdateQuery.eq = vi.fn(() => convUpdateQuery);

      const leadSelectQuery: any = {};
      leadSelectQuery.select = vi.fn(() => leadSelectQuery);
      leadSelectQuery.eq = vi.fn(() => leadSelectQuery);
      const leadMockData = {
        id: 'lead-1',
        memory: {
          name: 'Davi',
          conversation_state: { stage: 'HANDOFF' },
          objections: ['muito caro'],
        },
      };
      leadSelectQuery.single = vi.fn().mockResolvedValue({ data: leadMockData, error: null });
      leadSelectQuery.maybeSingle = vi.fn().mockResolvedValue({ data: leadMockData, error: null });

      const leadUpdateQuery: any = {};
      leadUpdateQuery.update = vi.fn(() => leadUpdateQuery);
      leadUpdateQuery.eq = vi.fn(() => leadUpdateQuery);

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'conversations') {
            return {
              select: convSelectQuery.select,
              update: convUpdateQuery.update,
            };
          }
          if (table === 'leads') {
            return {
              select: leadSelectQuery.select,
              update: leadUpdateQuery.update,
            };
          }
          if (table === 'conversation_events' || table === 'audit_events') {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const inboxRepo = new InboxRepository(db as any);
      await inboxRepo.release('org-1', 'conv-100', 'user-1');

      // Conversation must be handed back to AI with stage NEW_CONVERSATION
      expect(convUpdateQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          handled_by: 'AI',
          bot_paused: false,
          stage: 'NEW_CONVERSATION',
        })
      );

      // Volatile lead state reset
      expect(leadUpdateQuery.update).toHaveBeenCalled();
      const updatedMem = leadUpdateQuery.update.mock.calls[0][0].memory;
      expect(updatedMem.name).toBe('Davi');
      expect(updatedMem.conversation_state.stage).toBe('NEW_CONVERSATION');
      expect(updatedMem.objections).toEqual([]);
    });
  });

  describe('MemoryService session formatting and turn context', () => {
    it('formatSessionDelimitedMessages cleanly separates previous session from new conversation', () => {
      const priorMessages = [
        { id: '1', conversation_id: 'c-old', content: 'Qual o valor do plano ouro?', sender: 'lead', direction: 'INBOUND' },
        { id: '2', conversation_id: 'c-old', content: 'O plano ouro custa R$ 120/mês.', sender: 'ai', direction: 'OUTBOUND' },
      ];
      const currentMessages = [
        { id: '3', text: 'boa tarde', fromMe: false, sender: 'lead' as const },
      ];

      const formatted = MemoryService.formatSessionDelimitedMessages(currentMessages, priorMessages, 5);

      expect(formatted).toContain('[Histórico anterior]');
      expect(formatted).toContain('[Lead]: Qual o valor do plano ouro?');
      expect(formatted).toContain('[AI]: O plano ouro custa R$ 120/mês.');
      expect(formatted).toContain('--- Nova conversa iniciada ---');
      expect(formatted).toContain('[Lead]: boa tarde');
    });

    it('getConversationTurnContext produces empty lastAssistantQuestion on a fresh session', () => {
      // In a fresh conversation, the only message is the new greeting from the lead
      const messages = [
        { id: 'new-1', text: 'boa tarde', fromMe: false, sender: 'lead' as const },
      ];

      const turnCtx = MemoryService.getConversationTurnContext(messages);

      expect(turnCtx.latestLeadMessage).toBe('boa tarde');
      expect(turnCtx.lastAssistantMessage).toBe('');
      expect(turnCtx.lastAssistantQuestion).toBe('');
      expect(turnCtx.recentAssistantMessages).toEqual([]);
    });
  });

  describe('context.memory executor with prior session messages', () => {
    it('includes prior messages when current conversation messages <= 10', async () => {
      const ctx: FlowContext = {
        organizationId: 'org-1',
        connectionId: 'conn-1',
        leadId: 'lead-1',
        conversationId: 'conv-new',
        executionId: 'exec-1',
        flowVersionId: 'v1',
        lead: {
          id: 'lead-1',
          phone: '5511999999999',
          name: 'Maria Santos',
          memory: {
            name: 'Maria Santos',
            interest: 'Plano Familiar',
          },
        },
        conversation: {
          id: 'conv-new',
          stage: 'NEW_CONVERSATION',
          bot_paused: false,
          handled_by: 'AI',
        },
        messages: [
          { id: 'msg-fresh', text: 'olá, boa tarde', fromMe: false, sender: 'lead' },
        ],
        variables: {},
        tokens: { input: 0, output: 0 },
      };

      const services: FlowServices = {
        llm: {
          generate: vi.fn(),
          generateJSON: vi.fn(),
          classifyIntent: vi.fn(),
        },
        messaging: {
          sendText: vi.fn(),
          sendMedia: vi.fn(),
          sendTemplate: vi.fn(),
        },
        db: {
          updateLead: vi.fn(),
          updateConversation: vi.fn(),
          saveMessage: vi.fn(),
          syncDeal: vi.fn(),
          getMessages: vi.fn().mockResolvedValue([
            { id: 'msg-fresh', content: 'olá, boa tarde', sender: 'lead', direction: 'INBOUND' },
          ]),
          getLeadRecentMessages: vi.fn().mockResolvedValue([
            { id: 'old-1', conversation_id: 'conv-old', content: 'Quanto fica o plano familiar?', sender: 'lead', direction: 'INBOUND' },
            { id: 'old-2', conversation_id: 'conv-old', content: 'O plano familiar sai por R$ 99/mês. Quantas pessoas são?', sender: 'ai', direction: 'OUTBOUND' },
            { id: 'msg-fresh', conversation_id: 'conv-new', content: 'olá, boa tarde', sender: 'lead', direction: 'INBOUND' },
          ]),
        },
      };

      const result = await executors['context.memory'](ctx, { recentMessages: 6 }, services);

      expect(result.port).toBe('next');
      expect(result.variables?.recentMessages).toContain('[Histórico anterior]');
      expect(result.variables?.recentMessages).toContain('[Lead]: Quanto fica o plano familiar?');
      expect(result.variables?.recentMessages).toContain('[AI]: O plano familiar sai por R$ 99/mês.');
      expect(result.variables?.recentMessages).toContain('--- Nova conversa iniciada ---');
      expect(result.variables?.recentMessages).toContain('[Lead]: olá, boa tarde');

      // But turn context must NOT have an assistant question from the old session
      expect(result.variables?.lastAssistantQuestion).toBe('');
      expect(result.variables?.lastAssistantMessage).toBe('');
      expect(result.variables?.latestLeadMessage).toBe('olá, boa tarde');
    });
  });
});
