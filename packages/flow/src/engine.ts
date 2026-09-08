import {
  flowTestModeSchema,
  type FlowGraph,
  type FlowNode,
  type FlowEdge,
  type FlowContext,
  type FlowExecutionResult,
  type StepExecutionRecord,
  type NodeType,
} from '@sdr/shared';
import { executors } from './executors/index.js';
import type { FlowServices } from './services/types.js';
import { matchesTestPhone, restrictTestMessaging } from './services/test-mode.js';

export interface EngineHooks {
  onStepStart?: (step: { sequence: number; nodeId: string; nodeType: NodeType; input?: unknown }) => Promise<void> | void;
  onStepComplete?: (step: StepExecutionRecord) => Promise<void> | void;
  onStepError?: (step: { sequence: number; nodeId: string; error: string }) => Promise<void> | void;
}

export interface EngineOptions {
  maxSteps?: number;
  maxNodeVisits?: number;
  resumeFromNodeId?: string;
  resumePort?: string;
  hooks?: EngineHooks;
}

export async function executeFlow(
  graph: FlowGraph,
  ctx: FlowContext,
  services: FlowServices,
  options: EngineOptions = {}
): Promise<FlowExecutionResult> {
  const testMode = flowTestModeSchema.safeParse(graph.testMode ?? { enabled: false, phone: '' });
  if (!testMode.success) return { status: 'failed', steps: [], tokens: ctx.tokens, variables: ctx.variables,
    error: 'Modo Teste inválido: configure um único número com DDI e DDD.' };
  if (testMode.data.enabled) {
    if (!matchesTestPhone(ctx.lead?.phone, testMode.data.phone)) {
      ctx.variables = { ...ctx.variables, testModeBlocked: true };
      const step: StepExecutionRecord = { sequence: 1, nodeId: '$flow-test-mode', nodeType: 'guard.test_mode',
        input: { enabled: true }, output: { blocked: true, reason: 'Modo Teste: número não autorizado.' }, durationMs: 0 };
      await options.hooks?.onStepStart?.({ sequence: 1, nodeId: step.nodeId, nodeType: step.nodeType, input: step.input });
      await options.hooks?.onStepComplete?.(step);
      return { status: 'completed', steps: [step], tokens: ctx.tokens, variables: ctx.variables };
    }
    services = { ...services, messaging: restrictTestMessaging(services.messaging, testMode.data.phone, ctx.connectionId) };
  }
  const maxSteps = options.maxSteps ?? 50;
  const nodeMap = new Map<string, FlowNode>(graph.nodes.map(n => [n.id, n]));
  
  // Index edges by source and sourcePort
  const edgeMap = new Map<string, FlowEdge>();
  for (const edge of graph.edges) {
    edgeMap.set(`${edge.source}:::${edge.sourcePort}`, edge);
  }

  // Find start node
  let currentNode: FlowNode | undefined;
  let isResuming = false;

  if (options.resumeFromNodeId) {
    currentNode = nodeMap.get(options.resumeFromNodeId);
    isResuming = true;
    if (!currentNode) {
      return {
        status: 'failed',
        steps: [],
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: `Nó de retomada não encontrado: ${options.resumeFromNodeId}`,
      };
    }
  } else {
    // Find trigger node
    currentNode = graph.nodes.find(n => n.type.startsWith('trigger.')) || graph.nodes[0];
    if (!currentNode) {
      return {
        status: 'failed',
        steps: [],
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: 'Nenhum nó encontrado no grafo',
      };
    }
  }

  const steps: StepExecutionRecord[] = [];
  const visitCount = new Map<string, number>();
  const maxNodeVisits = options.maxNodeVisits ?? graph.loopLimit ?? 5;
  let sequence = 1;

  while (currentNode) {
    const visits = (visitCount.get(currentNode.id) || 0) + 1;
    if (visits > maxNodeVisits) {
      return {
        status: 'failed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: `Loop excedido: o nó "${currentNode.label || currentNode.id}" (${currentNode.type}) foi executado ${maxNodeVisits} vezes. Limite de iterações atingido.`,
      };
    }
    visitCount.set(currentNode.id, visits);

    if (sequence > maxSteps) {
      const errorMsg = `Limite de passos excedido (${maxSteps})`;
      return {
        status: 'failed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: errorMsg,
      };
    }

    const executor = executors[currentNode.type];
    if (!executor) {
      const errorMsg = `Executor não encontrado para tipo: ${currentNode.type}`;
      return {
        status: 'failed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: errorMsg,
      };
    }

    if (options.hooks?.onStepStart) {
      await options.hooks.onStepStart({
        sequence,
        nodeId: currentNode.id,
        nodeType: currentNode.type,
        input: currentNode.config,
      });
    }

    const startTime = performance.now();
    let result;

    try {
      result = await executor(
        ctx,
        currentNode.type === 'guard.test_mode' && testMode.data.enabled
          ? { ...currentNode.config, enabled: true, allowedPhones: [testMode.data.phone] }
          : currentNode.config,
        services,
        isResuming ? options.resumePort || 'reply' : undefined
      );
      isResuming = false; // only the first node resumes
    } catch (err: any) {
      const stepError = err?.message || String(err);
      if (options.hooks?.onStepError) {
        await options.hooks.onStepError({
          sequence,
          nodeId: currentNode.id,
          error: stepError,
        });
      }
      const durationMs = Math.max(1, Math.round(performance.now() - startTime));
      steps.push({
        sequence,
        nodeId: currentNode.id,
        nodeType: currentNode.type,
        input: currentNode.config,
        output: null,
        durationMs,
        error: stepError,
      });

      return {
        status: 'failed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
        error: stepError,
      };
    }

    const durationMs = Math.max(1, Math.round(performance.now() - startTime));

    // Update context variables and tokens
    if (result.variables) {
      ctx.variables = { ...ctx.variables, ...result.variables };
    }
    if (result.tokens) {
      ctx.tokens.input += result.tokens.input || 0;
      ctx.tokens.output += result.tokens.output || 0;
    }

    const stepRecord: StepExecutionRecord = {
      sequence,
      nodeId: currentNode.id,
      nodeType: currentNode.type,
      input: currentNode.config,
      output: result.output,
      durationMs,
      error: result.error,
    };
    steps.push(stepRecord);

    if (options.hooks?.onStepComplete) {
      await options.hooks.onStepComplete(stepRecord);
    }

    // Handle suspension (e.g. flow.wait_reply)
    if (result.suspend) {
      ctx.resumeNodeId = currentNode.id;
      return {
        status: 'waiting',
        resumeNodeId: currentNode.id,
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
      };
    }

    // Handle terminal node or finished flow
    if (currentNode.type === 'output.end' || !result.port) {
      return {
        status: 'completed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
      };
    }

    // Navigate to next node via matching edge
    const nextEdge = edgeMap.get(`${currentNode.id}:::${result.port}`);
    if (!nextEdge) {
      // Reached an unlinked branch/port, ends gracefully
      return {
        status: 'completed',
        steps,
        tokens: ctx.tokens,
        variables: ctx.variables,
      };
    }

    currentNode = nodeMap.get(nextEdge.target);
    sequence++;
  }

  return {
    status: 'completed',
    steps,
    tokens: ctx.tokens,
    variables: ctx.variables,
  };
}
