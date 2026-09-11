import { describe, it, expect, vi } from 'vitest';
import {
  executors,
  MemoryService,
  HandoffService,
  MockLLMProvider,
  interpolate,
  type FlowServices,
} from '../packages/flow/src/index.js';
import type { FlowContext } from '../packages/shared/src/index.js';

function createTestContext(overrides?: Partial<FlowContext>): FlowContext {
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
      name: 'João Silva',
      city: 'São Paulo',
      interest: 'Plano Familiar',
      urgency: 'alta',
      memory: { notes: 'Primeiro contato' },
    },
    conversation: {
      id: '44444444-4444-4444-4444-444444444444',
      stage: 'NEW_CONVERSATION',
      bot_paused: false,
      handled_by: 'AI',
    },
    messages: [
      { id: 'm1', text: 'Olá, gostaria de saber mais sobre os planos', fromMe: false },
    ],
    variables: {},
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

function createTestServices(overrides?: Partial<FlowServices>): FlowServices {
  return {
    llm: new MockLLMProvider(),
    messaging: {
      sendText: vi.fn().mockResolvedValue({ messageId: 'msg-out-1' }),
      sendMedia: vi.fn().mockResolvedValue({ messageId: 'media-out-1' }),
      sendTemplate: vi.fn().mockResolvedValue({ messageId: 'tpl-out-1' }),
    },
    media: {
      transcribeAudio: vi.fn().mockResolvedValue('Preciso de um plano'),
      describeImage: vi.fn().mockResolvedValue('Foto de documento de identidade'),
    },
    db: {
      updateLead: vi.fn().mockResolvedValue(undefined),
      updateConversation: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue({ id: 'saved-msg-1' }),
      syncDeal: vi.fn().mockResolvedValue({ id: 'deal-1' }),
    },
    now: () => new Date('2026-09-08T14:30:00.000Z'), // Tuesday 11:30 AM in Sao Paulo
    ...overrides,
  };
}

describe('Flow Executors — core catalog', () => {
  // --- TRIGGERS ---
  it('trigger.message_received emits port next', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['trigger.message_received'](ctx, {}, services);
    expect(res.port).toBe('next');
  });

  it('trigger.schedule emits port next', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['trigger.schedule'](ctx, { cron: '0 9 * * *' }, services);
    expect(res.port).toBe('next');
  });

  it('trigger.manual emits port next', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['trigger.manual'](ctx, {}, services);
    expect(res.port).toBe('next');
  });

  // --- GUARDS ---
  it('guard.test_mode allows matching phone', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['guard.test_mode'](
      ctx,
      { enabled: true, allowedPhones: ['11999998888'] },
      services
    );
    expect(res.port).toBe('pass');
  });

  it('guard.test_mode blocks non-matching phone', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['guard.test_mode'](
      ctx,
      { enabled: true, allowedPhones: ['21988887777'] },
      services
    );
    expect(res.port).toBe('blocked');
  });

  it('guard.human_takeover passes when bot is active', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['guard.human_takeover'](ctx, {}, services);
    expect(res.port).toBe('pass');
  });

  it('guard.human_takeover blocks when bot is paused', async () => {
    const ctx = createTestContext({
      conversation: {
        id: 'c1',
        stage: 'HUMAN_HANDOFF',
        bot_paused: true,
        handled_by: 'HUMAN',
      },
    });
    const services = createTestServices();
    const res = await executors['guard.human_takeover'](ctx, {}, services);
    expect(res.port).toBe('blocked');
  });

  it('guard.business_hours evaluates timezone correctly', async () => {
    const ctx = createTestContext();
    // Tuesday 11:30 BRT is inside 08:00 - 18:00
    const services = createTestServices({ now: () => new Date('2026-09-08T14:30:00.000Z') });
    const res = await executors['guard.business_hours'](
      ctx,
      { timezone: 'America/Sao_Paulo', start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
      services
    );
    expect(res.port).toBe('pass');
  });

  it('guard.business_hours blocks outside hours', async () => {
    const ctx = createTestContext();
    // 23:30 BRT is outside 08:00 - 18:00
    const services = createTestServices({ now: () => new Date('2026-09-08T02:30:00.000Z') });
    const res = await executors['guard.business_hours'](
      ctx,
      { timezone: 'America/Sao_Paulo', start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
      services
    );
    expect(res.port).toBe('blocked');
  });

  it('guard.chat_type blocks groups if disallowed', async () => {
    const ctx = createTestContext({
      lead: { id: 'l1', phone: '12036304@g.us', memory: {} },
    });
    const services = createTestServices();
    const res = await executors['guard.chat_type'](ctx, { allowGroups: false }, services);
    expect(res.port).toBe('blocked');
  });

  // --- INPUT ---
  it('input.normalize normalizes Brazilian phone', async () => {
    const ctx = createTestContext({
      lead: { id: 'l1', phone: '55 (11) 99999-8888', memory: {} },
    });
    const services = createTestServices();
    const res = await executors['input.normalize'](ctx, { country: 'BR' }, services);
    expect(res.port).toBe('next');
    expect(ctx.lead?.phone).toBe('5511999998888');
  });

  it('input.buffer groups incoming messages', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['input.buffer'](ctx, { windowSeconds: 5 }, services);
    expect(res.port).toBe('next');
    expect((res.output as any).messagesAggregated).toBe(1);
  });

  it('input.media processes audio and images', async () => {
    const ctx = createTestContext({
      messages: [
        { id: 'm-audio', text: '', fromMe: false, type: 'audio', mediaUrl: 'https://example.com/audio.ogg' },
      ],
    });
    const services = createTestServices();
    const res = await executors['input.media'](
      ctx,
      { transcribeAudio: true, describeImages: true },
      services
    );
    expect(res.port).toBe('next');
    expect(services.media?.transcribeAudio).toHaveBeenCalled();
    expect(res.variables?.mediaEnrichedText).toContain('Preciso de um plano');
  });

  // --- CONTEXT ---
  it('context.memory gathers commercial memory and recent history', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['context.memory'](ctx, { recentMessages: 6 }, services);
    expect(res.port).toBe('next');
    expect(res.variables?.commercialMemory).toBeDefined();
    expect((res.variables?.commercialMemory as any).name).toBe('João Silva');
  });

  it('context.memory prefers the persisted conversation history and reports its source', async () => {
    const ctx = createTestContext();
    const services = createTestServices({
      db: {
        ...createTestServices().db!,
        getMessages: vi.fn().mockResolvedValue([
          { id: 'm1', content: 'Quero conhecer o cartão', sender: 'lead', direction: 'INBOUND' },
          { id: 'm2', content: 'O Smart custa R$ 69,90. O que acha?', sender: 'ai', direction: 'OUTBOUND' },
          { id: 'sys', content: 'Falha interna do fluxo', sender: 'system', direction: 'OUTBOUND' },
          { id: 'm3', content: 'Quero sim, me fala aí', sender: 'lead', direction: 'INBOUND' },
        ]),
      },
    });

    const res = await executors['context.memory'](ctx, { recentMessages: 15 }, services);

    expect(res.variables?.recentMessages).toBe(
      '[Lead]: Quero conhecer o cartão\n[AI]: O Smart custa R$ 69,90. O que acha?\n[Lead]: Quero sim, me fala aí',
    );
    expect((res.output as any).history).toEqual({
      source: 'database',
      messagesCount: 3,
      rawMessagesCount: 4,
      excludedSystemMessages: 1,
      requestedLimit: 15,
      databaseReaderAvailable: true,
      error: null,
    });
    expect(res.variables?.latestLeadMessage).toBe('Quero sim, me fala aí');
    expect(res.variables?.lastAssistantMessage).toBe('O Smart custa R$ 69,90. O que acha?');
    expect(res.variables?.lastAssistantQuestion).toBe('O que acha?');
    expect(res.variables?.recentAssistantMessages).toEqual(['O Smart custa R$ 69,90. O que acha?']);
    expect(res.variables?.recentMessages).not.toContain('Falha interna');
  });

  it('context.crm sets crm context', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['context.crm'](ctx, {}, services);
    expect(res.port).toBe('next');
    expect((res.variables?.crmContext as any).leadId).toBe(ctx.leadId);
  });

  it('context.knowledge searches snippets', async () => {
    const ctx = createTestContext({ variables: { latestLeadMessage: 'Tem uma opção mais barata?' } });
    const services = createTestServices({
      db: {
        ...createTestServices().db!,
        searchKnowledge: vi.fn().mockResolvedValue([{
          text: 'Plano Individual custa R$ 50', collection: 'faq', title: 'Preço', similarity: 0.81,
        }]),
      },
    });
    const res = await executors['context.knowledge'](ctx, { collection: 'faq', threshold: 0.3, topK: 5 }, services);
    expect(res.port).toBe('next');
    expect((res.variables?.knowledgeSnippets as string[])[0]).toContain('Plano Individual');
    expect((res.output as any).search).toMatchObject({
      query: 'Tem uma opção mais barata?', requestedCollection: 'faq', searchedCollection: 'faq', fallbackUsed: false,
    });
    expect((res.output as any).search.matches[0]).toMatchObject({ similarity: 0.81, title: 'Preço' });
  });

  it('context.knowledge retries all collections and explains an empty result in the trace', async () => {
    const ctx = createTestContext({ variables: { latestLeadMessage: 'Quais são os benefícios?' } });
    const searchKnowledge = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const services = createTestServices({
      db: { ...createTestServices().db!, searchKnowledge },
    });
    const res = await executors['context.knowledge'](ctx, {
      collection: 'pricing', threshold: 0.4, topK: 3, fallbackToAll: true,
    }, services);
    expect(searchKnowledge).toHaveBeenNthCalledWith(1, ctx.organizationId, 'pricing', 'Quais são os benefícios?', 3, 0.4);
    expect(searchKnowledge).toHaveBeenNthCalledWith(2, ctx.organizationId, 'default', 'Quais são os benefícios?', 3, 0.4);
    expect((res.output as any).search).toMatchObject({ fallbackUsed: true, emptyReason: 'no_matches' });
  });

  it('context.summarize summarizes when message limit reached', async () => {
    const ctx = createTestContext({
      messages: Array.from({ length: 35 }, (_, i) => ({ id: `m${i}`, text: `Mensagem ${i}`, fromMe: false })),
    });
    const services = createTestServices();
    const res = await executors['context.summarize'](ctx, { afterMessages: 30 }, services);
    expect(res.port).toBe('next');
    expect((res.output as any).summarized).toBe(true);
  });

  // --- AGENT ---
  it('agent.decide calls LLM and outputs decision with tokens', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const decide = vi.spyOn(services.llm, 'decide');
    const res = await executors['agent.decide'](
      ctx,
      { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Decida', system: 'Regra específica do fluxo' },
      services
    );
    expect(res.port).toBe('next');
    expect((res.output as any).reply).toBeDefined();
    expect(res.tokens?.input).toBe(150);
    expect(res.tokens?.output).toBe(45);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ system: 'Regra específica do fluxo' }));
  });

  it('agent.classify classifies intent', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['agent.classify'](
      ctx,
      { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Classifique' },
      services
    );
    expect(res.port).toBe('next');
    expect((res.variables?.decision as any).intent).toBe('interesse');
  });

  it('agent.extract extracts lead data', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['agent.extract'](
      ctx,
      { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Extraia' },
      services
    );
    expect(res.port).toBe('next');
    expect((res.variables?.decision as any).lead_data).toBeDefined();
  });

  it('agent.score scores lead', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['agent.score'](
      ctx,
      { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Pontue' },
      services
    );
    expect(res.port).toBe('next');
    expect((res.variables?.decision as any).score).toBe(75);
  });

  // --- FLOW CONTROL ---
  it('flow.condition tests equals, not_equals, contains, greater_than', async () => {
    const ctx = createTestContext({
      variables: {
        status: 'active',
        score: 85,
        notes: 'Cliente quer atendimento prioritario',
      },
    });
    const services = createTestServices();

    const eq = await executors['flow.condition'](
      ctx,
      { variable: 'status', operator: 'equals', value: 'active' },
      services
    );
    expect(eq.port).toBe('true');

    const neq = await executors['flow.condition'](
      ctx,
      { variable: 'status', operator: 'not_equals', value: 'inactive' },
      services
    );
    expect(neq.port).toBe('true');

    const contains = await executors['flow.condition'](
      ctx,
      { variable: 'notes', operator: 'contains', value: 'prioritario' },
      services
    );
    expect(contains.port).toBe('true');

    const gt = await executors['flow.condition'](
      ctx,
      { variable: 'score', operator: 'greater_than', value: '70' },
      services
    );
    expect(gt.port).toBe('true');
  });

  it('flow.switch routes to matching case port', async () => {
    const ctx = createTestContext({
      variables: { intent: 'suporte' },
    });
    const services = createTestServices();
    const res = await executors['flow.switch'](
      ctx,
      { variable: 'intent', cases: ['vendas', 'suporte', 'financeiro'] },
      services
    );
    expect(res.port).toBe('suporte');
  });

  it('flow.switch falls back to default port', async () => {
    const ctx = createTestContext({
      variables: { intent: 'desconhecido' },
    });
    const services = createTestServices();
    const res = await executors['flow.switch'](
      ctx,
      { variable: 'intent', cases: ['vendas', 'suporte'] },
      services
    );
    expect(res.port).toBe('default');
  });

  it('flow.delay produces next port', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['flow.delay'](ctx, { seconds: 2 }, services);
    expect(res.port).toBe('next');
  });

  it('flow.wait_reply suspends when not resumed', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['flow.wait_reply'](ctx, { timeoutMinutes: 60 }, services);
    expect(res.suspend).toBe(true);
    expect(res.port).toBe('reply');
  });

  it('flow.wait_reply resumes via reply or timeout port', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const resReply = await executors['flow.wait_reply'](ctx, { timeoutMinutes: 60 }, services, 'reply');
    expect(resReply.suspend).toBe(false);
    expect(resReply.port).toBe('reply');

    const resTimeout = await executors['flow.wait_reply'](ctx, { timeoutMinutes: 60 }, services, 'timeout');
    expect(resTimeout.suspend).toBe(false);
    expect(resTimeout.port).toBe('timeout');
  });

  // --- ACTIONS ---
  it('action.update_stage updates valid stage transition', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['action.update_stage'](
      ctx,
      { stage: 'QUALIFYING' },
      services
    );
    expect(res.port).toBe('next');
    expect((res.output as any).updated).toBe(true);
    expect(ctx.conversation?.stage).toBe('QUALIFYING');
    expect(services.db?.updateConversation).toHaveBeenCalled();
  });

  it('action.update_stage rejects invalid stage transition', async () => {
    const ctx = createTestContext({
      conversation: { id: 'c1', stage: 'NEW_CONVERSATION', bot_paused: false, handled_by: 'AI' },
    });
    const services = createTestServices();
    const res = await executors['action.update_stage'](
      ctx,
      { stage: 'CONVERTED' }, // Can't go directly from NEW_CONVERSATION to CONVERTED
      services
    );
    expect(res.port).toBe('next');
    expect((res.output as any).updated).toBe(false);
    expect(ctx.conversation?.stage).toBe('NEW_CONVERSATION');
  });

  it('action.update_lead updates lead memory and fields', async () => {
    const ctx = createTestContext({
      variables: {
        decision: {
          lead_data: { city: 'Campinas', urgency: 'imediata' },
        },
      },
    });
    const services = createTestServices();
    const res = await executors['action.update_lead'](
      ctx,
      { source: 'decision.lead_data' },
      services
    );
    expect(res.port).toBe('next');
    expect(ctx.lead?.city).toBe('Campinas');
    expect(services.db?.updateLead).toHaveBeenCalled();
  });

  it('action.update_lead bounds commercial notes to a concise non-growing value', async () => {
    const ctx = createTestContext({
      variables: {
        decision: {
          lead_data: { notes: 'x'.repeat(260) },
        },
      },
    });
    const services = createTestServices();

    await executors['action.update_lead'](ctx, { source: 'decision.lead_data' }, services);

    expect((ctx.lead?.memory as any).notes).toHaveLength(200);
  });

  it('action.crm_sync creates/syncs deal', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['action.crm_sync'](ctx, {}, services);
    expect(res.port).toBe('next');
    expect(services.db?.syncDeal).toHaveBeenCalled();
  });

  it('action.handoff pauses bot and sets human takeover', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['action.handoff'](ctx, { reason: 'Lead solicitou especialista' }, services);
    expect(res.port).toBe('next');
    expect(ctx.conversation?.bot_paused).toBe(true);
    expect(ctx.conversation?.handled_by).toBe('HUMAN');
    expect(ctx.conversation?.stage).toBe('HUMAN_HANDOFF');
    expect(services.db?.updateConversation).toHaveBeenCalled();
  });

  it('action.webhook executes HTTP call', async () => {
    const ctx = createTestContext();
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const services = createTestServices({ fetch: mockFetch });
    const res = await executors['action.webhook'](
      ctx,
      { url: 'https://webhook.site/test', method: 'POST' },
      services
    );
    expect(res.port).toBe('next');
    expect(mockFetch).toHaveBeenCalled();
    expect((res.variables?.webhookResponse as any).success).toBe(true);
  });

  // --- OUTPUT ---
  it('output.send_text interpolates variable and sends outbound message', async () => {
    const ctx = createTestContext({
      variables: {
        decision: { reply: 'Olá João Silva, como posso te ajudar hoje?' },
      },
    });
    const services = createTestServices();
    const res = await executors['output.send_text'](
      ctx,
      { text: '{{decision.reply}}', typing: true },
      services
    );
    expect(res.port).toBe('next');
    expect(services.messaging.sendText).toHaveBeenCalledWith(
      ctx.connectionId,
      ctx.lead!.phone,
      'Olá João Silva, como posso te ajudar hoje?',
      { typing: true }
    );
    expect(services.db?.saveMessage).toHaveBeenCalled();
  });

  it('output.send_media sends media outbound', async () => {
    const ctx = createTestContext({
      variables: {
        mediaUrl: 'https://example.com/tabela.pdf',
      },
    });
    const services = createTestServices();
    const res = await executors['output.send_media'](
      ctx,
      { url: '{{mediaUrl}}', mediaType: 'document', caption: 'Tabela de preços' },
      services
    );
    expect(res.port).toBe('next');
    expect(services.messaging.sendMedia).toHaveBeenCalled();
  });

  it('output.send_template sends template', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['output.send_template'](
      ctx,
      { name: 'boas_vindas', language: 'pt_BR' },
      services
    );
    expect(res.port).toBe('next');
    expect(services.messaging.sendTemplate).toHaveBeenCalled();
  });

  it('output.end finishes flow', async () => {
    const ctx = createTestContext();
    const services = createTestServices();
    const res = await executors['output.end'](ctx, {}, services);
    expect(res.port).toBe('');
    expect((res.output as any).finished).toBe(true);
  });

  // --- CONTEXT: STORAGE ---
  describe('context.storage executor', () => {
    it('stores static text into configured variableName', async () => {
      const ctx = createTestContext();
      const services = createTestServices();
      const res = await executors['context.storage'](
        ctx,
        { content: 'Regra estática de negócio', variableName: 'regras' },
        services
      );
      expect(res.port).toBe('next');
      expect(res.variables?.regras).toBe('Regra estática de negócio');
      expect(res.output.isDynamic).toBe(false);
    });

    it('stores dynamic content by interpolating template variables', async () => {
      const ctx = createTestContext({
        lead: {
          id: 'l1',
          name: 'Maria Fernandes',
          city: 'Passo Fundo',
          phone: '5554999990000',
        },
      });
      const services = createTestServices();
      const res = await executors['context.storage'](
        ctx,
        {
          content: 'Lead {{lead.name}} da cidade {{lead.city}}',
          variableName: 'info_lead',
        },
        services
      );
      expect(res.port).toBe('next');
      expect(res.variables?.info_lead).toBe('Lead Maria Fernandes da cidade Passo Fundo');
      expect(res.output.isDynamic).toBe(true);
    });

    it('stores direct dynamic object reference preserving data structure', async () => {
      const ctx = createTestContext({
        variables: {
          pacote: { tipo: 'Smart', valor: 69.90, dependentes: 5 },
        },
      });
      const services = createTestServices();
      const res = await executors['context.storage'](
        ctx,
        {
          content: '{{pacote}}',
          variableName: 'dados_pacote',
        },
        services
      );
      expect(res.port).toBe('next');
      expect(res.variables?.dados_pacote).toEqual({ tipo: 'Smart', valor: 69.90, dependentes: 5 });
      expect(res.output.isDynamic).toBe(true);
    });

    it('parses dynamic JSON templates into object', async () => {
      const ctx = createTestContext({
        lead: {
          id: 'l2',
          name: 'Carlos Santos',
          phone: '5555988887777',
        },
      });
      const services = createTestServices();
      const res = await executors['context.storage'](
        ctx,
        {
          content: '{"cliente": "{{lead.name}}", "status": "ativo"}',
          variableName: 'payload_cliente',
        },
        services
      );
      expect(res.port).toBe('next');
      expect(res.variables?.payload_cliente).toEqual({ cliente: 'Carlos Santos', status: 'ativo' });
      expect(res.output.isDynamic).toBe(true);
    });

    it('respects custom outputPorts', async () => {
      const ctx = createTestContext();
      const services = createTestServices();
      const res = await executors['context.storage'](
        ctx,
        {
          content: 'ok',
          variableName: 'flag',
          outputPorts: ['sucesso', 'falha'],
        },
        services
      );
      expect(res.port).toBe('sucesso');
    });
  });
});
