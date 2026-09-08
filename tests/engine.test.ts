import { describe, it, expect, vi } from 'vitest';
import {
  executeFlow,
  createSdrTemplate,
  createBlankFlow,
  makeNode,
  MockLLMProvider,
  type FlowServices,
} from '../packages/flow/src/index.js';
import type { FlowContext, FlowGraph } from '../packages/shared/src/index.js';

function createMockContext(overrides?: Partial<FlowContext>): FlowContext {
  return {
    organizationId: '11111111-1111-1111-1111-111111111111',
    connectionId: '22222222-2222-2222-2222-222222222222',
    leadId: '33333333-3333-3333-3333-333333333333',
    conversationId: '44444444-4444-4444-4444-444444444444',
    executionId: '55555555-5555-5555-5555-555555555555',
    flowVersionId: '66666666-6666-6666-6666-666666666666',
    lead: {
      id: '33333333-3333-3333-3333-333333333333',
      phone: '5511999998888',
      name: 'Maria Oliveira',
      city: 'São Paulo',
      interest: 'Plano Odontológico',
      urgency: 'alta',
      memory: {},
    },
    conversation: {
      id: '44444444-4444-4444-4444-444444444444',
      stage: 'NEW_CONVERSATION',
      bot_paused: false,
      handled_by: 'AI',
    },
    messages: [
      { id: 'm1', text: 'Gostaria de cotar um plano para minha família', fromMe: false },
    ],
    variables: {},
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

function createMockServices(overrides?: Partial<FlowServices>): FlowServices {
  return {
    llm: new MockLLMProvider({
      reply: 'Olá Maria, temos ótimos planos odontológicos para você!',
      stage: 'QUALIFYING',
      handoff: false,
    }),
    messaging: {
      sendText: vi.fn().mockResolvedValue({ messageId: 'msg-out-1' }),
      sendMedia: vi.fn().mockResolvedValue({ messageId: 'media-out-1' }),
      sendTemplate: vi.fn().mockResolvedValue({ messageId: 'tpl-out-1' }),
    },
    db: {
      updateLead: vi.fn().mockResolvedValue(undefined),
      updateConversation: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue({ id: 'saved-msg-1' }),
      syncDeal: vi.fn().mockResolvedValue({ id: 'deal-1' }),
    },
    ...overrides,
  };
}

describe('DAG Flow Engine', () => {
  it('executes the 17-node SDR template end-to-end (Happy Path)', async () => {
    const sdrGraph = createSdrTemplate();
    const ctx = createMockContext();
    const services = createMockServices();

    // Configure test mode to authorize the lead phone
    const testNode = sdrGraph.nodes.find(n => n.id === 'test');
    if (testNode) {
      testNode.config = { enabled: true, allowedPhones: ['11999998888'] };
    }

    const result = await executeFlow(sdrGraph, ctx, services);

    expect(result.status).toBe('completed');
    expect(result.error).toBeUndefined();
    expect(result.steps.length).toBeGreaterThan(10);

    // Verify key nodes were executed in sequence
    const nodeSequence = result.steps.map(s => s.nodeId);
    expect(nodeSequence).toContain('start');
    expect(nodeSequence).toContain('test');
    expect(nodeSequence).toContain('chat');
    expect(nodeSequence).toContain('human');
    expect(nodeSequence).toContain('phone');
    expect(nodeSequence).toContain('buffer');
    expect(nodeSequence).toContain('media');
    expect(nodeSequence).toContain('memory');
    expect(nodeSequence).toContain('decide');
    expect(nodeSequence).toContain('lead');
    expect(nodeSequence).toContain('stage');
    expect(nodeSequence).toContain('crm');
    expect(nodeSequence).toContain('branch');
    expect(nodeSequence).toContain('reply');
    expect(nodeSequence).toContain('end');

    // Verify token tracking
    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.tokens.output).toBeGreaterThan(0);

    // Verify messaging was called with interpolated text
    expect(services.messaging.sendText).toHaveBeenCalledWith(
      ctx.connectionId,
      '5511999998888',
      'Olá Maria, temos ótimos planos odontológicos para você!',
      { typing: true }
    );
  });

  it('routes to blocked node when test mode rejects lead phone', async () => {
    const sdrGraph = createSdrTemplate();
    const ctx = createMockContext({
      lead: { id: 'l1', phone: '5521999991111', memory: {} },
    });
    const services = createMockServices();

    // Allowed phones does not include lead's phone
    const testNode = sdrGraph.nodes.find(n => n.id === 'test');
    if (testNode) {
      testNode.config = { enabled: true, allowedPhones: ['11999998888'] };
    }

    const result = await executeFlow(sdrGraph, ctx, services);

    expect(result.status).toBe('completed');
    const nodeSequence = result.steps.map(s => s.nodeId);
    expect(nodeSequence).toEqual(['start', 'test', 'blocked']);
    expect(services.messaging.sendText).not.toHaveBeenCalled();
  });

  it('branches to action.handoff when decision.handoff is true', async () => {
    const sdrGraph = createSdrTemplate();
    const ctx = createMockContext();
    const services = createMockServices({
      llm: new MockLLMProvider({
        reply: 'Vou transferir você para um de nossos especialistas.',
        stage: 'QUALIFYING',
        handoff: true,
        handoff_reason: 'Lead solicitou falar com corretor',
      }),
    });

    const testNode = sdrGraph.nodes.find(n => n.id === 'test');
    if (testNode) {
      testNode.config = { enabled: false, allowedPhones: [] };
    }

    const result = await executeFlow(sdrGraph, ctx, services);

    expect(result.status).toBe('completed');
    const nodeSequence = result.steps.map(s => s.nodeId);
    expect(nodeSequence).toContain('branch');
    expect(nodeSequence).toContain('handoff');
    expect(nodeSequence).toContain('reply');
    expect(nodeSequence).toContain('end');

    expect(ctx.conversation?.bot_paused).toBe(true);
    expect(ctx.conversation?.handled_by).toBe('HUMAN');
  });

  it('suspends on flow.wait_reply and resumes from resumeNodeId', async () => {
    // Construct a flow: start -> wait_reply -> reply -> end
    const replyNode = makeNode('output.send_text', 'reply', 400, 0);
    replyNode.config = { text: 'Olá novamente!', typing: true };

    const waitFlow: FlowGraph = {
      schemaVersion: 1,
      nodes: [
        makeNode('trigger.message_received', 'start', 0, 0),
        makeNode('flow.wait_reply', 'wait', 200, 0),
        replyNode,
        makeNode('output.end', 'end', 600, 0),
      ],
      edges: [
        { id: 'e1', source: 'start', sourcePort: 'next', target: 'wait' },
        { id: 'e2', source: 'wait', sourcePort: 'reply', target: 'reply' },
        { id: 'e3', source: 'reply', sourcePort: 'next', target: 'end' },
      ],
    };

    const ctx = createMockContext();
    const services = createMockServices();

    // 1st run: reaches wait_reply and suspends
    const firstRun = await executeFlow(waitFlow, ctx, services);
    expect(firstRun.status).toBe('waiting');
    expect(firstRun.resumeNodeId).toBe('wait');
    expect(firstRun.steps.map(s => s.nodeId)).toEqual(['start', 'wait']);
    expect(services.messaging.sendText).not.toHaveBeenCalled();

    // 2nd run: resumes from wait node when new message arrives
    ctx.messages.push({ id: 'm2', text: 'Estou de volta!', fromMe: false });
    const secondRun = await executeFlow(waitFlow, ctx, services, {
      resumeFromNodeId: firstRun.resumeNodeId!,
      resumePort: 'reply',
    });

    expect(secondRun.status).toBe('completed');
    expect(secondRun.steps.map(s => s.nodeId)).toEqual(['wait', 'reply', 'end']);
    expect(services.messaging.sendText).toHaveBeenCalled();
  });

  it('prevents infinite loops with maxSteps limit', async () => {
    // Flow with circular path
    const loopingGraph: FlowGraph = {
      schemaVersion: 1,
      nodes: [
        makeNode('trigger.message_received', 'start', 0, 0),
        makeNode('flow.delay', 'loop1', 200, 0),
        makeNode('flow.delay', 'loop2', 400, 0),
      ],
      edges: [
        { id: 'e1', source: 'start', sourcePort: 'next', target: 'loop1' },
        { id: 'e2', source: 'loop1', sourcePort: 'next', target: 'loop2' },
        { id: 'e3', source: 'loop2', sourcePort: 'next', target: 'loop1' },
      ],
    };

    const ctx = createMockContext();
    const services = createMockServices();

    const result = await executeFlow(loopingGraph, ctx, services, { maxSteps: 10 });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Limite de passos excedido');
  });

  it('triggers hooks for onStepStart and onStepComplete', async () => {
    const blank = createBlankFlow();
    const ctx = createMockContext();
    const services = createMockServices();

    const onStepStart = vi.fn();
    const onStepComplete = vi.fn();

    const result = await executeFlow(blank, ctx, services, {
      hooks: { onStepStart, onStepComplete },
    });

    expect(result.status).toBe('completed');
    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(onStepComplete).toHaveBeenCalledTimes(2);
  });
});
