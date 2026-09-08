import { describe, it, expect } from 'vitest';
import {
  createSdrTemplate,
  executeFlow,
  replayFlow,
  MockLLMProvider,
  type FlowServices,
} from '../packages/flow/src/index.js';
import type { FlowContext } from '../packages/shared/src/index.js';

describe('Flow Replay Module', () => {
  it('replays a saved execution trace and verifies step match', async () => {
    const sdrGraph = createSdrTemplate();
    const testNode = sdrGraph.nodes.find(n => n.id === 'test');
    if (testNode) {
      testNode.config = { enabled: true, allowedPhones: ['11999998888'] };
    }

    const ctx: FlowContext = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      connectionId: '22222222-2222-2222-2222-222222222222',
      leadId: '33333333-3333-3333-3333-333333333333',
      conversationId: '44444444-4444-4444-4444-444444444444',
      executionId: '55555555-5555-5555-5555-555555555555',
      flowVersionId: '66666666-6666-6666-6666-666666666666',
      lead: {
        id: '33333333-3333-3333-3333-333333333333',
        phone: '5511999998888',
        name: 'Pedro Ramos',
        memory: {},
      },
      conversation: {
        id: '44444444-4444-4444-4444-444444444444',
        stage: 'NEW_CONVERSATION',
        bot_paused: false,
        handled_by: 'AI',
      },
      messages: [{ id: 'm1', text: 'Quero saber valores', fromMe: false }],
      variables: {},
      tokens: { input: 0, output: 0 },
    };

    const services: FlowServices = {
      llm: new MockLLMProvider({
        reply: 'Olá Pedro, nossos valores começam em R$ 49/mês.',
        stage: 'QUALIFYING',
        handoff: false,
      }),
      messaging: {
        sendText: async () => ({ messageId: 'm1' }),
        sendMedia: async () => ({ messageId: 'm2' }),
        sendTemplate: async () => ({ messageId: 'm3' }),
      },
      db: {
        updateLead: async () => {},
        updateConversation: async () => {},
        saveMessage: async () => ({ id: 'saved-1' }),
        syncDeal: async () => ({ id: 'deal-1' }),
      },
    };

    // 1. Initial live run
    const originalRun = await executeFlow(sdrGraph, structuredClone(ctx), services);
    expect(originalRun.status).toBe('completed');
    expect(originalRun.steps.length).toBeGreaterThan(0);

    // 2. Replay with sandbox services
    const replay = await replayFlow(
      sdrGraph,
      structuredClone(ctx),
      originalRun.steps,
      {
        llm: new MockLLMProvider({
          reply: 'Olá Pedro, nossos valores começam em R$ 49/mês.',
          stage: 'QUALIFYING',
          handoff: false,
        }),
      }
    );

    expect(replay.matched).toBe(true);
    expect(replay.replayedStepCount).toBe(originalRun.steps.length);
    expect(replay.divergenceStep).toBeUndefined();
    expect(replay.replayedResult.status).toBe('completed');
  });

  it('detects divergence when decision leads down a different branch in replay', async () => {
    const sdrGraph = createSdrTemplate();
    const testNode = sdrGraph.nodes.find(n => n.id === 'test');
    if (testNode) {
      testNode.config = { enabled: false, allowedPhones: [] };
    }

    const ctx: FlowContext = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      connectionId: '22222222-2222-2222-2222-222222222222',
      leadId: '33333333-3333-3333-3333-333333333333',
      conversationId: '44444444-4444-4444-4444-444444444444',
      executionId: '55555555-5555-5555-5555-555555555555',
      flowVersionId: '66666666-6666-6666-6666-666666666666',
      lead: { id: 'l1', phone: '5511999998888', memory: {} },
      conversation: { id: 'c1', stage: 'NEW_CONVERSATION', bot_paused: false, handled_by: 'AI' },
      messages: [{ id: 'm1', text: 'Quero suporte humano', fromMe: false }],
      variables: {},
      tokens: { input: 0, output: 0 },
    };

    // Original run chose handoff = false
    const originalRun = await executeFlow(sdrGraph, structuredClone(ctx), {
      llm: new MockLLMProvider({ handoff: false }),
      messaging: {
        sendText: async () => ({ messageId: 'm1' }),
        sendMedia: async () => ({ messageId: 'm2' }),
        sendTemplate: async () => ({ messageId: 'm3' }),
      },
    });

    // Replay with handoff = true (divergence)
    const replay = await replayFlow(
      sdrGraph,
      structuredClone(ctx),
      originalRun.steps,
      {
        llm: new MockLLMProvider({ handoff: true }),
      }
    );

    expect(replay.matched).toBe(false);
    expect(replay.divergenceStep).toBeDefined();
  });
});
