import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createBlankFlow } from '../packages/flow/src/index.js';
import { encryptCredentials } from '../packages/db/src/index.js';
import { processTurn } from '../packages/runtime/src/turns/turn-processor.js';
import { InMemoryExecutionEventBus } from '../packages/runtime/src/events/event-publisher.js';
import { InMemoryDebugRegistry } from '../packages/runtime/src/debug/debug-registry.js';
import { InMemoryTraceSink } from '../packages/runtime/src/trace/trace-sink.js';
import type { RealtimeEventV1 } from '../packages/shared/src/index.js';

// Fase 5 (11.1/11.6.1-2): processTurn is where inbound-lead-message and new-conversation
// realtime events actually originate. Exercised with a mocked Supabase-JS-shaped client (the
// established pattern for this runtime — see tests/turn-recovery.test.ts) rather than PGlite,
// since ConversationRepository/ExecutionRepository speak only the .from()/.rpc() API, not raw
// SQL (see docs' own Phase 0 finding on this).

function chain(result: any) {
  const obj: any = {
    select: () => obj,
    insert: () => obj,
    update: () => obj,
    eq: () => obj,
    in: () => obj,
    not: () => obj,
    order: () => obj,
    limit: () => obj,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}

function buildMockDb(opts: { organizationId: string; connectionId: string; flowVersionId: string; flowId: string; hasOpenaiKey?: boolean }) {
  const inboundEventsById = new Map<string, any>();
  const messagesByProviderId = new Map<string, { id: string; created_at: string }>();
  let conversationRow: any = null;
  const marks: Array<{ eventId: string; status: string }> = [];

  const db: any = {
    from: (table: string) => {
      if (table === 'inbound_events') {
        return { select: () => chain({ data: [...inboundEventsById.values()], error: null }) };
      }
      if (table === 'conversations') {
        return {
          select: () => chain({ data: conversationRow, error: null }),
          insert: (row: any) => ({
            select: () => chain({
              data: (conversationRow = { id: randomUUID(), ...row, last_message_at: null }),
              error: null,
            }),
          }),
        };
      }
      if (table === 'flow_versions') {
        return { select: () => chain({ data: { id: opts.flowVersionId, flow_id: opts.flowId, graph: createBlankFlow() }, error: null }) };
      }
      if (table === 'flows') {
        return { select: () => chain({ data: { id: opts.flowId, name: 'Fluxo de teste' }, error: null }) };
      }
      if (table === 'flow_executions') {
        return {
          insert: () => ({ select: () => chain({ data: { id: randomUUID(), organization_id: opts.organizationId }, error: null }) }),
          update: () => chain({ data: { id: randomUUID() }, error: null }),
        };
      }
      if (table === 'flow_execution_steps') {
        // Reports as already caught-up so waitForTraceCompletion never sleeps in this test.
        return { select: () => chain({ count: 999, error: null }) };
      }
      if (table === 'calendar_accounts') {
        return { select: () => chain({ data: null, error: null }) };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
    rpc: (name: string, args: any) => {
      if (name === 'find_or_create_lead') {
        return Promise.resolve({ data: [{ id: randomUUID(), phone: args.p_phone, name: args.p_name, memory: {} }], error: null });
      }
      if (name === 'save_inbound_message') {
        const key = args.p_provider_message_id;
        const existing = key ? messagesByProviderId.get(key) : undefined;
        if (existing) return Promise.resolve({ data: [{ ...existing, is_new: false }], error: null });
        const row = { id: randomUUID(), created_at: new Date().toISOString() };
        if (key) messagesByProviderId.set(key, row);
        return Promise.resolve({ data: [{ ...row, is_new: true }], error: null });
      }
      if (name === 'mark_inbound_event_status') {
        marks.push({ eventId: args.p_event_id, status: args.p_status });
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'get_agent_openai_key') {
        if (opts.hasOpenaiKey === false) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: encryptCredentials({ apiKey: 'sk-test-agent-key' }), error: null });
      }
      throw new Error(`Unexpected rpc in mock: ${name}`);
    },
  };

  return {
    db,
    marks,
    addInboundEvent(providerMessageId: string, phone = '5511999999999') {
      const id = randomUUID();
      inboundEventsById.set(id, {
        id,
        created_at: new Date().toISOString(),
        provider_message_id: providerMessageId,
        normalized_payload: { remoteJid: `${phone}@s.whatsapp.net`, phone, textContent: 'oi', messageType: 'text', fromMe: false },
      });
      return id;
    },
  };
}

describe('processTurn — eventos realtime do inbox (Fase 5)', () => {
  beforeAll(() => { vi.stubEnv('ENCRYPTION_KEY', 'test-only-credential-encryption-key'); });

  it('emits inbox:conversation.created and inbox:message.created for a brand-new conversation', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId });
    const eventId = addInboundEvent('wa-msg-1');

    const eventBus = new InMemoryExecutionEventBus();
    const received: RealtimeEventV1[] = [];
    await eventBus.subscribe(event => {
      if ('schemaVersion' in event) received.push(event as RealtimeEventV1);
    });

    const result = await processTurn(
      {
        db,
        runtimeConfig: {},
        eventPublisher: eventBus,
        debugRegistry: new InMemoryDebugRegistry(),
        traceSink: new InMemoryTraceSink(),
      },
      {
        organizationId,
        connectionId,
        flowVersionId,
        agentId: randomUUID(),
        inboundEventIds: [eventId],
        isCurrent: async () => true,
      }
    );

    expect(result.status).toBe('executed');

    const created = received.find(e => e.type === 'inbox:conversation.created');
    expect(created).toBeDefined();
    expect(created!.organizationId).toBe(organizationId);
    expect(created!.schemaVersion).toBe(1);

    const messageEvents = received.filter(e => e.type === 'inbox:message.created');
    expect(messageEvents).toHaveLength(1);
    expect((messageEvents[0]!.payload as any).sender).toBe('lead');
    expect((messageEvents[0]!.payload as any).direction).toBe('INBOUND');
  });

  it('does not re-emit inbox:message.created for a retried delivery of the same provider message id (11.6.2)', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId });

    const eventBus = new InMemoryExecutionEventBus();
    const received: RealtimeEventV1[] = [];
    await eventBus.subscribe(event => {
      if ('schemaVersion' in event) received.push(event as RealtimeEventV1);
    });

    const deps = { db, runtimeConfig: {}, eventPublisher: eventBus, debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() };
    const agentId = randomUUID();
    const eventId1 = addInboundEvent('wa-msg-dup');
    await processTurn(deps, { organizationId, connectionId, flowVersionId, agentId, inboundEventIds: [eventId1], isCurrent: async () => true });

    // Second turn re-delivers the same provider_message_id (e.g. a retried webhook) —
    // save_inbound_message's idempotency means this is not a new row.
    const eventId2 = addInboundEvent('wa-msg-dup');
    await processTurn(deps, { organizationId, connectionId, flowVersionId, agentId, inboundEventIds: [eventId2], isCurrent: async () => true });

    const messageEvents = received.filter(e => e.type === 'inbox:message.created');
    expect(messageEvents).toHaveLength(1);

    // The conversation itself is only genuinely "created" once, too.
    const createdEvents = received.filter(e => e.type === 'inbox:conversation.created');
    expect(createdEvents).toHaveLength(1);
  });

  it('fails the turn instead of falling back to any shared key when the agent has no OpenAI key configured', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId, hasOpenaiKey: false });
    const eventId = addInboundEvent('wa-msg-no-key');

    const result = await processTurn(
      { db, runtimeConfig: {}, eventPublisher: new InMemoryExecutionEventBus(), debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() },
      { organizationId, connectionId, flowVersionId, agentId: randomUUID(), inboundEventIds: [eventId], isCurrent: async () => true }
    );

    expect(result.status).toBe('error');
    expect((result as any).reason).toBe('missing_openai_key');
  });

  it('fails the turn when no agentId was pinned at enqueue time (job predates this field)', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId });
    const eventId = addInboundEvent('wa-msg-legacy-job');

    const result = await processTurn(
      { db, runtimeConfig: {}, eventPublisher: new InMemoryExecutionEventBus(), debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() },
      { organizationId, connectionId, flowVersionId, inboundEventIds: [eventId], isCurrent: async () => true }
    );

    expect(result.status).toBe('error');
    expect((result as any).reason).toBe('no_agent_pinned');
  });
});
