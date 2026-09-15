import type { ServiceDb } from '../inbound/inbound-event-repository.js';
import { bufferWindowSeconds, type RedisTurnBuffer } from './redis-buffer.js';
import type { FlowGraph } from '@sdr/shared';

// Shared "resolve which flow, then enqueue" step, used by the webhook's hot path
// (apps/api/src/webhook.ts, right after accept_inbound_event), by the worker's outbox
// dispatcher recovering events stuck in inbound_events after a Redis outage
// (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.3.6), and — via resolveTurnFlow alone, with no
// Redis involved — by the TURN_PROCESSING_MODE=api dev-only inline fallback (no worker
// process, no debounce; see webhook.ts). One implementation, not three copies that drift.
// Never touches lead/conversation/flow execution: that only happens once the turn fires (see
// turn-processor.ts), keeping this step cheap enough to run in the webhook's response path.

export interface TurnFlowResolution {
  organizationId: string;
  flowId: string;
  /** The immutable version the runtime will actually execute for this connection. */
  flowVersionId: string;
  flowName: string;
  flowVersion: number;
  flowVersionCreatedAt: string;
  graph: FlowGraph;
  windowSeconds: number;
}

export type ResolveTurnFlowResult =
  | ({ status: 'resolved' } & TurnFlowResolution)
  | { status: 'connection_not_found' | 'assigned_agent_not_found' | 'no_published_flow' | 'invalid_flow_version'; organizationId?: string };

export async function resolveTurnFlow(db: ServiceDb, connectionId: string): Promise<ResolveTurnFlowResult> {
  const { data: connection, error: connErr } = await db.from('connections').select('*').eq('id', connectionId).single();
  if (connErr || !connection) return { status: 'connection_not_found' };
  const organizationId = connection.organization_id;

  const { data: assignedAgent } = await db
    .from('ai_agents')
    .select('id,flow_id,active_flow_version_id,status')
    .eq('organization_id', organizationId)
    .eq('owner_user_id', connection.owner_user_id)
    .eq('id', connection.agent_id)
    .eq('status', 'active')
    .maybeSingle();
  if (!assignedAgent) return { status: 'assigned_agent_not_found', organizationId };

  let flowQuery = db
    .from('flows')
    .select('id, name, published_version_id')
    .eq('organization_id', organizationId)
    .not('published_version_id', 'is', null);
  flowQuery = assignedAgent.flow_id
    ? flowQuery.eq('id', assignedAgent.flow_id)
    : flowQuery.order('updated_at', { ascending: false }).limit(1);
  const { data: flow } = await flowQuery.maybeSingle();
  if (!flow?.published_version_id) return { status: 'no_published_flow', organizationId };

  const selectedFlowVersionId = assignedAgent.active_flow_version_id || flow.published_version_id;
  const { data: flowVersion } = await db
    .from('flow_versions')
    .select('id, version, created_at, graph')
    .eq('organization_id', organizationId)
    .eq('flow_id', flow.id)
    .eq('id', selectedFlowVersionId)
    .single();
  if (!flowVersion?.graph) return { status: 'invalid_flow_version', organizationId };

  return {
    status: 'resolved',
    organizationId,
    flowId: flow.id,
    flowVersionId: flowVersion.id,
    flowName: flow.name,
    flowVersion: flowVersion.version,
    flowVersionCreatedAt: flowVersion.created_at,
    graph: flowVersion.graph as unknown as FlowGraph,
    windowSeconds: bufferWindowSeconds(flowVersion.graph as FlowGraph),
  };
}

export interface TurnProducerDeps {
  db: ServiceDb;
  buffer: Pick<RedisTurnBuffer, 'enqueue'>;
}

export interface ResolveAndEnqueueInput {
  connectionId: string;
  /** inbound_events.id already durably accepted — never a raw, unpersisted event. */
  eventId: string;
  phone: string;
}

export type ResolveAndEnqueueResult =
  | { status: 'queued'; organizationId: string; flowId: string; flowVersionId: string; generation: number; delayMs: number; conversationKey: string }
  | { status: 'connection_not_found' | 'assigned_agent_not_found' | 'no_published_flow' | 'invalid_flow_version'; organizationId?: string };

export async function resolveAndEnqueueTurn(deps: TurnProducerDeps, input: ResolveAndEnqueueInput): Promise<ResolveAndEnqueueResult> {
  const resolution = await resolveTurnFlow(deps.db, input.connectionId);
  if (resolution.status !== 'resolved') return resolution;

  const conversationKey = `${input.connectionId}:${input.phone}`;
  const { generation, delayMs } = await deps.buffer.enqueue({
    kind: 'published',
    organizationId: resolution.organizationId,
    connectionId: input.connectionId,
    conversationKey,
    flowId: resolution.flowId,
    flowVersionId: resolution.flowVersionId,
    windowSeconds: resolution.windowSeconds,
    inboundEventId: input.eventId,
  });

  return { status: 'queued', organizationId: resolution.organizationId, flowId: resolution.flowId, flowVersionId: resolution.flowVersionId, generation, delayMs, conversationKey };
}
