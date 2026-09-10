import { z } from 'zod';
export * from './enums.js';
export * from './phone.js';

export const nodeTypes = [
  'trigger.message_received', 'trigger.schedule', 'trigger.manual',
  'guard.test_mode', 'guard.human_takeover', 'guard.business_hours', 'guard.chat_type', 'guard.response_policy',
  'input.buffer', 'input.media', 'input.normalize',
  'context.memory', 'context.knowledge', 'context.crm', 'context.summarize', 'context.storage', 'context.conversation_state',
  'agent.decide', 'agent.classify', 'agent.extract', 'agent.score', 'agent.structured', 'agent.next_action',
  'flow.condition', 'flow.switch', 'flow.delay', 'flow.wait_reply', 'flow.loop', 'flow.required_fields',
  'action.update_stage', 'action.update_lead', 'action.crm_sync', 'action.handoff', 'action.webhook',
  'integration.google_calendar',
  'calendar.availability', 'calendar.create_event', 'calendar.reschedule_event', 'calendar.cancel_event',
  'output.send_text', 'output.send_media', 'output.send_template', 'output.smart_message', 'output.end',
] as const;
export const nodeTypeSchema = z.enum(nodeTypes);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const nextActionTypes = [
  'ASK_MISSING_FIELD',
  'SHOW_PRICE',
  'CHECK_CALENDAR',
  'CREATE_APPOINTMENT',
  'RESCHEDULE_APPOINTMENT',
  'CANCEL_APPOINTMENT',
  'SEND_INFORMATION',
  'HANDOFF',
  'END',
] as const;
export const nextActionSchema = z.enum(nextActionTypes);
export type NextAction = z.infer<typeof nextActionSchema>;

export const conversationStateStages = [
  'DISCOVERY',
  'QUALIFYING',
  'PRICING',
  'SCHEDULING',
  'CLOSING',
  'HANDOFF',
  'SUPPORT',
] as const;
export const conversationStateStageSchema = z.enum(conversationStateStages);
export type ConversationStateStage = z.infer<typeof conversationStateStageSchema>;
export const flowNodeSchema = z.strictObject({
  id: z.string().min(1).max(100), type: nodeTypeSchema, label: z.string().min(1).max(120),
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  config: z.record(z.string(), z.json()),
});
export const flowEdgeSchema = z.strictObject({
  id: z.string().min(1).max(100), source: z.string().min(1), target: z.string().min(1), sourcePort: z.string().min(1),
});
export const flowTestModeSchema = z.strictObject({
  enabled: z.boolean(),
  phone: z.string().max(50).default(''),
}).superRefine((mode, ctx) => {
  if (mode.enabled && (!/^\+?[\d\s()-]+$/.test(mode.phone) || !/^[1-9]\d{7,14}$/.test(mode.phone.replace(/\D/g, '')))) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Modo Teste: informe um único número com DDI e DDD, por exemplo +55 11 99999-9999.' });
  }
});
export const flowGraphSchema = z.strictObject({
  schemaVersion: z.literal(1), nodes: z.array(flowNodeSchema).min(1).max(250), edges: z.array(flowEdgeSchema).max(1000),
  testMode: flowTestModeSchema.optional(),
  loopLimit: z.number().int().min(1).max(20).default(5).optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowGraph = z.infer<typeof flowGraphSchema>;
export const saveFlowSchema = z.strictObject({ name: z.string().trim().min(1).max(120), graph: flowGraphSchema });
export const memberRoleSchema = z.enum(['owner', 'admin', 'agent', 'viewer']);
export type MemberRole = z.infer<typeof memberRoleSchema>;
export const queueNames = {
  maintenance: 'sdr-maintenance',
  turns: 'sdr-turns',
  inboundDebounce: 'sdr-inbound-debounce',
} as const;

export const commercialMemorySchema = z.strictObject({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  budget: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  decision_maker: z.boolean().nullable().optional(),
  pain_points: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  interest: z.string().nullable().optional(),
  urgency: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  stage_intent: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
});
export type CommercialMemory = z.infer<typeof commercialMemorySchema>;

export interface FlowContextLead {
  id: string;
  phone: string;
  name?: string | null;
  city?: string | null;
  interest?: string | null;
  urgency?: string | null;
  memory: CommercialMemory | Record<string, unknown>;
}

export interface FlowContextConversation {
  id: string;
  stage: string;
  bot_paused: boolean;
  handled_by: 'AI' | 'HUMAN' | 'SYSTEM';
}

export interface FlowContextMessage {
  id: string;
  text: string;
  fromMe: boolean;
  sender?: 'lead' | 'ai' | 'human' | 'system';
  type?: string;
  mediaUrl?: string;
}

export interface FlowContext {
  organizationId: string;
  connectionId: string;
  leadId: string;
  conversationId: string;
  executionId: string;
  flowVersionId: string;
  lead?: FlowContextLead;
  conversation?: FlowContextConversation;
  messages: Array<FlowContextMessage>;
  variables: Record<string, unknown>;
  tokens: { input: number; output: number };
  resumeNodeId?: string | null;
}

export interface NodeExecutionResult {
  port: string;
  output?: unknown;
  variables?: Record<string, unknown>;
  tokens?: { input?: number; output?: number };
  suspend?: boolean;
  error?: string;
}

export interface StepExecutionRecord {
  sequence: number;
  nodeId: string;
  nodeType: NodeType;
  input?: unknown;
  output?: unknown;
  durationMs: number;
  error?: string;
}

export interface FlowExecutionResult {
  status: 'completed' | 'waiting' | 'failed';
  resumeNodeId?: string | null;
  steps: StepExecutionRecord[];
  tokens: { input: number; output: number };
  variables: Record<string, unknown>;
  error?: string;
}

export type FlowExecutionEventType =
  | 'execution:started'
  | 'step:start'
  | 'step:complete'
  | 'step:failed'
  | 'execution:completed';

export interface FlowExecutionEvent {
  type: FlowExecutionEventType;
  executionId: string;
  organizationId: string;
  flowId?: string;
  conversationId?: string;
  debugSessionId?: string;
  timestamp: string;
  payload?: unknown;
}
