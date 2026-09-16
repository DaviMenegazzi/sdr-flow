import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createBlankFlow } from '../packages/flow/src/index.js';
import { encryptCredentials } from '../packages/db/src/index.js';
import { processTurn } from '../packages/runtime/src/turns/turn-processor.js';
import { InMemoryExecutionEventBus } from '../packages/runtime/src/events/event-publisher.js';
import { InMemoryDebugRegistry } from '../packages/runtime/src/debug/debug-registry.js';
import { InMemoryTraceSink } from '../packages/runtime/src/trace/trace-sink.js';
import type { RealtimeEventV1 } from '../packages/shared/src/index.js';

// Group-identity path of processTurn (plan items 1-2 and 7): a group's title must never come
// from the sending participant's pushName, must prefer a real Evolution-confirmed name over the
// "Grupo • <id>" placeholder, and inbox:message.created must carry message_type. Deliberately its
// own file/mock rather than extending tests/turn-processor-realtime.test.ts's buildMockDb, which
// has no 'leads' table branch (syncGroupIdentity's UPDATE) and always feeds a non-group payload.

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

function buildMockDb(opts: { organizationId: string; connectionId: string; flowVersionId: string; flowId: string; persistedGroupSubject?: string | null }) {
  const inboundEventsById = new Map<string, any>();
  const messagesByProviderId = new Map<string, { id: string; created_at: string }>();
  let conversationRow: any = null;
  const leadUpdates: Array<Record<string, unknown>> = [];

  const db: any = {
    from: (table: string) => {
      if (table === 'inbound_events') {
        return { select: () => chain({ data: [...inboundEventsById.values()], error: null }) };
      }
      if (table === 'leads') {
        return {
          update: (patch: Record<string, unknown>) => {
            leadUpdates.push(patch);
            return chain({ data: null, error: null });
          },
        };
      }
      if (table === 'messages') {
        // saveMessage's post-insert metadata UPDATE (sender_name/sender_jid) when the RPC insert
        // itself doesn't carry them — see packages/db/src/conversation-repository.ts.
        return { update: () => chain({ data: null, error: null }) };
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
        return { select: () => chain({ count: 999, error: null }) };
      }
      if (table === 'ai_agents') {
        return { select: () => chain({ data: { model: 'gpt-4.1-mini' }, error: null }) };
      }
      // 'connections' is deliberately unmocked: resolveGroupSubject's ConnectionRepository call
      // throws, exercising "Evolution unreachable" without extra mock surface — it's caught
      // internally and must never fail the turn.
      throw new Error(`Unexpected table in mock: ${table}`);
    },
    rpc: (name: string, args: any) => {
      if (name === 'find_or_create_lead') {
        return Promise.resolve({
          data: [{ id: randomUUID(), phone: args.p_phone, name: args.p_name, memory: {}, group_subject: opts.persistedGroupSubject ?? null }],
          error: null,
        });
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
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'get_agent_openai_key') {
        return Promise.resolve({ data: encryptCredentials({ apiKey: 'sk-test-agent-key' }), error: null });
      }
      throw new Error(`Unexpected rpc in mock: ${name}`);
    },
  };

  return {
    db,
    leadUpdates,
    addInboundEvent(input: { providerMessageId: string; remoteJid: string; isGroup: boolean; groupName?: string; senderName?: string; senderJid?: string; messageType?: string }) {
      const id = randomUUID();
      const phone = input.isGroup ? input.remoteJid.replace(/@g\.us$/, '') : input.remoteJid.replace(/@.*/, '');
      inboundEventsById.set(id, {
        id,
        created_at: new Date().toISOString(),
        provider_message_id: input.providerMessageId,
        normalized_payload: {
          remoteJid: input.remoteJid,
          phone,
          textContent: 'oi',
          messageType: input.messageType || 'text',
          fromMe: false,
          isGroup: input.isGroup,
          groupName: input.groupName,
          senderName: input.senderName,
          senderJid: input.senderJid,
        },
      });
      return id;
    },
  };
}

describe('processTurn — identidade de grupo e message_type no realtime', () => {
  beforeAll(() => { vi.stubEnv('ENCRYPTION_KEY', 'test-only-credential-encryption-key'); });

  it('never uses the sending participant\'s pushName as the group title', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent, leadUpdates } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId });
    const eventId = addInboundEvent({
      providerMessageId: 'wa-group-1',
      remoteJid: '120363202896190096@g.us',
      isGroup: true,
      groupName: 'Lobos do Varejo',
      senderName: 'Emanuel Sperotto',
      senderJid: '5511911111111@s.whatsapp.net',
    });

    const result = await processTurn(
      { db, runtimeConfig: {}, eventPublisher: new InMemoryExecutionEventBus(), debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() },
      { organizationId, connectionId, flowVersionId, agentId: randomUUID(), inboundEventIds: [eventId], isCurrent: async () => true }
    );

    expect(result.status).toBe('executed');
    expect(leadUpdates).toHaveLength(1);
    expect(leadUpdates[0]).toMatchObject({ is_group: true, group_subject: 'Lobos do Varejo', name: 'Lobos do Varejo' });
    expect(leadUpdates[0]!.name).not.toBe('Emanuel Sperotto');
    // A real (payload-sourced) name counts as synced, not the placeholder.
    expect(leadUpdates[0]!.group_subject_synced_at).toBeTruthy();
  });

  it('falls back to "Grupo • <id>" — never the participant name — when Evolution cannot be reached and nothing is cached yet', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent, leadUpdates } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId, persistedGroupSubject: null });
    const eventId = addInboundEvent({
      providerMessageId: 'wa-group-2',
      remoteJid: '120363202896190097@g.us',
      isGroup: true,
      groupName: undefined,
      senderName: 'Davi',
      senderJid: '5511922222222@s.whatsapp.net',
    });

    const result = await processTurn(
      { db, runtimeConfig: {}, eventPublisher: new InMemoryExecutionEventBus(), debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() },
      { organizationId, connectionId, flowVersionId, agentId: randomUUID(), inboundEventIds: [eventId], isCurrent: async () => true }
    );

    expect(result.status).toBe('executed');
    expect(leadUpdates).toHaveLength(1);
    expect(leadUpdates[0]).toMatchObject({ is_group: true, group_subject: 'Grupo • 120363202896190097', name: 'Grupo • 120363202896190097' });
    // The placeholder is not a confirmed name, so it must not be recorded as synced.
    expect(leadUpdates[0]!.group_subject_synced_at).toBeUndefined();
  });

  it('includes message_type on the inbox:message.created realtime payload', async () => {
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const flowVersionId = randomUUID();
    const flowId = randomUUID();
    const { db, addInboundEvent } = buildMockDb({ organizationId, connectionId, flowVersionId, flowId });
    const eventId = addInboundEvent({
      providerMessageId: 'wa-audio-1',
      remoteJid: '5511999999999@s.whatsapp.net',
      isGroup: false,
      messageType: 'audio',
    });

    const eventBus = new InMemoryExecutionEventBus();
    const received: RealtimeEventV1[] = [];
    await eventBus.subscribe(event => { if ('schemaVersion' in event) received.push(event as RealtimeEventV1); });

    await processTurn(
      { db, runtimeConfig: {}, eventPublisher: eventBus, debugRegistry: new InMemoryDebugRegistry(), traceSink: new InMemoryTraceSink() },
      { organizationId, connectionId, flowVersionId, agentId: randomUUID(), inboundEventIds: [eventId], isCurrent: async () => true }
    );

    const messageEvent = received.find(e => e.type === 'inbox:message.created');
    expect(messageEvent).toBeDefined();
    expect((messageEvent!.payload as any).message_type).toBe('audio');
  });
});
