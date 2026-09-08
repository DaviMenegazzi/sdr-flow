import type { FlowGraph, FlowContext, StepExecutionRecord } from '@sdr/shared';
import { executeFlow, type EngineOptions } from './engine.js';
import { MockLLMProvider } from './services/llm.js';
import type { FlowServices } from './services/types.js';

export interface ReplayResult {
  matched: boolean;
  originalStepCount: number;
  replayedStepCount: number;
  divergenceStep?: number;
  replayedResult: Awaited<ReturnType<typeof executeFlow>>;
}

export async function replayFlow(
  graph: FlowGraph,
  ctx: FlowContext,
  originalSteps: StepExecutionRecord[] = [],
  customServices?: Partial<FlowServices>,
  engineOptions?: EngineOptions
): Promise<ReplayResult> {
  // Sandbox services: no-op messaging, mock LLM, in-memory DB mocks
  const sandboxServices: FlowServices = {
    llm: customServices?.llm || new MockLLMProvider(),
    messaging: customServices?.messaging || {
      sendText: async () => ({ messageId: 'replay-msg-id' }),
      sendMedia: async () => ({ messageId: 'replay-media-id' }),
      sendTemplate: async () => ({ messageId: 'replay-tpl-id' }),
    },
    media: customServices?.media || {
      transcribeAudio: async () => 'Áudio simulado no replay',
      describeImage: async () => 'Imagem simulada no replay',
    },
    db: customServices?.db || {
      updateLead: async () => {},
      updateConversation: async () => {},
      saveMessage: async () => ({ id: 'replay-saved-msg-id' }),
      syncDeal: async () => ({ id: 'replay-deal-id' }),
    },
    fetch: customServices?.fetch || (async () => new Response(JSON.stringify({ replay: true }), { status: 200 })),
    now: customServices?.now || (() => new Date()),
  };

  const replayed = await executeFlow(graph, ctx, sandboxServices, engineOptions);

  let matched = originalSteps.length === replayed.steps.length;
  let divergenceStep: number | undefined;

  for (let i = 0; i < Math.min(originalSteps.length, replayed.steps.length); i++) {
    if (originalSteps[i]?.nodeId !== replayed.steps[i]?.nodeId) {
      matched = false;
      divergenceStep = i + 1;
      break;
    }
  }

  return {
    matched,
    originalStepCount: originalSteps.length,
    replayedStepCount: replayed.steps.length,
    divergenceStep,
    replayedResult: replayed,
  };
}
