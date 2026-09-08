import {
  type FlowGraph,
  type FlowContext,
  type FlowContextLead,
  type StepExecutionRecord,
} from '@sdr/shared';
import { executeFlow } from './engine.js';
import { MemoryService } from './services/memory.js';
import { MockLLMProvider, type LLMProvider, type AgentDecision } from './services/llm.js';
import type { FlowServices, DatabaseService, MessagingService } from './services/types.js';

export interface PlaygroundInput {
  graph: FlowGraph;
  organizationId: string;
  message: string;
  lead?: {
    name?: string;
    phone?: string;
    city?: string;
    interest?: string;
    urgency?: string;
    memory?: Record<string, unknown>;
  };
  services?: Partial<FlowServices>;
}

export interface PlaygroundResult {
  testModeBlocked?: boolean;
  executionId: string;
  status: 'completed' | 'waiting' | 'failed' | 'suspended';
  steps: StepExecutionRecord[];
  tokens: { input: number; output: number; total: number };
  sentMessages: Array<{ type: 'text' | 'media' | 'template'; content: string; details?: any }>;
  finalPrompt?: string;
  decision?: AgentDecision;
  commercialMemory?: Record<string, unknown>;
  knowledgeUsed?: string[];
  error?: string;
}

export async function runPlayground(input: PlaygroundInput): Promise<PlaygroundResult> {
  const sentMessages: PlaygroundResult['sentMessages'] = [];
  let capturedPrompt: string | undefined;

  const leadPhone = input.lead?.phone || '+5511999999999';
  const leadName = input.lead?.name ?? 'Lead de Teste';
  const leadCity = input.lead?.city ?? 'São Paulo';
  const leadInterest = input.lead?.interest ?? 'Plano Familiar';
  const leadUrgency = input.lead?.urgency ?? 'alta';

  const leadContext: FlowContextLead = {
    id: crypto.randomUUID(),
    phone: leadPhone,
    name: leadName,
    city: leadCity,
    interest: leadInterest,
    urgency: leadUrgency,
    memory: MemoryService.getCommercialMemory({
      id: '',
      phone: leadPhone,
      name: leadName,
      city: leadCity,
      interest: leadInterest,
      urgency: leadUrgency,
      memory: input.lead?.memory || {},
    }),
  };

  const conversationId = crypto.randomUUID();
  const executionId = crypto.randomUUID();

  const ctx: FlowContext = {
    organizationId: input.organizationId,
    connectionId: 'playground-connection',
    leadId: leadContext.id,
    conversationId,
    executionId,
    flowVersionId: 'playground-preview',
    lead: leadContext,
    conversation: {
      id: conversationId,
      stage: 'NEW_CONVERSATION',
      bot_paused: false,
      handled_by: 'AI',
    },
    messages: [
      {
        id: crypto.randomUUID(),
        text: input.message,
        fromMe: false,
      },
    ],
    variables: {},
    tokens: { input: 0, output: 0 },
  };

  const mockMessaging: MessagingService = {
    async sendText(_connId, _phone, text) {
      sentMessages.push({ type: 'text', content: text });
      return { messageId: crypto.randomUUID() };
    },
    async sendMedia(_connId, _phone, url, mediaType, caption) {
      sentMessages.push({ type: 'media', content: caption || url, details: { url, mediaType } });
      return { messageId: crypto.randomUUID() };
    },
    async sendTemplate(_connId, _phone, name, language) {
      sentMessages.push({ type: 'template', content: name, details: { language } });
      return { messageId: crypto.randomUUID() };
    },
  };

  const baseLLM: LLMProvider = input.services?.llm || new MockLLMProvider();
  const wrappedLLM: LLMProvider = {
    async decide(req) {
      capturedPrompt = req.prompt;
      return baseLLM.decide(req);
    },
    async classify(req) {
      if (!capturedPrompt) capturedPrompt = req.prompt;
      return baseLLM.classify(req);
    },
    async extract(req) {
      if (!capturedPrompt) capturedPrompt = req.prompt;
      return baseLLM.extract(req);
    },
    async score(req) {
      if (!capturedPrompt) capturedPrompt = req.prompt;
      return baseLLM.score(req);
    },
  };

  const mockDb: DatabaseService = input.services?.db || {
    async updateLead(_orgId, _leadId, data) {
      if (ctx.lead) {
        Object.assign(ctx.lead, data);
      }
    },
    async updateConversation(_orgId, _convId, data) {
      if (ctx.conversation) {
        Object.assign(ctx.conversation, data);
      }
    },
    async saveMessage() {
      return { id: crypto.randomUUID() };
    },
    async syncDeal() {
      return { id: crypto.randomUUID() };
    },
  };

  const services: FlowServices = {
    messaging: mockMessaging,
    llm: wrappedLLM,
    db: mockDb,
    media: input.services?.media,
    fetch: async () => { throw new Error('Chamadas HTTP externas estão desativadas no playground.'); },
  };

  // Clone nodes to allow leadPhone in guard.test_mode during simulation
  const simulationGraph: FlowGraph = {
    testMode: input.graph.testMode,
    schemaVersion: input.graph.schemaVersion,
    nodes: input.graph.nodes.map(n => {
      if (n.type === 'guard.test_mode' && n.config?.enabled) {
        const allowed = Array.isArray(n.config.allowedPhones) ? [...n.config.allowedPhones] : [];
        if (!allowed.includes(leadPhone)) allowed.push(leadPhone);
        return { ...n, config: { ...n.config, allowedPhones: allowed } };
      }
      return n;
    }),
    edges: input.graph.edges,
  };

  const execResult = await executeFlow(simulationGraph, ctx, services);

  return {
    testModeBlocked: ctx.variables.testModeBlocked === true,
    executionId,
    status: execResult.status,
    steps: execResult.steps,
    tokens: {
      input: ctx.tokens.input,
      output: ctx.tokens.output,
      total: ctx.tokens.input + ctx.tokens.output,
    },
    sentMessages,
    finalPrompt: capturedPrompt,
    decision: ctx.variables.decision as AgentDecision | undefined,
    commercialMemory: ctx.lead?.memory as Record<string, unknown> | undefined,
    knowledgeUsed: (ctx.variables.knowledgeSnippets as string[]) || undefined,
    error: execResult.error,
  };
}
