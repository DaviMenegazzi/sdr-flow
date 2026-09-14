import type { ServiceDb } from '../inbound/inbound-event-repository.js';

// Waits for the batch writer to catch up on one execution's trace, then flips
// flow_executions.trace_status accordingly (9.2.10, 9.3) — called once by the turn processor
// right after executeFlow returns, so it knows exactly how many steps to expect. Polling is a
// deliberate, simple choice over a completion signal: the batch writer is a separate,
// independently-scheduled consumer loop with no back-channel to the caller, and this is a
// short, bounded wait (batches drain every couple hundred ms in the common case).

export interface WaitForTraceCompletionOptions {
  db: ServiceDb;
  organizationId: string;
  executionId: string;
  expectedStepCount: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export async function waitForTraceCompletion(options: WaitForTraceCompletionOptions): Promise<'complete' | 'failed'> {
  const { db, organizationId, executionId, expectedStepCount } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  if (expectedStepCount === 0) {
    await setTraceStatus(db, organizationId, executionId, 'complete');
    return 'complete';
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { count, error } = await db
      .from('flow_execution_steps')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('execution_id', executionId);
    if (!error && (count ?? 0) >= expectedStepCount) {
      await setTraceStatus(db, organizationId, executionId, 'complete');
      return 'complete';
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  await setTraceStatus(db, organizationId, executionId, 'failed');
  return 'failed';
}

async function setTraceStatus(db: ServiceDb, organizationId: string, executionId: string, status: 'complete' | 'failed'): Promise<void> {
  try {
    await db.from('flow_executions').update({ trace_status: status } as any).eq('id', executionId).eq('organization_id', organizationId);
  } catch (err) {
    console.warn('[trace-completion] Falha ao atualizar trace_status:', err);
  }
}
