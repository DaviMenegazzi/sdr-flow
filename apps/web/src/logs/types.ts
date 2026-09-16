export type ExecutionStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed';

export interface ExecutionListItem {
  id: string;
  status: ExecutionStatus;
  trace_status: 'pending' | 'complete' | 'failed';
  created_at: string;
  finished_at: string | null;
  input_tokens: number;
  output_tokens: number;
  model: string | null;
  lead: { id: string; name: string | null; phone: string } | null;
  connection: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  flow_version: { id: string; version: number; flow: { id: string; name: string } | null } | null;
}

export interface ExecutionStep {
  id: string;
  node_id: string;
  sequence: number;
  input: unknown;
  output: unknown;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface ExecutionDetail extends ExecutionListItem {
  conversation_id: string;
  flow_version:
    | (NonNullable<ExecutionListItem['flow_version']> & { nodes: Array<{ id: string; type: string; label: string }> })
    | null;
}
