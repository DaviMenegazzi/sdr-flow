import { describe, expect, it, vi } from 'vitest';
import { waitForTraceCompletion } from '../packages/runtime/src/trace/trace-completion.js';

// Fase 3 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 9.2.10, 9.3): flow_executions.trace_status
// must never read 'complete' until every step the runtime produced has actually landed in
// Postgres — replay/debug consumers rely on this to avoid treating a still-draining trace as
// finished.

function makeDb(countSequence: number[]) {
  let call = 0;
  const updates: Array<{ status: string; executionId: string }> = [];
  const db: any = {
    from: vi.fn((table: string) => {
      if (table === 'flow_execution_steps') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: countSequence[Math.min(call++, countSequence.length - 1)], error: null }),
            }),
          }),
        };
      }
      if (table === 'flow_executions') {
        return {
          update: (patch: any) => ({
            eq: () => ({
              eq: () => {
                updates.push({ status: patch.trace_status, executionId: 'n/a' });
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { db, updates };
}

describe('waitForTraceCompletion', () => {
  it('marks trace_status complete as soon as the persisted count reaches the expected step count', async () => {
    const { db, updates } = makeDb([2, 5]); // first poll sees 2/5, second sees 5/5
    const status = await waitForTraceCompletion({ db, organizationId: 'org-1', executionId: 'exec-1', expectedStepCount: 5, pollIntervalMs: 1, timeoutMs: 1000 });
    expect(status).toBe('complete');
    expect(updates).toEqual([{ status: 'complete', executionId: 'n/a' }]);
  });

  it('marks trace_status failed (not silently complete) when the writer never catches up in time', async () => {
    const { db, updates } = makeDb([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const status = await waitForTraceCompletion({ db, organizationId: 'org-1', executionId: 'exec-1', expectedStepCount: 5, pollIntervalMs: 5, timeoutMs: 30 });
    expect(status).toBe('failed');
    expect(updates).toEqual([{ status: 'failed', executionId: 'n/a' }]);
  });

  it('completes immediately for a zero-step execution without polling', async () => {
    const { db, updates } = makeDb([]);
    const status = await waitForTraceCompletion({ db, organizationId: 'org-1', executionId: 'exec-1', expectedStepCount: 0 });
    expect(status).toBe('complete');
    expect(updates).toEqual([{ status: 'complete', executionId: 'n/a' }]);
  });
});
