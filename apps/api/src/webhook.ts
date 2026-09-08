import { normalizePhoneDigits, type FlowContext } from '@sdr/shared';
import { executeFlow, HandoffService, type FlowServices } from '@sdr/flow';
import { createRuntimeProviders } from '@sdr/flow/server';
import { ConnectionRepository, ConversationRepository, ExecutionRepository, serviceDatabase } from '@sdr/db';
import { wsServer } from './ws.js';
import type { ApiConfig } from './app.js';

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
  event: InboundMessageEvent,
  config: ApiConfig
): Promise<Record<string, unknown>> {
  // 1. Idempotency check
  if (event.messageId && !idempotencyGate.acquire(event.messageId)) {
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

    // 5. Save incoming message
    await convRepo.saveMessage({
      organizationId,
      connectionId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'lead',
      content: event.textContent,
      messageType: event.messageType,
      providerMessageId: event.messageId,
    });

    if (conversation.bot_paused) {
      idempotencyGate.complete(event.messageId);
      return { status: 'logged_bot_paused', conversationId: conversation.id };
    }

    // 6. Find published flow for this organization
    const { data: flow } = await db
      .from('flows')
      .select('id, published_version_id')
      .eq('organization_id', organizationId)
      .not('published_version_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!flow?.published_version_id) {
      idempotencyGate.complete(event.messageId);
      return { status: 'no_published_flow', organizationId };
    }

    const { data: flowVersion } = await db
      .from('flow_versions')
      .select('*')
      .eq('id', flow.published_version_id)
      .single();

    if (!flowVersion?.graph) {
      idempotencyGate.complete(event.messageId);
      return { status: 'invalid_flow_version', versionId: flow.published_version_id };
    }

    // 7. Initialize FlowContext & Execution
    const execution = await execRepo.createExecution({
      organizationId,
      conversationId: conversation.id,
      flowVersionId: flowVersion.id,
      status: 'running',
    });

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
      messages: [
        {
          id: event.messageId || execution.id,
          text: event.textContent,
          fromMe: false,
          type: event.messageType,
          mediaUrl: event.mediaUrl,
        },
      ],
      variables: {},
      tokens: { input: 0, output: 0 },
    };

    // Services for execution
    const services: FlowServices = {
      ...createRuntimeProviders(config, id => new ConnectionRepository(db).resolveMessagingConnection(connection.organization_id, id)),
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
    wsServer.broadcast({
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
          wsServer.broadcast({
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

          wsServer.broadcast({
            type: 'step:complete',
            executionId: execution.id,
            organizationId,
            flowId: flow.id,
            timestamp: new Date().toISOString(),
            payload: step,
          });
        },
        onStepError: async step => {
          wsServer.broadcast({
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

    wsServer.broadcast({
      type: 'execution:completed',
      executionId: execution.id,
      organizationId,
      flowId: flow.id,
      timestamp: new Date().toISOString(),
      payload: { status: result.status, steps: result.steps.length },
    });

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
