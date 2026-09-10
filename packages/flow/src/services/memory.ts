import {
  type FlowContextLead,
  type FlowContextMessage,
  type CommercialMemory,
  commercialMemorySchema,
} from '@sdr/shared';

export interface LeadExtractedData {
  name?: string | null;
  city?: string | null;
  interest?: string | null;
  urgency?: string | null;
  budget?: string | null;
  timeline?: string | null;
  decision_maker?: boolean | null;
  pain_points?: string[] | string | null;
  objections?: string[] | string | null;
  notes?: string | null;
  stage_intent?: string | null;
  custom_attributes?: Record<string, unknown>;
  custom_fields?: Record<string, unknown>;
}

export interface ConversationTurnContext {
  latestLeadMessage: string;
  lastAssistantMessage: string;
  lastAssistantQuestion: string;
  recentAssistantMessages: string[];
}

export class MemoryService {
  public static getCommercialMemory(lead?: FlowContextLead): CommercialMemory {
    if (!lead) {
      return commercialMemorySchema.parse({});
    }

    const rawMem = (lead.memory || {}) as Record<string, unknown>;

    const memoryObj: Partial<CommercialMemory> = {
      name: lead.name ?? (rawMem.name as string) ?? null,
      phone: lead.phone ?? (rawMem.phone as string) ?? null,
      budget: (rawMem.budget as string) ?? null,
      timeline: (rawMem.timeline as string) ?? null,
      decision_maker: typeof rawMem.decision_maker === 'boolean' ? rawMem.decision_maker : null,
      pain_points: Array.isArray(rawMem.pain_points)
        ? rawMem.pain_points
        : typeof rawMem.pain_points === 'string'
        ? [rawMem.pain_points]
        : [],
      objections: Array.isArray(rawMem.objections)
        ? rawMem.objections
        : typeof rawMem.objections === 'string'
        ? [rawMem.objections]
        : [],
      interest: lead.interest ?? (rawMem.interest as string) ?? null,
      urgency: lead.urgency ?? (rawMem.urgency as string) ?? null,
      city: lead.city ?? (rawMem.city as string) ?? null,
      stage_intent: (rawMem.stage_intent as string) ?? null,
      notes: (rawMem.notes as string) ?? null,
      custom_fields: ((rawMem.custom_fields || rawMem.attributes || {}) as Record<string, unknown>) || {},
    };

    return commercialMemorySchema.parse(memoryObj);
  }

  public static updateCommercialMemory(
    lead: FlowContextLead,
    extracted?: LeadExtractedData | Partial<CommercialMemory>
  ): FlowContextLead {
    if (!extracted) return lead;

    if ('name' in extracted && extracted.name) lead.name = extracted.name;
    if ('city' in extracted && extracted.city) lead.city = extracted.city;
    if ('interest' in extracted && extracted.interest) lead.interest = extracted.interest;
    if ('urgency' in extracted && extracted.urgency) lead.urgency = extracted.urgency;

    const current = MemoryService.getCommercialMemory(lead);

    if (extracted.budget !== undefined) current.budget = extracted.budget;
    if (extracted.timeline !== undefined) current.timeline = extracted.timeline;
    if (extracted.decision_maker !== undefined) current.decision_maker = extracted.decision_maker;
    if (extracted.notes !== undefined) {
      current.notes = typeof extracted.notes === 'string'
        ? extracted.notes.trim().slice(0, 200)
        : extracted.notes;
    }
    if (extracted.stage_intent !== undefined) current.stage_intent = extracted.stage_intent;

    if (extracted.pain_points) {
      const newPoints = Array.isArray(extracted.pain_points) ? extracted.pain_points : [extracted.pain_points];
      current.pain_points = Array.from(new Set([...current.pain_points, ...newPoints]));
    }

    if (extracted.objections) {
      const newObjections = Array.isArray(extracted.objections) ? extracted.objections : [extracted.objections];
      current.objections = Array.from(new Set([...current.objections, ...newObjections]));
    }

    const extraFields =
      ('custom_fields' in extracted && extracted.custom_fields) ||
      ('custom_attributes' in extracted && extracted.custom_attributes);
    if (extraFields && typeof extraFields === 'object') {
      current.custom_fields = { ...current.custom_fields, ...extraFields };
    }

    // Preserve compatibility for tests expecting name/phone/attributes in lead.memory
    lead.memory = {
      ...current,
      name: lead.name ?? null,
      phone: lead.phone,
      attributes: current.custom_fields,
    };

    return lead;
  }

  public static formatRecentMessages(messages: FlowContextMessage[], count = 6): string {
    const slice = messages.slice(-count);
    return slice
      .map(m => {
        const sender = m.sender === 'human' ? 'Human'
          : m.sender === 'system' ? 'System'
          : m.fromMe ? 'AI' : 'Lead';
        return `[${sender}]: ${m.text}`;
      })
      .join('\n');
  }

  public static getConversationTurnContext(messages: FlowContextMessage[]): ConversationTurnContext {
    const leadMessages = messages.filter(message => !message.fromMe && message.sender !== 'system');
    const assistantMessages = messages.filter(message => (
      message.sender === 'ai' || (message.fromMe && message.sender === undefined)
    ));
    const latestAssistant = assistantMessages.at(-1)?.text.trim() || '';
    const questions = latestAssistant.match(/[^.!?\n]*\?/g) || [];
    return {
      latestLeadMessage: leadMessages.at(-1)?.text.trim() || '',
      lastAssistantMessage: latestAssistant,
      lastAssistantQuestion: questions.at(-1)?.trim() || '',
      recentAssistantMessages: assistantMessages.slice(-5).map(message => message.text.trim()).filter(Boolean),
    };
  }
}
