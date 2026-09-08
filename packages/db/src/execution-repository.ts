import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types.js';

export type AnyDbClient = SupabaseClient<Database>;

export interface CreateExecutionInput {
  organizationId: string;
  conversationId: string;
  flowVersionId: string;
  status?: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
  resumeNodeId?: string | null;
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
      })
      .select()
      .single();

    if (error) throw error;
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

  async listExecutions(organizationId: string, limit = 50) {
    const { data, error } = await this.db
      .from('flow_executions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
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
