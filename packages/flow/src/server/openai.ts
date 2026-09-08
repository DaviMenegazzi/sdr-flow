import { z } from 'zod';
import type { AgentDecision, LLMProvider, LLMRequest, LLMResponse } from '../services/llm.js';

export interface OpenAIConfig { apiKey?: string; model?: string; timeoutMs?: number; fetch?: typeof fetch }
const nullableText = z.string().nullable();
const leadSchema = z.strictObject({ name: nullableText, city: nullableText, interest: nullableText,
  urgency: nullableText, objections: nullableText, notes: nullableText });
const decisionSchema = z.strictObject({ reply: z.string(), stage: nullableText, handoff: z.boolean(),
  handoff_reason: nullableText, intent: nullableText, lead_data: leadSchema.nullable(), score: z.number().min(0).max(100).nullable() });
const scoreSchema = z.strictObject({ score: z.number().min(0).max(100), reason: z.string() });
function withoutNulls(value: unknown): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, withoutNulls(v)]));
  }
  return value;
}

/** Server-only. No implicit mock fallback and no API keys in flow graphs. */
export class OpenAIProvider implements LLMProvider {
  constructor(private readonly config: OpenAIConfig = {}) {}

  private async generate<T>(req: LLMRequest, name: string, schema: z.ZodType<T>): Promise<LLMResponse<T>> {
    if (!this.config.apiKey?.trim()) throw new Error('Configure OPENAI_API_KEY no servidor para usar a OpenAI.');
    if (req.provider && req.provider !== 'openai') throw new Error('Provedor Gemini ainda não configurado. Selecione OpenAI.');
    const model = req.model && !['default', 'configure-model'].includes(req.model) ? req.model : this.config.model || 'gpt-4.1-mini';
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, store: false,
          instructions: [req.system, req.prompt, 'Use somente o contexto fornecido. Campos desconhecidos devem ser null. Não invente dados.'].filter(Boolean).join('\n\n'),
          input: JSON.stringify({ commercialMemory: req.commercialMemory, recentMessages: req.recentMessages,
            latestUserMessage: req.latestUserMessage, knowledgeSnippets: req.knowledgeSnippets, summary: req.summary }),
          text: { format: { type: 'json_schema', name, strict: true, schema: z.toJSONSchema(schema) } },
        }),
      });
    } catch { throw new Error('OpenAI indisponível ou tempo limite excedido.'); }
    if (!response.ok) throw new Error(`OpenAI: HTTP ${response.status}. Verifique chave, acesso ao modelo e limite da conta.`);
    let payload: any;
    try { payload = await response.json(); } catch { throw new Error('OpenAI retornou uma resposta inválida.'); }
    if (payload.status !== 'completed') throw new Error('OpenAI não concluiu a resposta.');
    const parts = (Array.isArray(payload.output) ? payload.output : []).flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
    if (parts.some((part: any) => part.type === 'refusal')) throw new Error('OpenAI recusou a solicitação.');
    const output = parts.filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('');
    let data: T;
    try { data = schema.parse(JSON.parse(output)); } catch { throw new Error('OpenAI retornou dados fora do formato esperado.'); }
    const usage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).safeParse(payload.usage);
    if (!usage.success) throw new Error('OpenAI não retornou o consumo de tokens.');
    return { data, inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens };
  }

  async decide(req: LLMRequest): Promise<LLMResponse<AgentDecision>> {
    const result = await this.generate(req, 'sdr_decision', decisionSchema);
    return { ...result, data: withoutNulls(result.data) as AgentDecision };
  }
  classify(req: LLMRequest) { return this.generate(req, 'sdr_intent', z.strictObject({ intent: z.string() })); }
  async extract(req: LLMRequest): Promise<LLMResponse<Record<string, unknown>>> {
    const result = await this.generate(req, 'sdr_lead', leadSchema);
    return { ...result, data: withoutNulls(result.data) };
  }
  score(req: LLMRequest) { return this.generate(req, 'sdr_score', scoreSchema); }
}
