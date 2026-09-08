export interface AgentDecision {
  reply: string;
  stage?: string;
  handoff?: boolean;
  handoff_reason?: string;
  intent?: string;
  lead_data?: {
    name?: string;
    city?: string;
    interest?: string;
    urgency?: string;
    objections?: string;
    notes?: string;
    custom_attributes?: Record<string, unknown>;
  };
  score?: number;
}

export interface LLMRequest {
  provider?: 'openai' | 'gemini';
  model?: string;
  prompt: string;
  system?: string;
  commercialMemory?: Record<string, unknown>;
  recentMessages?: string;
  latestUserMessage?: string;
  knowledgeSnippets?: string[];
  summary?: string;
}

export interface LLMResponse<T = unknown> {
  data: T;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMProvider {
  decide(req: LLMRequest): Promise<LLMResponse<AgentDecision>>;
  classify(req: LLMRequest): Promise<LLMResponse<{ intent: string }>>;
  extract(req: LLMRequest): Promise<LLMResponse<Record<string, unknown>>>;
  score(req: LLMRequest): Promise<LLMResponse<{ score: number; reason?: string }>>;
}

export class MockLLMProvider implements LLMProvider {
  constructor(
    private readonly defaultDecision: Partial<AgentDecision> = {},
    private readonly tokens = { input: 150, output: 45 }
  ) {}

  async decide(req: LLMRequest): Promise<LLMResponse<AgentDecision>> {
    return {
      data: {
        reply: this.defaultDecision.reply || `Olá! Entendido sobre "${req.latestUserMessage || 'sua mensagem'}". Como posso ajudar?`,
        stage: this.defaultDecision.stage || 'QUALIFYING',
        handoff: this.defaultDecision.handoff ?? false,
        handoff_reason: this.defaultDecision.handoff_reason,
        intent: this.defaultDecision.intent || 'interesse',
        lead_data: this.defaultDecision.lead_data,
        score: this.defaultDecision.score,
      },
      inputTokens: this.tokens.input,
      outputTokens: this.tokens.output,
    };
  }

  async classify(_req: LLMRequest): Promise<LLMResponse<{ intent: string }>> {
    return {
      data: { intent: this.defaultDecision.intent || 'interesse' },
      inputTokens: this.tokens.input,
      outputTokens: this.tokens.output,
    };
  }

  async extract(_req: LLMRequest): Promise<LLMResponse<Record<string, unknown>>> {
    return {
      data: this.defaultDecision.lead_data || { interest: 'consulta' },
      inputTokens: this.tokens.input,
      outputTokens: this.tokens.output,
    };
  }

  async score(_req: LLMRequest): Promise<LLMResponse<{ score: number; reason?: string }>> {
    return {
      data: { score: this.defaultDecision.score ?? 75, reason: 'Lead qualificado' },
      inputTokens: this.tokens.input,
      outputTokens: this.tokens.output,
    };
  }
}
