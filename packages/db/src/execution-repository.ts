import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types.js';

export type AnyDbClient = SupabaseClient<Database>;

export interface CreateExecutionInput {
  organizationId: string;
  conversationId: string;
  flowVersionId: string;
  status?: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
  resumeNodeId?: string | null;
  /**
   * Turn-level idempotency key (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 7.5), unique per
   * organization via flow_executions_idempotency_key_idx. A retried worker job for the same
   * logical turn recovers the execution already created instead of creating a duplicate.
   */
  idempotencyKey?: string;
  /**
   * Denormalized at creation time (202609162003_flow_execution_context.sql) so the admin
   * execution log's history is never rewritten by a later reassignment or agent/model change.
   */
  connectionId?: string | null;
  leadId?: string | null;
  agentId?: string | null;
  model?: string | null;
}

export interface UpdateExecutionInput {
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
  inputTokens?: number;
  outputTokens?: number;
  resumeNodeId?: string | null;
  finishedAt?: string | null;
}

export interface RecordStepInput {
  organizationId: string;
  executionId: string;
  nodeId: string;
  sequence: number;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  error?: string | null;
}

export interface ListExecutionsFilters {
  connectionId?: string;
  leadId?: string;
  status?: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
  /** Inclusive, 'YYYY-MM-DD' (matches the dashboard metrics query's date convention). */
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface ExecutionListRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  flow_version_id: string;
  connection_id: string | null;
  lead_id: string | null;
  agent_id: string | null;
  model: string | null;
  status: string;
  input_tokens: number;
  output_tokens: number;
  resume_node_id: string | null;
  created_at: string;
  finished_at: string | null;
  trace_status: string;
  lead: { id: string; name: string | null; phone: string } | null;
  connection: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  flow_version: { id: string; version: number; flow: { id: string; name: string } | null } | null;
}

export interface ExecutionDetailRow extends ExecutionListRow {
  flow_version: (NonNullable<ExecutionListRow['flow_version']> & { graph: unknown }) | null;
}

// Same embed style already shipped in InboxRepository.listConversations/getConversationDetail
// (packages/db/src/inbox-repository.ts) — the generated database.types.ts never populates
// per-table Relationships (see scripts/generate-db-types.ts), so Supabase's embed inference
// can't type these results; ExecutionListRow/ExecutionDetailRow are hand-written instead.
const EXECUTION_LIST_SELECT = `*,
  lead:leads(id, name, phone),
  connection:connections(id, name),
  agent:ai_agents(id, name),
  flow_version:flow_versions(id, version, flow:flows(id, name))`;

const EXECUTION_DETAIL_SELECT = `*,
  lead:leads(id, name, phone),
  connection:connections(id, name),
  agent:ai_agents(id, name),
  flow_version:flow_versions(id, version, graph, flow:flows(id, name))`;

export class ExecutionRepository {
  constructor(private readonly db: AnyDbClient) {}

  async createExecution(input: CreateExecutionInput) {
    const { data, error } = await this.db
      .from('flow_executions')
      .insert({
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        flow_version_id: input.flowVersionId,
        status: input.status || 'running',
        resume_node_id: input.resumeNodeId || null,
        idempotency_key: input.idempotencyKey || null,
        connection_id: input.connectionId ?? null,
        lead_id: input.leadId ?? null,
        agent_id: input.agentId ?? null,
        model: input.model ?? null,
      })
      .select()
      .single();

    if (error) {
      if (input.idempotencyKey && (error as { code?: string }).code === '23505') {
        const { data: existing, error: fetchError } = await this.db
          .from('flow_executions')
          .select('*')
          .eq('organization_id', input.organizationId)
          .eq('idempotency_key', input.idempotencyKey)
          .single();
        if (fetchError) throw fetchError;
        return existing;
      }
      throw error;
    }
    return data;
  }

  async updateExecution(id: string, organizationId: string, input: UpdateExecutionInput) {
    const patch: Database['public']['Tables']['flow_executions']['Update'] = { status: input.status };
    if (input.inputTokens !== undefined) patch.input_tokens = input.inputTokens;
    if (input.outputTokens !== undefined) patch.output_tokens = input.outputTokens;
    if (input.resumeNodeId !== undefined) patch.resume_node_id = input.resumeNodeId;
    if (input.finishedAt !== undefined) patch.finished_at = input.finishedAt;

    const { data, error } = await this.db
      .from('flow_executions')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async recordStep(input: RecordStepInput) {
    const { data, error } = await this.db
      .from('flow_execution_steps')
      .insert({
        organization_id: input.organizationId,
        execution_id: input.executionId,
        node_id: input.nodeId,
        sequence: input.sequence,
        input: (input.input as Json) ?? null,
        output: (input.output as Json) ?? null,
        duration_ms: input.durationMs ?? 0,
        error: input.error ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getExecution(id: string, organizationId: string) {
    const { data, error } = await this.db
      .from('flow_executions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /** Denormalized detail for the admin execution log — kept separate from getExecution so
   * POST /executions/:id/replay (getExecution's other caller) never pays for these joins. */
  async getExecutionDetail(id: string, organizationId: string): Promise<ExecutionDetailRow | null> {
    const { data, error } = await (this.db as any)
      .from('flow_executions')
      .select(EXECUTION_DETAIL_SELECT)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) throw error;
    return (data as ExecutionDetailRow | null) ?? null;
  }

  async listExecutions(
    organizationId: string,
    filters: ListExecutionsFilters = {}
  ): Promise<{ executions: ExecutionListRow[]; total: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    let query = (this.db as any)
      .from('flow_executions')
      .select(EXECUTION_LIST_SELECT, { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.connectionId) query = query.eq('connection_id', filters.connectionId);
    if (filters.leadId) query = query.eq('lead_id', filters.leadId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.startDate) query = query.gte('created_at', `${filters.startDate}T00:00:00.000Z`);
    if (filters.endDate) query = query.lte('created_at', `${filters.endDate}T23:59:59.999Z`);

    const { data, error, count } = await query;
    if (error) throw error;
    return { executions: (data || []) as ExecutionListRow[], total: count ?? 0 };
  }

  async getExecutionSteps(executionId: string, organizationId: string) {
    const { data, error } = await this.db
      .from('flow_execution_steps')
      .select('*')
      .eq('execution_id', executionId)
      .eq('organization_id', organizationId)
      .order('sequence', { ascending: true });

    if (error) throw error;
    return data || [];
  }
}
