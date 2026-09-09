import {
  nextActionSchema,
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
import {
  availableSlots,
  calendarWindow,
  endFromStart,
  resolveCalendarDate,
} from '../services/google-calendar.js';
import {
  evaluateResponsePolicy,
  isPresent,
  resolveSalesField,
  splitSmartMessage,
} from '../services/sales-flow.js';


export type NodeExecutor = (
  ctx: FlowContext,
  config: Record<string, any>,
  services: FlowServices,
  resumePort?: string
) => Promise<NodeExecutionResult>;

function calendarClient(services: FlowServices) {
  if (!services.calendar) {
    throw new Error('Google Calendar não configurado no servidor. Configure GOOGLE_CALENDAR_CREDENTIALS_JSON.');
  }
  return services.calendar;
}

function mergeCalendarVariables(ctx: FlowContext, values: Record<string, unknown>): Record<string, unknown> {
  const current = ctx.variables.calendar && typeof ctx.variables.calendar === 'object'
    ? ctx.variables.calendar as Record<string, unknown>
    : {};
  return { ...current, ...values };
}

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

  'guard.response_policy': async (ctx, config, _services) => {
    const message = interpolate(config.text || '', ctx);
    const policy = evaluateResponsePolicy(ctx, message, {
      maxCharacters: config.maxCharacters || 700,
      knownFields: Array.isArray(config.knownFields) ? config.knownFields : [],
      blockedTerms: Array.isArray(config.blockedTerms) ? config.blockedTerms : [],
      requireGroundedPrice: config.requireGroundedPrice !== false,
    });
    return {
      port: policy.status,
      output: policy,
      variables: { response_policy: policy },
    };
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
    const count = config.recentMessages ?? 6;

    let messages = ctx.messages;
    if (services.db?.getMessages) {
      try {
        const rows = await services.db.getMessages(ctx.organizationId, ctx.conversationId, count);
        if (rows.length > 0) {
          messages = rows.map(r => ({
            id: r.id,
            text: r.content,
            fromMe: r.direction === 'OUTBOUND',
          }));
        }
      } catch { /* fall back to ctx.messages */ }
    }

    const recentMessages = MemoryService.formatRecentMessages(messages, count);
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

  'context.conversation_state': async (ctx, config, services) => {
    const previous = resolveSalesField(ctx, 'conversation_state');
    const state = {
      ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
      stage: config.stage,
      last_action: interpolate(config.lastAction || '', ctx) || null,
      next_expected_input: interpolate(config.nextExpectedInput || '', ctx) || null,
      updated_at: (services.now ? services.now() : new Date()).toISOString(),
    };
    let persisted = false;
    if (ctx.lead) {
      const memory = ctx.lead.memory && typeof ctx.lead.memory === 'object' ? ctx.lead.memory : {};
      const customFields = memory.custom_fields && typeof memory.custom_fields === 'object'
        ? memory.custom_fields as Record<string, unknown>
        : {};
      ctx.lead.memory = {
        ...memory,
        conversation_state: state,
        custom_fields: { ...customFields, conversation_state: state },
      };
      if (services.db) {
        await services.db.updateLead(ctx.organizationId, ctx.leadId, { memory: ctx.lead.memory });
        persisted = true;
      }
    }
    return {
      port: 'next',
      output: { ...state, persisted },
      variables: { conversation_state: state },
    };
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

  'agent.structured': async (ctx, config, services) => {
    const interpolatedPrompt = interpolate(config.prompt, ctx);
    const keys: string[] = Array.isArray(config.outputKeys) ? config.outputKeys : ['message', 'done'];
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const knowledgeSnippets = (ctx.variables.knowledgeSnippets as string[]) || [];

    if (!services.llm.structured) {
      return { port: 'default', output: {}, error: 'Provedor LLM não suporta saída estruturada.' };
    }

    const llmKeys = [...keys, '_route'];
    const enrichedPrompt = `${interpolatedPrompt}\n\nVocê DEVE retornar um JSON com as chaves: ${keys.join(', ')}.\nAlém disso, retorne "_route" com o nome de UMA das chaves (${keys.join(' | ')}) que representa a saída principal desta resposta.`;

    const res = await services.llm.structured({
      provider: config.provider,
      model: config.model,
      prompt: enrichedPrompt,
      commercialMemory: ctx.variables.commercialMemory as Record<string, unknown>,
      recentMessages: ctx.variables.recentMessages as string,
      latestUserMessage: latestMsg,
      knowledgeSnippets,
      summary: (ctx.variables.summary as string) || undefined,
    }, llmKeys);

    const variables: Record<string, unknown> = { structured: res.data };
    const route = res.data._route;
    const port = (typeof route === 'string' && keys.includes(route)) ? route : 'default';

    return {
      port,
      output: res.data,
      variables,
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  },

  'agent.next_action': async (ctx, config, services) => {
    const missing = resolveSalesField(ctx, 'required_fields.missing');
    const missingFields = Array.isArray(missing) ? missing.filter((value): value is string => typeof value === 'string') : [];
    if (missingFields.length > 0) {
      const decision = {
        action: 'ASK_MISSING_FIELD' as const,
        field: missingFields[0] || null,
        reason: 'Existem campos obrigatórios ausentes na memória.',
      };
      const currentDecision = ctx.variables.decision && typeof ctx.variables.decision === 'object'
        ? ctx.variables.decision as Record<string, unknown>
        : {};
      return {
        port: 'next',
        output: decision,
        variables: { next_action: decision, decision: { ...currentDecision, action: decision.action, next_action: decision } },
      };
    }
    if (!services.llm.structured) throw new Error('agent.next_action requer um provedor com saída estruturada.');

    const allowedActions: string[] = Array.isArray(config.allowedActions) ? config.allowedActions : [];
    const latestMsg = ctx.messages[ctx.messages.length - 1]?.text || '';
    const state = {
      lead: ctx.lead,
      commercialMemory: ctx.variables.commercialMemory,
      conversationState: resolveSalesField(ctx, 'conversation_state'),
      requiredFields: resolveSalesField(ctx, 'required_fields'),
    };
    const actionPrompt = `${interpolate(config.prompt, ctx)}\n\nAções permitidas: ${allowedActions.join(', ')}. `
      + 'Retorne action, field e reason. field deve ser vazio quando não houver campo a perguntar. '
      + `Estado estruturado: ${JSON.stringify(state)}`;
    const res = await services.llm.structured({
      provider: config.provider,
      model: config.model,
      prompt: actionPrompt,
      system: config.system,
      commercialMemory: ctx.variables.commercialMemory as Record<string, unknown>,
      recentMessages: ctx.variables.recentMessages as string,
      latestUserMessage: latestMsg,
      knowledgeSnippets: (ctx.variables.knowledgeSnippets as string[]) || [],
      summary: (ctx.variables.summary as string) || undefined,
    }, ['action', 'field', 'reason']);
    const parsedAction = nextActionSchema.safeParse(String(res.data.action || '').trim().toUpperCase());
    if (!parsedAction.success || !allowedActions.includes(parsedAction.data)) {
      throw new Error(`agent.next_action retornou ação inválida: ${String(res.data.action || '(vazia)')}`);
    }
    const decision = {
      action: parsedAction.data,
      field: String(res.data.field || '').trim() || null,
      reason: String(res.data.reason || '').trim() || 'Ação escolhida pelo agente.',
    };
    const currentDecision = ctx.variables.decision && typeof ctx.variables.decision === 'object'
      ? ctx.variables.decision as Record<string, unknown>
      : {};
    return {
      port: 'next',
      output: decision,
      variables: { next_action: decision, decision: { ...currentDecision, action: decision.action, next_action: decision } },
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

  'flow.loop': async (ctx, config, _services) => {
    const counterVar = config.counterVar || 'loop_count';
    const timesRaw = interpolate(config.times || '3', ctx);
    const times = Math.max(1, Math.floor(Number(timesRaw) || 3));
    const current = Number(ctx.variables[counterVar] || 0) + 1;

    if (current <= times) {
      return {
        port: 'body',
        output: { iteration: current, total: times },
        variables: { [counterVar]: current },
      };
    }

    return {
      port: 'done',
      output: { iteration: current, total: times, completed: true },
      variables: { [counterVar]: 0 },
    };
  },

  'flow.required_fields': async (ctx, config, _services) => {
    const required: string[] = Array.isArray(config.required) ? config.required : [];
    const optional: string[] = Array.isArray(config.optional) ? config.optional : [];
    const missing = required.filter(field => !isPresent(resolveSalesField(ctx, field)));
    const availableOptional = optional.filter(field => isPresent(resolveSalesField(ctx, field)));
    const result = {
      complete: missing.length === 0,
      missing,
      missing_count: missing.length,
      optional_available: availableOptional,
    };
    return {
      port: result.complete ? 'complete' : 'missing',
      output: result,
      variables: { required_fields: result },
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

  'output.smart_message': async (ctx, config, services) => {
    const text = interpolate(config.text || '', ctx);
    const phone = ctx.lead?.phone || '';
    if (!text.trim()) throw new Error('output.smart_message recebeu uma mensagem vazia.');
    if (!phone) throw new Error('output.smart_message não encontrou o telefone do lead.');
    const bubbles = splitSmartMessage(
      text,
      Math.min(3, Math.max(1, Number(config.maxBubbles) || 3)),
      Math.max(80, Number(config.maxCharactersPerBubble) || 320),
    );
    const messageIds: string[] = [];
    for (const bubble of bubbles) {
      const sent = await services.messaging.sendText(ctx.connectionId, phone, bubble, { typing: config.typing ?? true });
      messageIds.push(sent.messageId);
      if (services.db) {
        await services.db.saveMessage(ctx.organizationId, ctx.connectionId, ctx.conversationId, {
          sender: 'ai',
          direction: 'OUTBOUND',
          content: bubble,
          providerMessageId: sent.messageId,
        });
      }
    }
    const smartMessage = { sent: true, bubble_count: bubbles.length, bubbles, message_ids: messageIds };
    return { port: 'next', output: smartMessage, variables: { smart_message: smartMessage } };
  },

  // --- CONTEXT: STORAGE ---
  'context.storage': async (_ctx, config, _services) => {
    const content = String(config.content || '');
    const variableName = String(config.variableName || 'storage');
    const ports: string[] = Array.isArray(config.outputPorts) ? config.outputPorts : ['next'];
    const port = ports[0] || 'next';

    return {
      port,
      output: { stored: true, contentLength: content.length, variableName },
      variables: { [variableName]: content },
    };
  },

  // --- INTEGRATION: GOOGLE CALENDAR ---
  'integration.google_calendar': async (ctx, config, services) => {
    const action = config.action || 'list_events';
    const calendarId = interpolate(config.calendarId || 'primary', ctx);
    const credentialsRaw = config.credentials || '';

    let credentials: { client_id?: string; client_secret?: string; refresh_token?: string; access_token?: string } = {};
    try {
      credentials = credentialsRaw ? JSON.parse(credentialsRaw) : {};
    } catch {
      return { port: 'error', output: { error: 'Credenciais Google inválidas — JSON malformado' } };
    }

    if (!credentials.access_token && !credentials.refresh_token) {
      return { port: 'error', output: { error: 'Credenciais Google não configuradas. Configure access_token ou refresh_token nas propriedades do nó.' } };
    }

    const fetchFn = services.fetch || globalThis.fetch;
    let accessToken = credentials.access_token || '';

    // Refresh token if we have a refresh_token but no access_token
    if (!accessToken && credentials.refresh_token && credentials.client_id && credentials.client_secret) {
      try {
        const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            refresh_token: credentials.refresh_token,
            grant_type: 'refresh_token',
          }).toString(),
        });
        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          return { port: 'error', output: { error: `Falha ao renovar token Google: ${tokenData.error || 'unknown'}` } };
        }
        accessToken = tokenData.access_token;
      } catch (e: any) {
        return { port: 'error', output: { error: `Falha ao renovar token: ${e?.message || e}` } };
      }
    }

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    try {
      if (action === 'list_events') {
        const daysAhead = config.daysAhead || 7;
        const now = new Date();
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`;
        const res = await fetchFn(url, { headers });
        const data = await res.json() as { items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; description?: string; htmlLink?: string }>; error?: { message?: string } };
        if (!res.ok) {
          return { port: 'error', output: { error: data.error?.message || `HTTP ${res.status}` } };
        }
        const events = (data.items || []).map(e => ({
          title: e.summary || '(sem título)',
          start: e.start?.dateTime || e.start?.date || '',
          end: e.end?.dateTime || e.end?.date || '',
          description: e.description || '',
          link: e.htmlLink || '',
        }));
        return {
          port: 'success',
          output: { action: 'list_events', eventCount: events.length, events },
          variables: { calendar: { events, eventCount: events.length } },
        };
      }

      if (action === 'create_event') {
        const title = interpolate(config.eventTitle || '', ctx);
        const start = interpolate(config.eventStart || '', ctx);
        const end = interpolate(config.eventEnd || '', ctx);
        const description = interpolate(config.eventDescription || '', ctx);
        if (!title || !start || !end) {
          return { port: 'error', output: { error: 'Título, início e fim são obrigatórios para criar evento' } };
        }
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        const body = JSON.stringify({
          summary: title,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
        });
        const res = await fetchFn(url, { method: 'POST', headers, body });
        const data = await res.json() as { id?: string; htmlLink?: string; error?: { message?: string } };
        if (!res.ok) {
          return { port: 'error', output: { error: data.error?.message || `HTTP ${res.status}` } };
        }
        return {
          port: 'success',
          output: { action: 'create_event', eventId: data.id, link: data.htmlLink },
          variables: { calendar: { createdEvent: { id: data.id, link: data.htmlLink, title } } },
        };
      }

      if (action === 'check_availability') {
        const daysAhead = config.daysAhead || 7;
        const now = new Date();
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`;
        const res = await fetchFn(url, { headers });
        const data = await res.json() as { items?: Array<{ start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; summary?: string }>; error?: { message?: string } };
        if (!res.ok) {
          return { port: 'error', output: { error: data.error?.message || `HTTP ${res.status}` } };
        }
        const busySlots = (data.items || []).map(e => ({
          start: e.start?.dateTime || e.start?.date || '',
          end: e.end?.dateTime || e.end?.date || '',
          title: e.summary || '',
        }));
        return {
          port: 'success',
          output: { action: 'check_availability', busySlots, busyCount: busySlots.length },
          variables: { calendar: { busySlots, busyCount: busySlots.length } },
        };
      }

      return { port: 'error', output: { error: `Ação desconhecida: ${action}` } };
    } catch (e: any) {
      return { port: 'error', output: { error: e?.message || String(e) } };
    }
  },

  // --- CALENDAR: SALES ACTIONS ---
  'calendar.availability': async (ctx, config, services) => {
    try {
      const client = calendarClient(services);
      const calendarId = interpolate(config.calendarId || 'primary', ctx);
      const timezone = interpolate(config.timezone || 'America/Sao_Paulo', ctx);
      const dateInput = interpolate(config.date || '', ctx);
      const period = interpolate(config.period || '', ctx);
      const durationMinutes = Number(config.durationMinutes) || 30;
      const now = services.now ? services.now() : new Date();
      const date = resolveCalendarDate(dateInput, now, timezone, Number(config.daysAhead) || 14);
      const window = calendarWindow(date, period, timezone);
      const [events, calendarName] = await Promise.all([
        client.listEvents(calendarId, window.start.toISOString(), window.end.toISOString()),
        client.getCalendarName(calendarId).catch(() => calendarId),
      ]);
      const slotDetails = availableSlots(events, window, durationMinutes, timezone);
      const calendar = mergeCalendarVariables(ctx, {
        slots: slotDetails.map(slot => slot.label),
        slot_starts: slotDetails.map(slot => slot.start),
        slot_details: slotDetails,
        first_available: slotDetails[0]?.start || null,
        calendar_name: calendarName,
        date,
        timezone,
      });
      const output = {
        slots: calendar.slots,
        slot_starts: calendar.slot_starts,
        first_available: calendar.first_available,
        calendar_name: calendarName,
        date,
      };
      return {
        port: slotDetails.length > 0 ? 'available' : 'unavailable',
        output,
        variables: { calendar },
      };
    } catch (error: any) {
      return { port: 'error', output: { error: error?.message || String(error) } };
    }
  },

  'calendar.create_event': async (ctx, config, services) => {
    try {
      const client = calendarClient(services);
      const calendarId = interpolate(config.calendarId || 'primary', ctx);
      const timezone = interpolate(config.timezone || 'America/Sao_Paulo', ctx);
      const start = interpolate(config.start || '', ctx);
      const end = endFromStart(start, Number(config.durationMinutes) || 30);
      const title = interpolate(config.title || '', ctx);
      if (!title) throw new Error('O título do agendamento é obrigatório.');
      const description = interpolate(config.description || '', ctx);
      const leadName = interpolate(config.leadName || '', ctx);
      const leadPhone = interpolate(config.leadPhone || '', ctx);
      const contact = [leadName && `Lead: ${leadName}`, leadPhone && `Telefone: ${leadPhone}`].filter(Boolean).join('\n');
      const event = await client.createEvent(calendarId, {
        summary: title,
        description: [description, contact].filter(Boolean).join('\n\n'),
        start: { dateTime: start, timeZone: timezone },
        end: { dateTime: end, timeZone: timezone },
      });
      const calendar = mergeCalendarVariables(ctx, {
        event_id: event.id,
        start: event.start?.dateTime || start,
        end: event.end?.dateTime || end,
        event_link: event.htmlLink || null,
      });
      return {
        port: 'created',
        output: { event_id: calendar.event_id, start: calendar.start, end: calendar.end, link: calendar.event_link },
        variables: { calendar },
      };
    } catch (error: any) {
      return { port: 'error', output: { error: error?.message || String(error) } };
    }
  },

  'calendar.reschedule_event': async (ctx, config, services) => {
    try {
      const client = calendarClient(services);
      const calendarId = interpolate(config.calendarId || 'primary', ctx);
      const eventId = interpolate(config.eventId || '', ctx);
      const timezone = interpolate(config.timezone || 'America/Sao_Paulo', ctx);
      const start = interpolate(config.newStart || '', ctx);
      if (!eventId) throw new Error('O ID do evento é obrigatório para reagendar.');
      const end = endFromStart(start, Number(config.durationMinutes) || 30);
      const event = await client.updateEvent(calendarId, eventId, {
        start: { dateTime: start, timeZone: timezone },
        end: { dateTime: end, timeZone: timezone },
      });
      const calendar = mergeCalendarVariables(ctx, {
        event_id: event.id,
        start: event.start?.dateTime || start,
        end: event.end?.dateTime || end,
        event_link: event.htmlLink || null,
        rescheduled: true,
      });
      return {
        port: 'rescheduled',
        output: { event_id: calendar.event_id, start: calendar.start, end: calendar.end, link: calendar.event_link },
        variables: { calendar },
      };
    } catch (error: any) {
      return { port: 'error', output: { error: error?.message || String(error) } };
    }
  },

  'calendar.cancel_event': async (ctx, config, services) => {
    try {
      const client = calendarClient(services);
      const calendarId = interpolate(config.calendarId || 'primary', ctx);
      const eventId = interpolate(config.eventId || '', ctx);
      const reason = interpolate(config.reason || '', ctx);
      if (!eventId) throw new Error('O ID do evento é obrigatório para cancelar.');
      await client.cancelEvent(calendarId, eventId);
      const calendar = mergeCalendarVariables(ctx, { event_id: eventId, cancelled: true, cancellation_reason: reason || null });
      return {
        port: 'cancelled',
        output: { event_id: eventId, cancelled: true, reason: reason || null },
        variables: { calendar },
      };
    } catch (error: any) {
      return { port: 'error', output: { error: error?.message || String(error) } };
    }
  },

  'output.end': async (_ctx, _config, _services) => {
    return { port: '', output: { finished: true } };
  },
};
