import {
  type NodeType,
  type FlowContext,
  type NodeExecutionResult,
  isPhoneNumberMatch,
  normalizePhoneDigits,
} from '@sdr/shared';
import { interpolate } from '../interpolate.js';
import { MemoryService, type LeadExtractedData } from '../services/memory.js';
import { HandoffService } from '../services/handoff.js';
import { StateMachineService } from '../state-machine.js';
import { HallucinationGuard } from '../services/hallucination-guard.js';
import type { FlowServices } from '../services/types.js';


export type NodeExecutor = (
  ctx: FlowContext,
  config: Record<string, any>,
  services: FlowServices,
  resumePort?: string
) => Promise<NodeExecutionResult>;

export const executors: Record<NodeType, NodeExecutor> = {
  // --- TRIGGERS ---
  'trigger.message_received': async (_ctx, _config, _services) => {
    return { port: 'next', output: { trigger: 'message_received' } };
  },

  'trigger.schedule': async (_ctx, config, _services) => {
    return { port: 'next', output: { trigger: 'schedule', cron: config.cron } };
  },

  'trigger.manual': async (_ctx, _config, _services) => {
    return { port: 'next', output: { trigger: 'manual' } };
  },

  // --- GUARDS ---
  'guard.test_mode': async (ctx, config, _services) => {
    if (!config.enabled) {
      return { port: 'pass', output: { testMode: false } };
    }
    const leadPhone = ctx.lead?.phone || '';
    const allowed = Array.isArray(config.allowedPhones) && config.allowedPhones.some(
      (phone: string) => isPhoneNumberMatch(leadPhone, phone)
    );

    if (allowed) {
      return { port: 'pass', output: { allowed: true, phone: leadPhone } };
    }
    return {
      port: 'blocked',
      output: { allowed: false, phone: leadPhone, reason: 'Telefone não autorizado no modo teste' },
    };
  },

  'guard.human_takeover': async (ctx, _config, _services) => {
    const isPaused = Boolean(ctx.conversation?.bot_paused);
    const isHuman = ctx.conversation?.handled_by === 'HUMAN';

    if (isPaused || isHuman) {
      return {
        port: 'blocked',
        output: { blocked: true, reason: 'Atendimento sob controle humano', bot_paused: true },
      };
    }
    return { port: 'pass', output: { blocked: false } };
  },

  'guard.business_hours': async (_ctx, config, services) => {
    const now = services.now ? services.now() : new Date();
    const tz = config.timezone || 'America/Sao_Paulo';
    
    // Format current time in configured timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    const parts = formatter.formatToParts(now);
    let hour = '00';
    let minute = '00';
    let weekdayStr = 'Sun';

    for (const part of parts) {
      if (part.type === 'hour') hour = part.value;
      if (part.type === 'minute') minute = part.value;
      if (part.type === 'weekday') weekdayStr = part.value;
    }

    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentWeekday = weekdayMap[weekdayStr] ?? now.getDay();
    const currentTime = `${hour}:${minute}`;

    const weekdays: number[] = Array.isArray(config.weekdays) ? config.weekdays : [1, 2, 3, 4, 5];
    const isDayAllowed = weekdays.includes(currentWeekday);
    const isTimeAllowed = currentTime >= config.start && currentTime <= config.end;

    if (isDayAllowed && isTimeAllowed) {
      return { port: 'pass', output: { open: true, time: currentTime, day: currentWeekday } };
    }
    return {
      port: 'blocked',
      output: { open: false, reason: 'Fora do horário comercial', time: currentTime, day: currentWeekday },
    };
  },

  'guard.chat_type': async (ctx, config, _services) => {
    const isGroup = Boolean(ctx.variables.isGroup || ctx.lead?.phone?.includes('@g.us'));
    if (isGroup && !config.allowGroups) {
      return { port: 'blocked', output: { blocked: true, reason: 'Grupos não permitidos' } };
    }
    return { port: 'pass', output: { blocked: false, isGroup } };
  },

  // --- INPUT ---
  'input.buffer': async (ctx, config, _services) => {
    return {
      port: 'next',
      output: {
        windowSeconds: config.windowSeconds,
        messagesAggregated: ctx.messages.length,
      },
    };
  },

  'input.media': async (ctx, config, services) => {
    let enriched = '';
    for (const msg of ctx.messages) {
      if (msg.type === 'audio' && config.transcribeAudio && services.media && msg.mediaUrl) {
        const transcription = await services.media.transcribeAudio(msg.mediaUrl);
        enriched += ` [Áudio transcrito: ${transcription}]`;
      } else if (msg.type === 'image' && config.describeImages && services.media && msg.mediaUrl) {
        const description = await services.media.describeImage(msg.mediaUrl);
        enriched += ` [Imagem descrita: ${description}]`;
      }
    }
    const variables: Record<string, unknown> = {};
    if (enriched) {
      variables.mediaEnrichedText = enriched.trim();
    }
    return { port: 'next', output: { mediaProcessed: Boolean(enriched) }, variables };
  },

  'input.normalize': async (ctx, config, _services) => {
    if (config.country === 'BR' && ctx.lead?.phone) {
      const normalized = normalizePhoneDigits(ctx.lead.phone);
      ctx.lead.phone = normalized;
      return {
        port: 'next',
        output: { normalizedPhone: normalized },
        variables: { normalizedPhone: normalized },
      };
    }
    return { port: 'next', output: { phone: ctx.lead?.phone } };
  },

  // --- CONTEXT ---
  'context.memory': async (ctx, config, services) => {
    const commercialMemory = MemoryService.getCommercialMemory(ctx.lead);
    const recentMessages = MemoryService.formatRecentMessages(ctx.messages, config.recentMessages);
    let summary: string | null = null;
    if (services.db?.getConversationSummary) {
      summary = await services.db.getConversationSummary(ctx.organizationId, ctx.conversationId);
    }
    return {
      port: 'next',
      output: { commercialMemory, recentMessages, summary },
      variables: {
        commercialMemory,
        recentMessages,
        summary: summary || ctx.variables.summary,
        'conversation.summary': summary || ctx.variables.summary,
      },
    };
  },

  'context.knowledge': async (ctx, config, services) => {
    let snippets: string[] = [];
    const query = ctx.messages.map(m => m.text).join(' ') || (ctx.lead?.interest ? `Interesse: ${ctx.lead.interest}` : '');
    if (services.db?.searchKnowledge) {
      snippets = await services.db.searchKnowledge(
        ctx.organizationId,
        config.collection || 'default',
        query,
        config.topK || 5,
        config.threshold || 0.7
      );
    }
    const formattedSnippets = snippets.join('\n\n');
    return {
      port: 'next',
      output: { snippetsCount: snippets.length, snippets },
      variables: {
        knowledgeSnippets: snippets,
        'context.knowledge': formattedSnippets,
        knowledge: formattedSnippets,
      },
    };
  },

  'context.crm': async (ctx, _config, _services) => {
    return {
      port: 'next',
      output: { leadId: ctx.leadId },
      variables: { crmContext: { leadId: ctx.leadId } },
    };
  },

  'context.summarize': async (ctx, config, services) => {
    if (ctx.messages.length >= config.afterMessages) {
      const summary = `Resumo de ${ctx.messages.length} mensagens com o lead ${ctx.lead?.name || ctx.lead?.phone}`;
      if (services.db?.saveConversationSummary) {
        await services.db.saveConversationSummary(
          ctx.organizationId,
          ctx.conversationId,
          summary,
          ctx.messages.length,
          0
        );
      }
      return {
        port: 'next',
        output: { summarized: true, summary },
        variables: { summary, 'conversation.summary': summary },
      };
    }
    return { port: 'next', output: { summarized: false } };
  },

  // --- AGENT ---
  'agent.decide': async (ctx, config, services) => {
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const interpolatedPrompt = interpolate(config.prompt, ctx);
    const knowledgeSnippets = (ctx.variables.knowledgeSnippets as string[]) || [];

    const res = await services.llm.decide({
      provider: config.provider,
      model: config.model,
      prompt: interpolatedPrompt,
      commercialMemory: ctx.variables.commercialMemory as Record<string, unknown>,
      recentMessages: ctx.variables.recentMessages as string,
      latestUserMessage: latestMsg,
      knowledgeSnippets,
      summary: (ctx.variables.summary as string) || undefined,
    });

    // Run Hallucination Guard: ensure pricing and availability are grounded in knowledge base
    const guardResult = HallucinationGuard.verify({
      userMessage: latestMsg,
      proposedReply: res.data.reply,
      knowledgeSnippets,
    });

    if (!guardResult.allowed) {
      res.data.reply = guardResult.sanitizedReply;
      if (guardResult.triggerHandoff) {
        res.data.handoff = true;
        res.data.handoff_reason = guardResult.handoffReason;
      }
    }

    return {
      port: 'next',
      output: res.data,
      variables: { decision: res.data },
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  },

  'agent.classify': async (ctx, config, services) => {
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const interpolatedPrompt = interpolate(config.prompt, ctx);
    const res = await services.llm.classify({
      provider: config.provider,
      model: config.model,
      prompt: interpolatedPrompt,
      latestUserMessage: latestMsg,
    });

    const currentDecision = (ctx.variables.decision as Record<string, unknown>) || {};
    const updatedDecision = { ...currentDecision, intent: res.data.intent };

    return {
      port: 'next',
      output: res.data,
      variables: { decision: updatedDecision },
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  },

  'agent.extract': async (ctx, config, services) => {
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const interpolatedPrompt = interpolate(config.prompt, ctx);
    const res = await services.llm.extract({
      provider: config.provider,
      model: config.model,
      prompt: interpolatedPrompt,
      latestUserMessage: latestMsg,
    });

    const currentDecision = (ctx.variables.decision as Record<string, unknown>) || {};
    const updatedDecision = { ...currentDecision, lead_data: res.data };

    return {
      port: 'next',
      output: res.data,
      variables: { decision: updatedDecision },
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  },

  'agent.score': async (ctx, config, services) => {
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const interpolatedPrompt = interpolate(config.prompt, ctx);
    const res = await services.llm.score({
      provider: config.provider,
      model: config.model,
      prompt: interpolatedPrompt,
      latestUserMessage: latestMsg,
    });

    const currentDecision = (ctx.variables.decision as Record<string, unknown>) || {};
    const updatedDecision = { ...currentDecision, score: res.data.score };

    return {
      port: 'next',
      output: res.data,
      variables: { decision: updatedDecision },
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  },

  // --- FLOW CONTROL ---
  'flow.condition': async (ctx, config, _services) => {
    const resolved = interpolate(`{{${config.variable}}}`, ctx);
    const target = String(config.value);

    let isMatch = false;
    switch (config.operator) {
      case 'equals':
        isMatch = resolved === target;
        break;
      case 'not_equals':
        isMatch = resolved !== target;
        break;
      case 'contains':
        isMatch = resolved.toLowerCase().includes(target.toLowerCase());
        break;
      case 'greater_than':
        isMatch = Number(resolved) > Number(target);
        break;
      default:
        isMatch = resolved === target;
    }

    return {
      port: isMatch ? 'true' : 'false',
      output: { conditionMet: isMatch, value: resolved, target },
    };
  },

  'flow.switch': async (ctx, config, _services) => {
    const resolved = interpolate(`{{${config.variable}}}`, ctx);
    const cases: string[] = Array.isArray(config.cases) ? config.cases : [];

    const selectedPort = cases.includes(resolved) ? resolved : 'default';
    return {
      port: selectedPort,
      output: { selectedPort, value: resolved },
    };
  },

  'flow.delay': async (_ctx, config, _services) => {
    return {
      port: 'next',
      output: { delayedSeconds: config.seconds },
    };
  },

  'flow.wait_reply': async (_ctx, config, _services, resumePort) => {
    // If resuming from a wakeup event
    if (resumePort) {
      return {
        port: resumePort === 'timeout' ? 'timeout' : 'reply',
        suspend: false,
        output: { resumed: true, via: resumePort },
      };
    }

    // Suspend execution until lead replies or timeout occurs
    return {
      port: 'reply',
      suspend: true,
      output: { suspended: true, timeoutMinutes: config.timeoutMinutes },
    };
  },

  // --- ACTIONS ---
  'action.update_stage': async (ctx, config, services) => {
    const stage = interpolate(config.stage, ctx);
    if (!stage) return { port: 'next', output: { updated: false, reason: 'Stage vazio' } };

    const current = ctx.conversation?.stage || 'NEW_CONVERSATION';
    const canTransition = StateMachineService.validateTransition(current, stage);

    if (canTransition) {
      if (ctx.conversation) {
        ctx.conversation.stage = stage;
      }
      if (services.db) {
        await services.db.updateConversation(ctx.organizationId, ctx.conversationId, { stage });
      }
      return { port: 'next', output: { updated: true, from: current, to: stage } };
    }

    return {
      port: 'next',
      output: { updated: false, from: current, to: stage, reason: 'Transição de estágio rejeitada' },
    };
  },

  'action.update_lead': async (ctx, config, services) => {
    const sourceKey = config.source || 'decision.lead_data';
    const rawData = interpolate(`{{${sourceKey}}}`, ctx);
    let extracted: LeadExtractedData = {};

    try {
      extracted = typeof rawData === 'string' && rawData.startsWith('{') ? JSON.parse(rawData) : {};
    } catch {
      // ignore JSON parse error, fallback to empty
    }

    // Also check direct object in ctx.variables.decision.lead_data
    if (Object.keys(extracted).length === 0 && (ctx.variables.decision as any)?.lead_data) {
      extracted = (ctx.variables.decision as any).lead_data;
    }

    if (ctx.lead) {
      MemoryService.updateCommercialMemory(ctx.lead, extracted);
      if (services.db) {
        await services.db.updateLead(ctx.organizationId, ctx.lead.id, ctx.lead);
      }
    }

    return { port: 'next', output: { updated: true, extracted } };
  },

  'action.crm_sync': async (ctx, _config, services) => {
    const leadName = ctx.lead?.name || 'Lead';
    const interest = ctx.lead?.interest || 'Interesse Comercial';
    const score = (ctx.variables.decision as any)?.score ?? 50;

    let dealId = '';
    if (services.db) {
      const res = await services.db.syncDeal(ctx.organizationId, ctx.leadId, {
        title: `${leadName} - ${interest}`,
        status: 'OPEN',
        score,
      });
      dealId = res.id;
    }

    return { port: 'next', output: { dealId, synced: true } };
  },

  'action.handoff': async (ctx, config, services) => {
    const reason = interpolate(config.reason, ctx) || 'HUMAN_HANDOFF';
    if (ctx.conversation) {
      HandoffService.triggerHandoff(ctx.conversation, reason);
      if (services.db) {
        await services.db.updateConversation(ctx.organizationId, ctx.conversationId, {
          bot_paused: true,
          handled_by: 'HUMAN',
          stage: 'HUMAN_HANDOFF',
        });
      }
    }
    return { port: 'next', output: { handedOff: true, reason } };
  },

  'action.webhook': async (ctx, config, services) => {
    const fetchFn = services.fetch || globalThis.fetch;
    const body = JSON.stringify({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      lead: ctx.lead,
      conversation: ctx.conversation,
      variables: ctx.variables,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (config.timeoutSeconds || 15) * 1000);

    try {
      const res = await fetchFn(config.url, {
        method: config.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      return {
        port: 'next',
        output: { status: res.status, ok: res.ok },
        variables: { webhookResponse: data },
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  // --- OUTPUT ---
  'output.send_text': async (ctx, config, services) => {
    const text = interpolate(config.text, ctx);
    const phone = ctx.lead?.phone || '';

    let messageId = '';
    if (text && phone && services.messaging) {
      const res = await services.messaging.sendText(ctx.connectionId, phone, text, {
        typing: config.typing ?? true,
      });
      messageId = res.messageId;

      if (services.db) {
        await services.db.saveMessage(ctx.organizationId, ctx.connectionId, ctx.conversationId, {
          sender: 'ai',
          direction: 'OUTBOUND',
          content: text,
          providerMessageId: messageId,
        });
      }
    }

    return { port: 'next', output: { sent: Boolean(text), messageId, text } };
  },

  'output.send_media': async (ctx, config, services) => {
    const url = interpolate(config.url, ctx);
    const caption = interpolate(config.caption, ctx);
    const phone = ctx.lead?.phone || '';

    let messageId = '';
    if (url && phone && services.messaging) {
      const res = await services.messaging.sendMedia(
        ctx.connectionId,
        phone,
        url,
        config.mediaType || 'image',
        caption
      );
      messageId = res.messageId;

      if (services.db) {
        await services.db.saveMessage(ctx.organizationId, ctx.connectionId, ctx.conversationId, {
          sender: 'ai',
          direction: 'OUTBOUND',
          content: caption || url,
          messageType: config.mediaType || 'image',
          providerMessageId: messageId,
        });
      }
    }

    return { port: 'next', output: { sent: Boolean(url), messageId, url } };
  },

  'output.send_template': async (ctx, config, services) => {
    const phone = ctx.lead?.phone || '';
    let messageId = '';

    if (phone && services.messaging) {
      const res = await services.messaging.sendTemplate(
        ctx.connectionId,
        phone,
        config.name,
        config.language || 'pt_BR'
      );
      messageId = res.messageId;

      if (services.db) {
        await services.db.saveMessage(ctx.organizationId, ctx.connectionId, ctx.conversationId, {
          sender: 'ai',
          direction: 'OUTBOUND',
          content: `Template: ${config.name}`,
          messageType: 'template',
          providerMessageId: messageId,
        });
      }
    }

    return { port: 'next', output: { sent: true, messageId, template: config.name } };
  },

  'output.end': async (_ctx, _config, _services) => {
    return { port: '', output: { finished: true } };
  },
};
