import { describe, expect, it, vi } from 'vitest';
import { executors, GoogleCalendarClient, MockLLMProvider, portsFor, type FlowServices } from '../packages/flow/src/index.js';
import type { FlowContext } from '../packages/shared/src/index.js';

function context(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    organizationId: '11111111-1111-1111-1111-111111111111',
    connectionId: '22222222-2222-2222-2222-222222222222',
    leadId: '33333333-3333-3333-3333-333333333333',
    conversationId: '44444444-4444-4444-4444-444444444444',
    executionId: '55555555-5555-5555-5555-555555555555',
    flowVersionId: '66666666-6666-6666-6666-666666666666',
    lead: {
      id: '33333333-3333-3333-3333-333333333333',
      phone: '5555999998888',
      name: 'Carlos',
      city: 'Ijuí',
      interest: 'consulta',
      memory: {
        custom_fields: {
          specialty: 'Oftalmologia',
          desired_day: 'segunda-feira',
          desired_period: 'tarde',
        },
      },
    },
    conversation: { id: '44444444-4444-4444-4444-444444444444', stage: 'QUALIFYING', bot_paused: false, handled_by: 'AI' },
    messages: [{ id: 'm1', text: 'Quero agendar uma consulta', fromMe: false }],
    variables: {},
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

function services(overrides: Partial<FlowServices> = {}): FlowServices {
  return {
    llm: new MockLLMProvider(),
    messaging: {
      sendText: vi.fn().mockResolvedValue({ messageId: 'message-id' }),
      sendMedia: vi.fn().mockResolvedValue({ messageId: 'media-id' }),
      sendTemplate: vi.fn().mockResolvedValue({ messageId: 'template-id' }),
    },
    db: {
      updateLead: vi.fn().mockResolvedValue(undefined),
      updateConversation: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue({ id: 'saved-id' }),
      syncDeal: vi.fn().mockResolvedValue({ id: 'deal-id' }),
    },
    now: () => new Date('2026-09-08T14:30:00.000Z'),
    ...overrides,
  };
}

const calendarService = (http: typeof fetch) => new GoogleCalendarClient(http, { access_token: 'test-access-token' });

describe('Sales action node contracts', () => {
  it('exposes the explicit branch ports from the specification', () => {
    expect(portsFor('flow.required_fields', {})).toEqual(['complete', 'missing']);
    expect(portsFor('guard.response_policy', {})).toEqual(['pass', 'rewrite', 'blocked']);
    expect(portsFor('calendar.availability', {})).toEqual(['available', 'unavailable', 'error']);
    expect(portsFor('calendar.create_event', {})).toEqual(['created', 'error']);
    expect(portsFor('calendar.reschedule_event', {})).toEqual(['rescheduled', 'error']);
    expect(portsFor('calendar.cancel_event', {})).toEqual(['cancelled', 'error']);
  });

  it('flow.required_fields finds nested memory fields and reports only what is missing', async () => {
    const ctx = context();
    const result = await executors['flow.required_fields'](ctx, {
      required: ['city', 'specialty', 'email'],
      optional: ['desired_day', 'desired_period'],
    }, services());
    expect(result.port).toBe('missing');
    expect(result.variables?.required_fields).toEqual({
      complete: false,
      missing: ['email'],
      missing_count: 1,
      optional_available: ['desired_day', 'desired_period'],
    });
  });

  it('agent.next_action asks for the known missing field without spending LLM tokens', async () => {
    const ctx = context({ variables: { required_fields: { complete: false, missing: ['city'], missing_count: 1 } } });
    const llm = new MockLLMProvider();
    const structured = vi.spyOn(llm, 'structured');
    const result = await executors['agent.next_action'](ctx, {
      provider: 'openai', model: 'default', prompt: 'Decida', allowedActions: ['ASK_MISSING_FIELD', 'CHECK_CALENDAR'],
    }, services({ llm }));
    expect(result.output).toMatchObject({ action: 'ASK_MISSING_FIELD', field: 'city' });
    expect(structured).not.toHaveBeenCalled();
    expect(result.tokens).toBeUndefined();
  });

  it('agent.next_action validates and stores the structured commercial action', async () => {
    const llm = new MockLLMProvider();
    vi.spyOn(llm, 'structured').mockResolvedValue({
      data: { action: 'CHECK_CALENDAR', field: '', reason: 'Dados completos e intenção de agendar.' },
      inputTokens: 20,
      outputTokens: 8,
    });
    const result = await executors['agent.next_action'](context(), {
      provider: 'openai', model: 'default', prompt: 'Decida', allowedActions: ['CHECK_CALENDAR', 'HANDOFF'],
    }, services({ llm }));
    expect(result.port).toBe('next');
    expect(result.variables?.next_action).toEqual({
      action: 'CHECK_CALENDAR', field: null, reason: 'Dados completos e intenção de agendar.',
    });
    expect(result.tokens).toEqual({ input: 20, output: 8 });
  });

  it('context.conversation_state persists structured state in lead memory', async () => {
    const ctx = context({ variables: { next_action: { action: 'CHECK_CALENDAR' } } });
    const svc = services();
    const result = await executors['context.conversation_state'](ctx, {
      stage: 'SCHEDULING', lastAction: '{{next_action.action}}', nextExpectedInput: 'selected_slot',
    }, svc);
    expect(result.port).toBe('next');
    expect(result.output).toMatchObject({ stage: 'SCHEDULING', last_action: 'CHECK_CALENDAR', next_expected_input: 'selected_slot', persisted: true });
    expect((ctx.lead?.memory as any).custom_fields.conversation_state.stage).toBe('SCHEDULING');
    expect(svc.db?.updateLead).toHaveBeenCalledWith(ctx.organizationId, ctx.leadId, expect.objectContaining({ memory: ctx.lead?.memory }));
  });

  it('guard.response_policy requests rewrite for a question whose answer is already known', async () => {
    const result = await executors['guard.response_policy'](context(), {
      text: 'Qual é a sua cidade?', maxCharacters: 700, knownFields: ['city'], blockedTerms: [], requireGroundedPrice: true,
    }, services());
    expect(result.port).toBe('rewrite');
    expect((result.output as any).violations).toContain('known_field_question:city');
  });

  it('guard.response_policy blocks a price not supported by knowledge', async () => {
    const ctx = context({ variables: { knowledgeSnippets: ['A consulta possui valores definidos por unidade.'] } });
    const result = await executors['guard.response_policy'](ctx, {
      text: 'A consulta custa R$ 90.', maxCharacters: 700, knownFields: [], blockedTerms: [], requireGroundedPrice: true,
    }, services());
    expect(result.port).toBe('blocked');
    expect((result.output as any).violations).toContain('ungrounded_price:90');
  });

  it('output.smart_message sends at most three complete bubbles and persists each one', async () => {
    const svc = services();
    const message = 'Temos três opções disponíveis para você. A primeira atende pela manhã e inclui avaliação inicial. A segunda funciona à tarde e possui retorno incluso. Qual dessas opções combina melhor com a sua rotina?';
    const result = await executors['output.smart_message'](context(), {
      text: message, typing: true, maxBubbles: 3, maxCharactersPerBubble: 80,
    }, svc);
    const output = result.output as any;
    expect(output.sent).toBe(true);
    expect(output.bubble_count).toBeGreaterThan(1);
    expect(output.bubble_count).toBeLessThanOrEqual(3);
    expect(output.bubbles.join(' ')).toBe(message);
    expect(svc.messaging.sendText).toHaveBeenCalledTimes(output.bubble_count);
    expect(svc.db?.saveMessage).toHaveBeenCalledTimes(output.bubble_count);
  });
});

describe('Google Calendar sales nodes', () => {
  it('calendar.availability returns actual free slots and calendar metadata', async () => {
    const http = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/events?')) {
        return new Response(JSON.stringify({ items: [{
          id: 'busy-1',
          start: { dateTime: '2026-09-14T15:00:00.000Z' },
          end: { dateTime: '2026-09-14T15:30:00.000Z' },
        }] }), { status: 200 });
      }
      if (url.includes('/calendars/primary')) return new Response(JSON.stringify({ summary: 'Agenda Vida Card' }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'unexpected request' } }), { status: 500 });
    }) as typeof fetch;
    const result = await executors['calendar.availability'](context(), {
      calendarId: 'primary', date: 'segunda-feira', period: 'tarde', durationMinutes: 30,
      timezone: 'America/Sao_Paulo', daysAhead: 14,
    }, services({ calendar: calendarService(http) }));
    expect(result.port).toBe('available');
    expect((result.variables?.calendar as any).calendar_name).toBe('Agenda Vida Card');
    expect((result.variables?.calendar as any).slots).not.toContain('12:00');
    expect((result.variables?.calendar as any).slots).toContain('12:30');
    expect((result.variables?.calendar as any).first_available).toBe('2026-09-14T15:30:00.000Z');
  });

  it('calendar.create_event creates a real event and stores canonical variables', async () => {
    const http = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'evt-1', htmlLink: 'https://calendar.test/evt-1', start: body.start, end: body.end }), { status: 200 });
    }) as typeof fetch;
    const result = await executors['calendar.create_event'](context(), {
      calendarId: 'primary', start: '2026-09-14T17:00:00.000Z', durationMinutes: 30,
      timezone: 'America/Sao_Paulo', title: 'Consulta - {{lead.name}}', description: 'Oftalmologia',
      leadName: '{{lead.name}}', leadPhone: '{{lead.phone}}',
    }, services({ calendar: calendarService(http) }));
    expect(result.port).toBe('created');
    expect(result.variables?.calendar).toMatchObject({ event_id: 'evt-1', start: '2026-09-14T17:00:00.000Z', end: '2026-09-14T17:30:00.000Z' });
  });

  it('calendar.reschedule_event patches the selected event', async () => {
    const http = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'evt-1', start: body.start, end: body.end }), { status: 200 });
    }) as typeof fetch;
    const result = await executors['calendar.reschedule_event'](context(), {
      calendarId: 'primary', eventId: 'evt-1', newStart: '2026-09-15T18:00:00.000Z',
      durationMinutes: 60, timezone: 'America/Sao_Paulo',
    }, services({ calendar: calendarService(http) }));
    expect(result.port).toBe('rescheduled');
    expect(result.variables?.calendar).toMatchObject({ event_id: 'evt-1', end: '2026-09-15T19:00:00.000Z', rescheduled: true });
  });

  it('calendar.cancel_event only reports cancellation after HTTP 204', async () => {
    const http = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const result = await executors['calendar.cancel_event'](context(), {
      calendarId: 'primary', eventId: 'evt-1', reason: 'Lead pediu cancelamento',
    }, services({ calendar: calendarService(http) }));
    expect(result.port).toBe('cancelled');
    expect(result.output).toMatchObject({ event_id: 'evt-1', cancelled: true });
  });

  it('routes missing Google credentials to error instead of simulating success', async () => {
    const http = vi.fn() as typeof fetch;
    const result = await executors['calendar.cancel_event'](context(), {
      calendarId: 'primary', eventId: 'evt-1', reason: '',
    }, services({ calendar: undefined }));
    expect(result.port).toBe('error');
    expect(http).not.toHaveBeenCalled();
  });
});
