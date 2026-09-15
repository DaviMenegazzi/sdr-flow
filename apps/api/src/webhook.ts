import { normalizePhoneDigits } from '@sdr/shared';
import { HandoffService } from '@sdr/flow';
import { ConversationRepository, serviceDatabase } from '@sdr/db';
import {
  resolveAndEnqueueTurn,
  resolveTurnFlow,
  processTurn,
  markInboundEventStatus,
  acceptInboundEvent as acceptInboundEventRpc,
  DirectPostgresTraceSink,
  type RedisTurnBuffer,
  type ExecutionEventPublisher,
  type DebugRegistry,
} from '@sdr/runtime';
import type { ApiConfig } from './app.js';

// The API's webhook path is now intentionally thin (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md
// 8.5): authenticate, normalize, durably accept the event, resolve which flow/version applies,
// hand off to the turn buffer, respond. All lead/conversation/message/flow-execution work for a
// genuine inbound (non-echo) message happens in packages/runtime's turn-processor — either in
// apps/worker (production) or, inline and synchronously, in this same process when no worker is
// configured (dev only — see createApp's TURN_PROCESSING_MODE gate in app.ts). Only the
// fromMe echo/human-takeover check stays here: it never goes through the turn buffer.

export interface InboundWebhookOptions {
  provider: 'evolution' | 'meta';
  /** Producer-only handle on the canonical queue (no handler attached in this process). */
  turnBuffer?: Pick<RedisTurnBuffer, 'enqueue'>;
  /** Dev-only: process the turn inline, in this request, when no turnBuffer is configured. Never true in production — see app.ts. */
  inlineFallback: boolean;
  eventPublisher: ExecutionEventPublisher;
  debugRegistry: DebugRegistry;
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

export function parseEvolutionWebhook(payload: any): InboundMessageEvent | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload;
  const key = data.key || {};
  const message = data.message || {};

  const messageId = key.id || '';
  const remoteJid = key.remoteJid || '';
  const remoteJidAlt = key.remoteJidAlt || '';
  const fromMe = Boolean(key.fromMe);
  const senderName = data.pushName || '';

  // No usable sender/thread identifier at all (protocol messages, malformed payloads):
  // nothing downstream can attribute this to a lead or conversation, so don't create one.
  if (!remoteJid) return null;

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

  // Group JIDs are the lead/conversation key for that group (packages/runtime's turn
  // processor already derives isGroup/groupId from the raw remoteJid below). Legacy groups
  // use a hyphenated "<creator-phone>-<created-at>@g.us" format; running that through
  // normalizePhoneDigits strips the hyphen and fuses both numbers into one meaningless
  // digit blob that also happens to collide across groups. Keep the JID's local part as-is
  // instead — it's already a stable, unique identifier and was never a phone number.
  const phoneSource = remoteJid.endsWith('@lid') && remoteJidAlt ? remoteJidAlt : remoteJid;
  const cleanPhone = remoteJid.endsWith('@g.us')
    ? remoteJid.replace(/@g\.us$/, '')
    : normalizePhoneDigits(phoneSource);

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
  config: ApiConfig,
  options: InboundWebhookOptions,
): Promise<Record<string, unknown>> {
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return { status: 'error', error: 'Supabase não configurado para processar webhooks.' };
  }
  const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);

  // 1. Durable acceptance + idempotency — the very first thing that happens with this event,
  // before any Redis interaction (7.4.4). Replaces the old in-memory IdempotencyGate.
  let accepted: Awaited<ReturnType<typeof acceptInboundEventRpc>>;
  try {
    accepted = await acceptInboundEventRpc(db, connectionId, options.provider, event.messageId || null, `${connectionId}:${event.phone}`, {
      remoteJid: event.remoteJid,
      phone: event.phone,
      textContent: event.textContent,
      messageType: event.messageType,
      mediaUrl: event.mediaUrl ?? null,
      fromMe: event.fromMe,
      senderName: event.senderName ?? null,
    });
  } catch (err: any) {
    return { status: 'error', reason: 'event_not_persisted', error: err?.message || String(err) };
  }
  if (!accepted.isNew && accepted.status === 'processed') {
    return { status: 'ignored', reason: 'duplicate_processed', eventId: accepted.eventId };
  }
  const organizationId = accepted.organizationId;
  await markInboundEventStatus(db, organizationId, accepted.eventId, 'processing');

  try {
    // 2. fromMe (outbound echo / human takeover) is never buffered or queued — it needs to be
    // fast and never waits on the turn buffer.
    if (event.fromMe) {
      const convRepo = new ConversationRepository(db);
      const lead = await convRepo.findOrCreateLead(organizationId, connectionId, event.phone, event.senderName);
      const sessionTimeoutMinutes = Number(process.env.SESSION_TIMEOUT_MINUTES) || 15;
      const conversation = await convRepo.findOrCreateConversation(organizationId, connectionId, lead.id, null, { sessionTimeoutMinutes, lead });

      const recent = await db
        .from('messages')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(3);

      const check = HandoffService.checkOutboundFromMe(
        (recent.data || []).map(m => ({ id: m.provider_message_id || m.id, text: m.content, fromMe: m.direction === 'OUTBOUND' })),
        event.textContent,
        event.messageId,
      );

      if (check.isAiEcho) {
        await markInboundEventStatus(db, organizationId, accepted.eventId, 'processed');
        return { status: 'ai_echo_ignored', conversationId: conversation.id };
      }

      if (check.isHumanTakeover) {
        await convRepo.saveMessage({
          organizationId, connectionId, conversationId: conversation.id,
          direction: 'OUTBOUND', sender: 'human', content: event.textContent,
          messageType: event.messageType, providerMessageId: event.messageId,
        });
        await convRepo.updateConversation(organizationId, conversation.id, { bot_paused: true, handled_by: 'HUMAN', stage: 'HUMAN_HANDOFF' });
        await markInboundEventStatus(db, organizationId, accepted.eventId, 'processed');
        return { status: 'human_takeover_recorded', conversationId: conversation.id };
      }

      // A genuine outbound message from a human agent — nothing further to do here.
      await markInboundEventStatus(db, organizationId, accepted.eventId, 'processed');
      return { status: 'outbound_logged', conversationId: conversation.id };
    }

    // 3. Resolve which flow/version applies and how long to debounce — configuration-level
    // lookups, no LLM, cheap enough to run in the response path (8.5).
    const resolution = await resolveTurnFlow(db, connectionId);
    if (resolution.status !== 'resolved') {
      await markInboundEventStatus(db, organizationId, accepted.eventId, 'failed', resolution.status);
      return { status: resolution.status, organizationId };
    }

    // 4. Hand off to the worker via the canonical queue, or — dev only, no worker configured —
    // run the exact same turn processor inline, synchronously, in this process.
    if (options.turnBuffer) {
      const enqueueResult = await resolveAndEnqueueTurn({ db, buffer: options.turnBuffer }, { connectionId, eventId: accepted.eventId, phone: event.phone });
      if (enqueueResult.status !== 'queued') {
        await markInboundEventStatus(db, organizationId, accepted.eventId, 'failed', enqueueResult.status);
        return { status: enqueueResult.status, organizationId };
      }
      return { status: 'queued', organizationId, generation: enqueueResult.generation, delayMs: enqueueResult.delayMs };
    }

    if (!options.inlineFallback) {
      await markInboundEventStatus(db, organizationId, accepted.eventId, 'failed', 'no_turn_processing_available');
      return { status: 'error', reason: 'no_turn_processing_available' };
    }

    const result = await processTurn(
      // Built lazily, per call, from the db this function already created — never at app
      // startup (createApp must stay free of eager privileged-client construction; see
      // tests/api-auth.test.ts "rejects ... before touching the privileged client").
      { db, runtimeConfig: config, eventPublisher: options.eventPublisher, debugRegistry: options.debugRegistry, traceSink: new DirectPostgresTraceSink(db) },
      {
        organizationId,
        connectionId,
        flowId: resolution.flowId,
        flowVersionId: resolution.flowVersionId,
        inboundEventIds: [accepted.eventId],
        isCurrent: async () => true,
      },
    );
    return { ...result, organizationId };
  } catch (err: any) {
    await markInboundEventStatus(db, organizationId, accepted.eventId, 'failed', err?.message || String(err));
    return { status: 'error', error: err?.message || String(err) };
  }
}
