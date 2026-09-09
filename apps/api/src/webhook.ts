import { normalizePhoneDigits, type FlowContext } from '@sdr/shared';
import { executeFlow, HandoffService, type FlowServices } from '@sdr/flow';
import { createRuntimeProviders } from '@sdr/flow/server';
import { ConnectionRepository, ConversationRepository, ExecutionRepository, serviceDatabase } from '@sdr/db';
import { wsServer } from './ws.js';
import { conversationDebugRegistry, type DebugFlowSnapshot } from './debug-session.js';
import { bufferWindowSeconds, SUPERSEDED_TURN_ERROR, type ConversationTurnQueue } from './conversation-turn-queue.js';
import type { ApiConfig } from './app.js';

export interface InboundWebhookOptions {
  turnQueue?: ConversationTurnQueue;
  bypassQueue?: boolean;
  messagesAlreadySaved?: boolean;
  isCurrent?: () => Promise<boolean>;
  flowId?: string;
  flowVersionId?: string;
}

export interface InboundMessageEvent {
  messageId: string;
  remoteJid: string;
  phone: string;
  textContent: string;
  messageType: string;
  mediaUrl?: string;
  fromMe: boolean;
  senderName?: string;
}

export class IdempotencyGate {
  private processed = new Set<string>();
  private inFlight = new Set<string>();

  acquire(messageId: string): boolean {
    if (!messageId) return true;
    if (this.processed.has(messageId) || this.inFlight.has(messageId)) {
      return false;
    }
    this.inFlight.add(messageId);
    return true;
  }

  complete(messageId: string) {
    if (!messageId) return;
    this.inFlight.delete(messageId);
    this.processed.add(messageId);
    // Keep max 5000 items in set
    if (this.processed.size > 5000) {
      const first = this.processed.values().next().value;
      if (first) this.processed.delete(first);
    }
  }

  release(messageId: string) {
    if (!messageId) return;
    this.inFlight.delete(messageId);
  }

  clear() {
    this.processed.clear();
    this.inFlight.clear();
  }
}

export const idempotencyGate = new IdempotencyGate();

export function parseEvolutionWebhook(payload: any): InboundMessageEvent | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload;
  const key = data.key || {};
  const message = data.message || {};

  const messageId = key.id || '';
  const remoteJid = key.remoteJid || '';
  const fromMe = Boolean(key.fromMe);
  const senderName = data.pushName || '';

  const textContent =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    '';

  let messageType = 'text';
  let mediaUrl: string | undefined;

  if (message.audioMessage) {
    messageType = 'audio';
    mediaUrl = message.audioMessage.url;
  } else if (message.imageMessage) {
    messageType = 'image';
    mediaUrl = message.imageMessage.url;
  } else if (message.videoMessage) {
    messageType = 'video';
    mediaUrl = message.videoMessage.url;
  } else if (message.documentMessage) {
    messageType = 'document';
    mediaUrl = message.documentMessage.url;
  }

  const cleanPhone = normalizePhoneDigits(remoteJid);

  return {
    messageId,
    remoteJid,
    phone: cleanPhone,
    textContent,
    messageType,
    mediaUrl,
    fromMe,
    senderName,
  };
}

export function parseMetaWebhook(payload: any): InboundMessageEvent | null {
  if (!payload || typeof payload !== 'object') return null;

  const entry = payload.entry?.[0]?.changes?.[0]?.value;
  if (!entry) return null;

  const message = entry.messages?.[0];
  if (!message) return null;

  const contact = entry.contacts?.[0];
  const messageId = message.id || '';
  const phone = message.from || '';
  const remoteJid = `${phone}@s.whatsapp.net`;
  const senderName = contact?.profile?.name || '';
  const messageType = message.type || 'text';
  const textContent = message.text?.body || '';

  return {
    messageId,
    remoteJid,
    phone,
    textContent,
    messageType,
    fromMe: false,
    senderName,
  };
}

export async function processInboundWebhook(
  connectionId: string,
  eventInput: InboundMessageEvent | InboundMessageEvent[],
  config: ApiConfig,
  options: InboundWebhookOptions = {},
): Promise<Record<string, unknown>> {
  const events = Array.isArray(eventInput) ? eventInput : [eventInput];
  const event = events[events.length - 1];
  if (!event) return { status: 'ignored', reason: 'empty_turn' };
  // 1. Idempotency check
  if (!options.bypassQueue && event.messageId && !idempotencyGate.acquire(event.messageId)) {
    return { status: 'ignored', reason: 'duplicate_message_id', messageId: event.messageId };
  }

  try {
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      throw new Error('Supabase não configurado para processar webhooks.');
    }

    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const convRepo = new ConversationRepository(db);
    const execRepo = new ExecutionRepository(db);

    // 2. Fetch connection and organization
    const { data: connection, error: connErr } = await db
      .from('connections')
      .select('*')
      .eq('id', connectionId)
      .single();

    if (connErr || !connection) {
      idempotencyGate.release(event.messageId);
      return { status: 'error', reason: 'connection_not_found' };
    }

    const organizationId = connection.organization_id;

    // 3. Find or create lead and conversation
    const lead = await convRepo.findOrCreateLead(organizationId, event.phone, event.senderName);
    const conversation = await convRepo.findOrCreateConversation(organizationId, connectionId, lead.id);

    // 4. Handle fromMe (Outbound / Human takeover / AI echo)
    if (event.fromMe) {
      const recent = await db
        .from('messages')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(3);

      const check = HandoffService.checkOutboundFromMe(
        (recent.data || []).map(m => ({
          id: m.provider_message_id || m.id,
          text: m.content,
          fromMe: m.direction === 'OUTBOUND',
        })),
        event.textContent,
        event.messageId
      );

      if (check.isAiEcho) {
        idempotencyGate.complete(event.messageId);
        return { status: 'ai_echo_ignored', conversationId: conversation.id };
      }

      if (check.isHumanTakeover) {
        await convRepo.saveMessage({
          organizationId,
          connectionId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          sender: 'human',
          content: event.textContent,
          messageType: event.messageType,
          providerMessageId: event.messageId,
        });

        await convRepo.updateConversation(organizationId, conversation.id, {
          bot_paused: true,
          handled_by: 'HUMAN',
          stage: 'HUMAN_HANDOFF',
        });

        idempotencyGate.complete(event.messageId);
        return { status: 'human_takeover_recorded', conversationId: conversation.id };
      }
    }

    // 5. Save incoming message. Buffered jobs reuse the messages already persisted
    // by the HTTP request that acknowledged each provider event.
    if (!options.messagesAlreadySaved) {
      for (const incoming of events) {
        await convRepo.saveMessage({
          organizationId,
          connectionId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          sender: 'lead',
          content: incoming.textContent,
          messageType: incoming.messageType,
          providerMessageId: incoming.messageId,
        });
      }
    }

    if (conversation.bot_paused) {
      conversationDebugRegistry.failArmed(organizationId, conversation.id, {
        severity: 'error',
        code: 'bot_paused',
        message: 'A mensagem chegou, mas a IA está pausada nesta conversa.',
      });
      idempotencyGate.complete(event.messageId);
      return { status: 'logged_bot_paused', conversationId: conversation.id };
    }

    // 6. Find published flow for this organization
    let flowQuery = db
      .from('flows')
      .select('id, name, published_version_id')
      .eq('organization_id', organizationId)
      .not('published_version_id', 'is', null);
    flowQuery = options.flowId
      ? flowQuery.eq('id', options.flowId)
      : flowQuery.order('updated_at', { ascending: false }).limit(1);
    const { data: flow } = await flowQuery.maybeSingle();

    if (!flow?.published_version_id) {
      conversationDebugRegistry.failArmed(organizationId, conversation.id, {
        severity: 'error',
        code: 'no_published_flow',
        message: 'A mensagem chegou, mas não existe um fluxo publicado para esta organização.',
      });
      idempotencyGate.complete(event.messageId);
      return { status: 'no_published_flow', organizationId };
    }

    const selectedFlowVersionId = options.flowVersionId || flow.published_version_id;
    const { data: flowVersion } = await db
      .from('flow_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('flow_id', flow.id)
      .eq('id', selectedFlowVersionId)
      .single();

    if (!flowVersion?.graph) {
      conversationDebugRegistry.failArmed(organizationId, conversation.id, {
        severity: 'error',
        code: 'invalid_flow_version',
        message: 'A versão publicada do fluxo não pôde ser carregada.',
      });
      idempotencyGate.complete(event.messageId);
      return { status: 'invalid_flow_version', versionId: selectedFlowVersionId };
    }

    const flowGraph = flowVersion.graph as any;
    const windowSeconds = bufferWindowSeconds(flowGraph);
    if (options.turnQueue && !options.bypassQueue && windowSeconds > 0 && !event.fromMe) {
      const queued = await options.turnQueue.enqueue({
        kind: 'published',
        target: connectionId,
        conversationKey: `${organizationId}:${conversation.id}`,
        windowSeconds,
        event,
        metadata: { flowId: flow.id, flowVersionId: flowVersion.id },
      });
      idempotencyGate.complete(event.messageId);
      return {
        status: 'queued',
        conversationId: conversation.id,
        generation: queued.generation,
        delayMs: queued.delayMs,
      };
    }

    // 7. Initialize FlowContext & Execution
    const execution = await execRepo.createExecution({
      organizationId,
      conversationId: conversation.id,
      flowVersionId: flowVersion.id,
      status: 'running',
    });
    const debugFlow: DebugFlowSnapshot = {
      id: flow.id,
      name: flow.name || 'Fluxo publicado',
      version: `v${flowVersion.version}`,
      nodes: (flowGraph.nodes || []).map((node: any) => ({ id: node.id, type: node.type, label: node.label || node.type })),
      graph: flowGraph,
    };
    conversationDebugRegistry.claim({
      organizationId,
      conversationId: conversation.id,
      executionId: execution.id,
      flow: debugFlow,
    });
    const emitExecutionEvent = (event: Parameters<typeof wsServer.broadcast>[0]) => {
      wsServer.broadcast(conversationDebugRegistry.record({ ...event, conversationId: conversation.id }));
    };

    const flowCtx: FlowContext = {
      organizationId,
      connectionId,
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
        id: incoming.messageId || `${execution.id}-${index}`,
        text: incoming.textContent,
        fromMe: false,
        type: incoming.messageType,
        mediaUrl: incoming.mediaUrl,
      })),
      variables: {},
      tokens: { input: 0, output: 0 },
    };

    // Services for execution
    const runtimeProviders = createRuntimeProviders(config, id => new ConnectionRepository(db).resolveMessagingConnection(connection.organization_id, id));
    const assertCurrent = async () => {
      if (options.isCurrent && !(await options.isCurrent())) throw new Error(SUPERSEDED_TURN_ERROR);
    };
    const guardedCalendar = runtimeProviders.calendar
      ? {
          async getCalendarName(...args: Parameters<NonNullable<FlowServices['calendar']>['getCalendarName']>) { await assertCurrent(); return runtimeProviders.calendar!.getCalendarName(...args); },
          async listEvents(...args: Parameters<NonNullable<FlowServices['calendar']>['listEvents']>) { await assertCurrent(); return runtimeProviders.calendar!.listEvents(...args); },
          async createEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['createEvent']>) { await assertCurrent(); return runtimeProviders.calendar!.createEvent(...args); },
          async updateEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['updateEvent']>) { await assertCurrent(); return runtimeProviders.calendar!.updateEvent(...args); },
          async cancelEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['cancelEvent']>) { await assertCurrent(); return runtimeProviders.calendar!.cancelEvent(...args); },
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
        updateLead: async (_org, leadId, patch) => {
          await convRepo.updateLead(_org, leadId, patch);
        },
        updateConversation: async (_org, convId, patch) => {
          await convRepo.updateConversation(_org, convId, patch);
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
          return { id: res.id };
        },
        syncDeal: async (_org, leadId, deal) => {
          const res = await convRepo.syncDeal(_org, leadId, deal);
          return { id: res.id };
        },
      },
      now: () => new Date(),
    };

    // Execute flow with WebSocket hooks
    emitExecutionEvent({
      type: 'execution:started',
      executionId: execution.id,
      organizationId,
      flowId: flow.id,
      timestamp: new Date().toISOString(),
      payload: { conversationId: conversation.id },
    });

    const result = await executeFlow(flowVersion.graph as any, flowCtx, services, {
      hooks: {
        onStepStart: async step => {
          emitExecutionEvent({
            type: 'step:start',
            executionId: execution.id,
            organizationId,
            flowId: flow.id,
            timestamp: new Date().toISOString(),
            payload: step,
          });
        },
        onStepComplete: async step => {
          await execRepo.recordStep({
            organizationId,
            executionId: execution.id,
            nodeId: step.nodeId,
            sequence: step.sequence,
            input: step.input,
            output: step.output,
            durationMs: step.durationMs,
            error: step.error,
          });

          emitExecutionEvent({
            type: 'step:complete',
            executionId: execution.id,
            organizationId,
            flowId: flow.id,
            timestamp: new Date().toISOString(),
            payload: step,
          });
        },
        onStepError: async step => {
          emitExecutionEvent({
            type: 'step:failed',
            executionId: execution.id,
            organizationId,
            flowId: flow.id,
            timestamp: new Date().toISOString(),
            payload: step,
          });
        },
      },
    });

    // Finalize execution in DB
    await execRepo.updateExecution(execution.id, organizationId, {
      status: result.status,
      inputTokens: result.tokens.input,
      outputTokens: result.tokens.output,
      resumeNodeId: result.resumeNodeId,
      finishedAt: result.status !== 'waiting' ? new Date().toISOString() : null,
    });

    if (result.status === 'failed' && result.error === SUPERSEDED_TURN_ERROR) {
      conversationDebugRegistry.supersede(execution.id);
      return { status: 'superseded', executionId: execution.id, conversationId: conversation.id };
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

    emitExecutionEvent({
      type: 'execution:completed',
      executionId: execution.id,
      organizationId,
      flowId: flow.id,
      timestamp: new Date().toISOString(),
      payload: { status: result.status, steps: result.steps.length },
    });
    conversationDebugRegistry.finish(execution.id, result, debugIssues);

    idempotencyGate.complete(event.messageId);
    return {
      status: 'executed',
      executionId: execution.id,
      flowStatus: result.status,
      stepsCount: result.steps.length,
    };
  } catch (err: any) {
    idempotencyGate.release(event.messageId);
    return { status: 'error', error: err?.message || String(err) };
  }
}
