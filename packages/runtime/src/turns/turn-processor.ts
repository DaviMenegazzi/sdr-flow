import { createHash } from 'node:crypto';
import { ConnectionRepository, ConversationRepository, ExecutionRepository, getAgentOpenAIKey, CalendarRepository } from '@sdr/db';
import type { FlowContext, FlowExecutionEvent } from '@sdr/shared';
import { executeFlow, HandoffService, type FlowServices, GoogleCalendarClient, type GoogleCalendarCredentials } from '@sdr/flow';
import { createRuntimeProviders, type RuntimeConfig } from '@sdr/flow/server';
import { fetchInboundEventsByIds, markInboundEventStatus, type ServiceDb } from '../inbound/inbound-event-repository.js';
import { resolveGroupSubject } from './group-subject-resolver.js';
import type { ExecutionEventPublisher } from '../events/event-publisher.js';
import { publishRealtimeEvent } from '../events/realtime-events.js';
import type { DebugRegistry, DebugFlowSnapshot } from '../debug/debug-registry.js';
import type { TraceSink } from '../trace/trace-sink.js';
import { waitForTraceCompletion } from '../trace/trace-completion.js';
import type { TurnResult } from './redis-buffer.js';

// The business logic previously inline in apps/api/src/webhook.ts's processInboundWebhook
// (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.5): connection/agent already resolved by the
// producer (the flow version arrives pinned, see ProcessTurnInput.flowVersionId — never
// re-resolved here, so a republish mid-debounce can't swap it), lead/conversation
// creation, message persistence, FlowContext/Services assembly, executeFlow, and
// finalization. Called either by apps/worker's BullMQ consumer (production) or directly,
// in-process, by apps/api when no worker is configured (dev only — see webhook.ts).

export interface TurnProcessorDeps {
  db: ServiceDb;
  runtimeConfig: RuntimeConfig;
  eventPublisher: ExecutionEventPublisher;
  debugRegistry: DebugRegistry;
  traceSink: TraceSink;
}

export interface ProcessTurnInput {
  organizationId: string;
  connectionId: string;
  /** Pinned at enqueue time — never re-resolved here (8.3.5: no version swap mid-turn). */
  flowVersionId?: string;
  flowId?: string;
  /** Pinned at enqueue time by resolveTurnFlow — which agent, and so which OpenAI key, runs this turn. */
  agentId?: string;
  inboundEventIds: string[];
  isCurrent: () => Promise<boolean>;
}

const SUPERSEDED_TURN_ERROR = 'conversation_turn_superseded';

async function markAll(db: ServiceDb, organizationId: string, ids: string[], status: 'processed' | 'failed', error?: string) {
  await Promise.all(ids.map(id => markInboundEventStatus(db, organizationId, id, status, error)));
}

// Fase 5 (11.1): best-effort publish of inbox:* realtime events, mirroring emitExecutionEvent's
// own non-blocking contract below — a live-view hiccup must never fail the turn itself.
function makeEmitRealtime(eventPublisher: ExecutionEventPublisher) {
  return async (input: Parameters<typeof publishRealtimeEvent>[1]) => {
    try {
      await publishRealtimeEvent(eventPublisher, input);
    } catch (err) {
      console.warn('[turn-processor] Falha ao publicar evento de tempo real do inbox (não bloqueante):', err);
    }
  };
}

export async function processTurn(deps: TurnProcessorDeps, input: ProcessTurnInput): Promise<TurnResult> {
  const { db, eventPublisher, debugRegistry, traceSink } = deps;
  const emitRealtime = makeEmitRealtime(eventPublisher);
  const stored = await fetchInboundEventsByIds(db, input.organizationId, input.inboundEventIds);
  if (stored.length === 0) return { status: 'empty' };

  const events = stored.map(row => ({ eventId: row.id, createdAt: row.createdAt, providerMessageId: row.providerMessageId, ...row.payload }));
  const lastEvent = events[events.length - 1]!;

  try {
    if (!input.flowVersionId) {
      await markAll(db, input.organizationId, input.inboundEventIds, 'failed', 'no_flow_version_pinned');
      return { status: 'error', reason: 'no_flow_version_pinned' };
    }

    const convRepo = new ConversationRepository(db);
    const execRepo = new ExecutionRepository(db);

    // A group is one inbox conversation keyed by its JID. Its title must never be populated
    // from pushName, which belongs to the latest participant who happened to send a message.
    const leadName = lastEvent.isGroup ? (lastEvent.groupName || null) : lastEvent.senderName;
    const lead = await convRepo.findOrCreateLead(input.organizationId, input.connectionId, lastEvent.phone, leadName);
    if (lastEvent.isGroup) {
      // Prefer whatever this delivery's own payload carried (cheapest, and self-heals a WhatsApp
      // rename the moment Evolution starts including it), then the name already persisted from a
      // prior turn (the cache: once resolved, later messages for the same group never hit
      // Evolution again), and only fall back to a live Evolution lookup — never the participant's
      // pushName — when neither is available yet.
      const payloadName = lastEvent.groupName?.trim() || null;
      const persistedName = lead.group_subject?.trim() || null;
      let resolvedName = payloadName || persistedName;
      let isRealName = Boolean(resolvedName);
      if (!resolvedName) {
        resolvedName = await resolveGroupSubject(db, input.organizationId, input.connectionId, lastEvent.remoteJid);
        isRealName = Boolean(resolvedName);
        if (!resolvedName) resolvedName = `Grupo • ${lastEvent.phone}`;
      }
      await convRepo.syncGroupIdentity(input.organizationId, lead.id, resolvedName, { synced: isRealName });
    }
    const sessionTimeoutMinutes = Number(process.env.SESSION_TIMEOUT_MINUTES) || 15;
    const conversation = await convRepo.findOrCreateConversation(input.organizationId, input.connectionId, lead.id, null, {
      sessionTimeoutMinutes,
      lead,
    });
    // A closed-and-reopened session only means the 15-minute message window reset — it says
    // nothing about how stale lead.memory (interest, city, ...) is. Past a much longer gap,
    // intelligence nodes get told to re-confirm that memory instead of silently acting on it
    // (e.g. jumping straight to "which city?" off a lead's days-old exam-scheduling interest).
    const reengagementGapMinutes = Number(process.env.SESSION_REENGAGEMENT_MINUTES) || 240;
    const resumedAfterGapMinutes = conversation.resumedAfterGapMinutes ?? null;
    const resumedAfterLongGap = resumedAfterGapMinutes !== null && resumedAfterGapMinutes >= reengagementGapMinutes;
    if (conversation.created) {
      await emitRealtime({
        type: 'inbox:conversation.created',
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        conversationId: conversation.id,
        payload: {
          id: conversation.id,
          stage: conversation.stage,
          bot_paused: conversation.bot_paused,
          handled_by: conversation.handled_by,
          last_message_at: conversation.last_message_at ?? null,
        },
      });
    }

    for (const incoming of events) {
      const savedInbound = await convRepo.saveMessage({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        sender: 'lead',
        content: incoming.textContent,
        messageType: incoming.messageType,
        senderName: incoming.senderName,
        senderJid: incoming.senderJid,
        // Dedup happened at accept time (inbound_events); this insert is itself idempotent by
        // provider_message_id (save_inbound_message), so a retry of this turn is still safe.
        providerMessageId: incoming.providerMessageId,
      });
      // Only a genuinely new row fires an event — a retried turn re-saving the same
      // provider_message_id must not duplicate the message on screen (11.6.2).
      if (savedInbound.created) {
        await emitRealtime({
          type: 'inbox:message.created',
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          conversationId: conversation.id,
          payload: {
            id: savedInbound.id,
            conversationId: conversation.id,
            sender: 'lead',
            direction: 'INBOUND',
            content: incoming.textContent,
            created_at: savedInbound.created_at,
            sender_name: incoming.senderName ?? null,
            sender_jid: incoming.senderJid ?? null,
            message_type: incoming.messageType ?? null,
          },
        });
      }
    }

    if (conversation.bot_paused) {
      await debugRegistry.failArmed(input.organizationId, conversation.id, {
        severity: 'error',
        code: 'bot_paused',
        message: 'A mensagem chegou, mas a IA está pausada nesta conversa.',
      });
      await markAll(db, input.organizationId, input.inboundEventIds, 'processed');
      return { status: 'logged_bot_paused', conversationId: conversation.id };
    }

    // Jobs enqueued before this field existed (24h buffer TTL, up to 12 retry attempts) may
    // still be in flight right after a deploy — fail loudly instead of guessing an agent.
    if (!input.agentId) {
      await debugRegistry.failArmed(input.organizationId, conversation.id, {
        severity: 'error',
        code: 'no_agent_pinned',
        message: 'Este turno foi enfileirado antes da vinculação de agente por chave própria. Será reprocessado ou pode ser reenviado.',
      });
      await markAll(db, input.organizationId, input.inboundEventIds, 'failed', 'no_agent_pinned');
      return { status: 'error', reason: 'no_agent_pinned', conversationId: conversation.id };
    }

    // Every agent authenticates to OpenAI with its own key — never a platform-wide shared
    // one (packages/db/src/agent-credentials.ts). No fallback here on purpose: silently
    // reusing another key would defeat the whole point of per-agent isolation. The model is
    // likewise the one configured for this agent (aba Agentes) — flow nodes no longer choose
    // a model themselves, so every intelligence node in this turn shares the agent's model,
    // which keeps cost accounting tied to the agent's own key.
    const [openaiApiKey, agentRow] = await Promise.all([
      getAgentOpenAIKey(db, input.agentId),
      db.from('ai_agents').select('model').eq('organization_id', input.organizationId).eq('id', input.agentId).maybeSingle(),
    ]);
    if (!openaiApiKey) {
      await debugRegistry.failArmed(input.organizationId, conversation.id, {
        severity: 'error',
        code: 'missing_openai_key',
        message: 'O agente desta instância ainda não tem uma chave da OpenAI configurada. Configure em Agentes antes de continuar.',
      });
      await markAll(db, input.organizationId, input.inboundEventIds, 'failed', 'missing_openai_key');
      return { status: 'error', reason: 'missing_openai_key', conversationId: conversation.id };
    }
    const openaiModel = agentRow.data?.model || deps.runtimeConfig.openaiModel;

    const { data: flowVersion } = await db
      .from('flow_versions')
      .select('*')
      .eq('organization_id', input.organizationId)
      .eq('id', input.flowVersionId)
      .single();

    if (!flowVersion?.graph) {
      await debugRegistry.failArmed(input.organizationId, conversation.id, {
        severity: 'error',
        code: 'invalid_flow_version',
        message: 'A versão publicada do fluxo não pôde ser carregada.',
      });
      await markAll(db, input.organizationId, input.inboundEventIds, 'failed', 'invalid_flow_version');
      return { status: 'invalid_flow_version', versionId: input.flowVersionId };
    }

    const { data: flow } = await db.from('flows').select('id, name').eq('organization_id', input.organizationId).eq('id', flowVersion.flow_id).maybeSingle();

    const turnIdempotencyKey = createHash('sha256')
      .update(JSON.stringify({ schemaVersion: 1, organizationId: input.organizationId, connectionId: input.connectionId, eventIds: [...input.inboundEventIds].sort(), flowVersionId: flowVersion.id }))
      .digest('hex');
    const execution = await execRepo.createExecution({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      flowVersionId: flowVersion.id,
      status: 'running',
      idempotencyKey: turnIdempotencyKey,
      connectionId: input.connectionId,
      leadId: lead.id,
      agentId: input.agentId,
      model: openaiModel,
    });

    const flowGraph = flowVersion.graph as any;
    const debugFlow: DebugFlowSnapshot = {
      id: flow?.id || flowVersion.flow_id,
      name: flow?.name || 'Fluxo publicado',
      version: `v${flowVersion.version}`,
      nodes: (flowGraph.nodes || []).map((node: any) => ({ id: node.id, type: node.type, label: node.label || node.type })),
      graph: flowGraph,
    };
    await debugRegistry.claim({ organizationId: input.organizationId, conversationId: conversation.id, executionId: execution.id, flow: debugFlow });
    const emitExecutionEvent = async (event: FlowExecutionEvent) => {
      await eventPublisher.publish(await debugRegistry.record({ ...event, conversationId: conversation.id }));
    };

    const flowCtx: FlowContext = {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      leadId: lead.id,
      conversationId: conversation.id,
      executionId: execution.id,
      flowVersionId: flowVersion.id,
      lead: {
        id: lead.id,
        phone: lead.phone,
        name: lead.name,
        city: lead.city,
        interest: lead.interest,
        urgency: lead.urgency,
        memory: (lead.memory as Record<string, unknown>) || {},
      },
      conversation: {
        id: conversation.id,
        stage: conversation.stage,
        bot_paused: conversation.bot_paused,
        handled_by: conversation.handled_by as any,
      },
      messages: events.map((incoming, index) => ({
        id: incoming.eventId || `${execution.id}-${index}`,
        text: incoming.textContent,
        fromMe: false,
        type: incoming.messageType,
        mediaUrl: incoming.mediaUrl ?? undefined,
      })),
      variables: {
        remoteJid: lastEvent.remoteJid,
        isGroup: Boolean(lastEvent.remoteJid?.endsWith('@g.us')),
        groupId: lastEvent.remoteJid?.endsWith('@g.us') ? lastEvent.remoteJid : undefined,
        senderPhone: lastEvent.phone,
        resumedAfterGapMinutes,
        resumedAfterLongGap,
      },
      tokens: { input: 0, output: 0 },
    };

    const runtimeProviders = createRuntimeProviders(
      { ...deps.runtimeConfig, openaiApiKey, openaiModel },
      id => new ConnectionRepository(db).resolveMessagingConnection(input.organizationId, id)
    );

    let orgCalendarCreds: GoogleCalendarCredentials | null = null;
    try {
      const calRepo = new CalendarRepository(db);
      orgCalendarCreds = await calRepo.resolveActiveAccountCredentials<GoogleCalendarCredentials>(input.organizationId, db);
    } catch {
      // Gracefully fall back to server environment calendar credentials
    }
    const activeCalendarClient = orgCalendarCreds
      ? new GoogleCalendarClient(globalThis.fetch, orgCalendarCreds)
      : runtimeProviders.calendar;
    const assertCurrent = async () => {
      if (!(await input.isCurrent())) throw new Error(SUPERSEDED_TURN_ERROR);
    };
    const guardedCalendar = activeCalendarClient
      ? {
          async getCalendarName(...args: Parameters<NonNullable<FlowServices['calendar']>['getCalendarName']>) { await assertCurrent(); return activeCalendarClient!.getCalendarName(...args); },
          async listEvents(...args: Parameters<NonNullable<FlowServices['calendar']>['listEvents']>) { await assertCurrent(); return activeCalendarClient!.listEvents(...args); },
          async createEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['createEvent']>) { await assertCurrent(); return activeCalendarClient!.createEvent(...args); },
          async updateEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['updateEvent']>) { await assertCurrent(); return activeCalendarClient!.updateEvent(...args); },
          async cancelEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['cancelEvent']>) { await assertCurrent(); return activeCalendarClient!.cancelEvent(...args); },
        }
      : undefined;
    const services: FlowServices = {
      ...runtimeProviders,
      messaging: {
        async sendText(...args) { await assertCurrent(); return runtimeProviders.messaging.sendText(...args); },
        async sendMedia(...args) { await assertCurrent(); return runtimeProviders.messaging.sendMedia(...args); },
        async sendTemplate(...args) { await assertCurrent(); return runtimeProviders.messaging.sendTemplate(...args); },
      },
      calendar: guardedCalendar,
      fetch: async (...args) => { await assertCurrent(); return globalThis.fetch(...args); },
      db: {
        updateLead: async (_org, leadId, patch) => { await convRepo.updateLead(_org, leadId, patch); },
        updateConversation: async (_org, convId, patch) => {
          const updated = await convRepo.updateConversation(_org, convId, patch);
          await emitRealtime({
            type: 'inbox:conversation.updated',
            organizationId: _org,
            connectionId: input.connectionId,
            conversationId: convId,
            payload: {
              id: updated.id,
              stage: updated.stage,
              bot_paused: updated.bot_paused,
              handled_by: updated.handled_by,
              last_message_at: updated.last_message_at,
            },
          });
        },
        saveMessage: async (_org, cId, convId, msg) => {
          const res = await convRepo.saveMessage({
            organizationId: _org,
            connectionId: cId,
            conversationId: convId,
            direction: msg.direction,
            sender: msg.sender,
            content: msg.content,
            messageType: msg.messageType,
            providerMessageId: msg.providerMessageId,
          });
          if (res.created) {
            await emitRealtime({
              type: 'inbox:message.created',
              organizationId: _org,
              connectionId: cId,
              conversationId: convId,
              payload: {
                id: res.id,
                conversationId: convId,
                sender: msg.sender,
                direction: msg.direction,
                content: msg.content,
                created_at: res.created_at,
                message_type: msg.messageType ?? null,
              },
            });
          }
          return { id: res.id };
        },
        syncDeal: async (_org, leadId, deal) => {
          const res = await convRepo.syncDeal(_org, leadId, deal);
          return { id: res.id };
        },
        getMessages: async (_org, convId, limit) => convRepo.getMessages(_org, convId, limit),
        getLeadRecentMessages: async (_org, leadId, limit) => convRepo.getLeadRecentMessages(_org, leadId, limit),
      },
      now: () => new Date(),
    };

    await emitExecutionEvent({
      type: 'execution:started',
      executionId: execution.id,
      organizationId: input.organizationId,
      flowId: debugFlow.id,
      timestamp: new Date().toISOString(),
      payload: { conversationId: conversation.id },
    });

    const result = await executeFlow(flowVersion.graph as any, flowCtx, services, {
      hooks: {
        onStepStart: async step => {
          await emitExecutionEvent({ type: 'step:start', executionId: execution.id, organizationId: input.organizationId, flowId: debugFlow.id, timestamp: new Date().toISOString(), payload: step });
        },
        onStepComplete: async step => {
          // Appends to the trace stream (fast, Redis-only) instead of inserting into Postgres
          // on the critical path (9.2) — TraceBatchWriter drains the stream in batches. The
          // WebSocket event below does not wait for that batch write (9.3: "WebSocket pode
          // publicar imediatamente").
          await traceSink.append({
            organizationId: input.organizationId,
            executionId: execution.id,
            nodeId: step.nodeId,
            sequence: step.sequence,
            input: step.input,
            output: step.output,
            durationMs: step.durationMs,
            error: step.error,
          });
          await emitExecutionEvent({ type: 'step:complete', executionId: execution.id, organizationId: input.organizationId, flowId: debugFlow.id, timestamp: new Date().toISOString(), payload: step });
        },
        onStepError: async step => {
          await emitExecutionEvent({ type: 'step:failed', executionId: execution.id, organizationId: input.organizationId, flowId: debugFlow.id, timestamp: new Date().toISOString(), payload: step });
        },
      },
    });

    await execRepo.updateExecution(execution.id, input.organizationId, {
      status: result.status,
      inputTokens: result.tokens.input,
      outputTokens: result.tokens.output,
      resumeNodeId: result.resumeNodeId,
      finishedAt: result.status !== 'waiting' ? new Date().toISOString() : null,
    });

    if (result.status === 'failed' && result.error === SUPERSEDED_TURN_ERROR) {
      await debugRegistry.supersede(execution.id);
      // A newer generation preempted this one; it will eventually mark these events itself.
      return { status: 'superseded', executionId: execution.id, conversationId: conversation.id };
    }

    // flow_executions only gets its terminal status once the runtime's own result is known
    // (already true above); trace_status is a separate, narrower completeness signal for
    // replay/debug consumers (9.3) — it waits for TraceBatchWriter to catch up on this
    // execution's steps specifically, bounded so a stalled writer can't hang the turn.
    const traceStatus = await waitForTraceCompletion({
      db,
      organizationId: input.organizationId,
      executionId: execution.id,
      expectedStepCount: result.steps.length,
    });
    if (traceStatus === 'failed') {
      console.warn('[turn-processor] Trace não confirmou todos os passos a tempo', { executionId: execution.id, expected: result.steps.length });
    }

    const debugIssues = [];
    const sentMessage = result.steps.some(step => step.nodeType.startsWith('output.') && Boolean((step.output as any)?.sent));
    if (result.status !== 'failed' && !sentMessage) {
      const lastStep = result.steps[result.steps.length - 1];
      debugIssues.push({
        severity: 'warning' as const,
        code: 'no_message_sent',
        message: 'O fluxo terminou sem enviar uma mensagem. Verifique as portas de saída do último bloco.',
        nodeId: lastStep?.nodeId,
      });
    }

    await emitExecutionEvent({
      type: 'execution:completed',
      executionId: execution.id,
      organizationId: input.organizationId,
      flowId: debugFlow.id,
      timestamp: new Date().toISOString(),
      payload: { status: result.status, steps: result.steps.length },
    });
    await debugRegistry.finish(execution.id, result, debugIssues);

    await markAll(db, input.organizationId, input.inboundEventIds, result.status === 'failed' ? 'failed' : 'processed', result.error);
    return { status: 'executed', executionId: execution.id, flowStatus: result.status, stepsCount: result.steps.length };
  } catch (err: any) {
    if (err?.message === SUPERSEDED_TURN_ERROR) {
      return { status: 'superseded', error: err.message };
    }
    await markAll(db, input.organizationId, input.inboundEventIds, 'failed', err?.message || String(err));
    return { status: 'error', error: err?.message || String(err) };
  }
}
