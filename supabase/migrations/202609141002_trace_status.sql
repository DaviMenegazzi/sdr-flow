begin;

-- Phase 3 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 9): asynchronous, batched trace
-- persistence. executeFlow's onStepComplete hook no longer inserts one row per node on the
-- critical path — steps are appended to a Redis Stream (packages/runtime/src/trace) and
-- written to flow_execution_steps in batches by a consumer-group writer. trace_status tracks
-- whether that batch writer has actually caught up, so a reader (replay, debug UI) never
-- treats a still-draining trace as complete (9.3).
alter table public.flow_executions
  add column if not exists trace_status text not null default 'pending'
    check (trace_status in ('pending', 'complete', 'failed'));

create index if not exists flow_executions_trace_status_idx on public.flow_executions(trace_status) where trace_status = 'pending';

commit;
