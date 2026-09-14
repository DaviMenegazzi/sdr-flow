// Reproducible, no-external-services benchmark for packages/flow's executeFlow.
// Builds deterministic graphs of N `flow.condition` nodes (pure, no LLM/WhatsApp/Supabase
// calls) and measures engine dispatch overhead alone ("engine" mode) versus the cost of
// persisting one flow_execution_step per node the way production does today ("db" mode,
// backed by a throwaway PGlite instance running the real migrations).
//
// Usage: tsx scripts/benchmark-turn-runtime.ts [--iterations=20] [--sizes=10,25,50] [--out=file.json]
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { executeFlow } from '../packages/flow/src/engine.js';
import type { FlowContext, FlowGraph } from '../packages/shared/src/index.js';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../tests/helpers/database.js';

interface CliArgs {
  iterations: number;
  sizes: number[];
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { iterations: 20, sizes: [10, 25, 50] };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'iterations' && value) args.iterations = Math.max(1, Number(value));
    if (key === 'sizes' && value) args.sizes = value.split(',').map(Number).filter(n => n > 0);
    if (key === 'out' && value) args.out = value;
  }
  return args;
}

function buildGraph(nodeCount: number): FlowGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    type: 'flow.condition' as const,
    label: `Condition ${i}`,
    position: { x: i * 120, y: 0 },
    config: { variable: 'benchmark', operator: 'equals', value: '1' },
  }));
  const edges = nodes.slice(0, -1).map((node, i) => ({
    id: `e${i}`,
    source: node.id,
    target: nodes[i + 1]!.id,
    sourcePort: 'true',
  }));
  return { schemaVersion: 1, nodes, edges, loopLimit: 1 };
}

function baseContext(): FlowContext {
  return {
    organizationId: '00000000-0000-4000-8000-000000000001',
    connectionId: '00000000-0000-4000-8000-000000000002',
    leadId: '00000000-0000-4000-8000-000000000003',
    conversationId: '00000000-0000-4000-8000-000000000004',
    executionId: '00000000-0000-4000-8000-000000000005',
    flowVersionId: '00000000-0000-4000-8000-000000000006',
    messages: [],
    variables: { benchmark: '1' },
    tokens: { input: 0, output: 0 },
  };
}

const noopServices = {
  messaging: { sendText: async () => ({ sent: false }), sendMedia: async () => ({ sent: false }), sendTemplate: async () => ({ sent: false }) },
  fetch: globalThis.fetch,
  db: {
    updateLead: async () => {},
    updateConversation: async () => {},
    saveMessage: async () => ({ id: 'msg' }),
    syncDeal: async () => ({ id: 'deal' }),
    getMessages: async () => [],
    getLeadRecentMessages: async () => [],
  },
  now: () => new Date(),
} as any;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]! * 100) / 100;
}

async function measure(fn: () => Promise<unknown>, iterations: number) {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    iterations,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    minMs: Math.round(samples[0]! * 100) / 100,
    maxMs: Math.round(samples[samples.length - 1]! * 100) / 100,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await testDatabase();
  const ownerId = '00000000-0000-4000-8000-000000000099';
  await db.exec(`
    insert into auth.users (id, email) values ('${ownerId}','bench@example.com') on conflict do nothing;
  `);
  await db.query(`insert into public.organizations (id, name) values ($1,'bench') on conflict do nothing`, ['00000000-0000-4000-8000-000000000001']);
  await db.query(
    `insert into public.organization_members (organization_id, user_id, role) values ($1,$2,'owner') on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000001', ownerId]
  );
  await db.query(
    `insert into public.connections (id, organization_id, name, provider) values ($1,$2,'bench','evolution') on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001']
  );
  await db.query(
    `insert into public.leads (id, organization_id, phone) values ($1,$2,'5511999999999') on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001']
  );
  await db.query(
    `insert into public.flows (id, organization_id, name, draft) values ($1,$2,'bench','{}') on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001']
  );
  await db.query(
    `insert into public.flow_versions (id, organization_id, flow_id, version, graph) values ($1,$2,$3,1,'{}') on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007']
  );
  await db.query(
    `insert into public.conversations (id, organization_id, connection_id, lead_id) values ($1,$2,$3,$4) on conflict do nothing`,
    ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
  );

  const results: Record<string, unknown>[] = [];

  for (const size of args.sizes) {
    const graph = buildGraph(size);

    const engineStats = await measure(async () => {
      await executeFlow(graph, { ...baseContext(), variables: { benchmark: '1' } }, noopServices, { maxSteps: size + 1 });
    }, args.iterations);

    // Mirrors ConversationRepository/ExecutionRepository's production call shape (raw insert,
    // .select().single()) via PGlite's SQL interface — the Supabase JS client itself only
    // speaks to a real project, so network latency to hosted Supabase is out of scope here
    // (see docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 10.6 on PGlite/local vs. staging).
    let writeCount = 0;
    const dbStats = await measure(async () => {
      const executionId = randomUUID();
      await db.query(
        `insert into public.flow_executions (id, organization_id, conversation_id, flow_version_id, status) values ($1,$2,$3,$4,'running')`,
        [executionId, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006']
      );
      await executeFlow(graph, { ...baseContext(), executionId, variables: { benchmark: '1' } }, noopServices, {
        maxSteps: size + 1,
        hooks: {
          onStepComplete: async step => {
            writeCount++;
            await db.query(
              `insert into public.flow_execution_steps (organization_id, execution_id, node_id, sequence, input, output, duration_ms, error)
               values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
              [
                '00000000-0000-4000-8000-000000000001',
                executionId,
                step.nodeId,
                step.sequence,
                JSON.stringify(step.input ?? null),
                JSON.stringify(step.output ?? null),
                step.durationMs,
                step.error ?? null,
              ]
            );
          },
        },
      });
    }, args.iterations);

    // Fase 3 target shape: accumulate steps and write them in a single batched upsert, the way
    // TraceBatchWriter does (packages/runtime/src/trace/trace-batch-writer.ts) — one Postgres
    // round trip per run instead of one per node. Does not model the Redis XADD/XREADGROUP
    // transport cost (sub-millisecond locally, negligible next to a Postgres round trip; not
    // reproducible meaningfully without a real Redis — see 12.1).
    let batchWriteCount = 0;
    const batchedStats = await measure(async () => {
      const executionId = randomUUID();
      await db.query(
        `insert into public.flow_executions (id, organization_id, conversation_id, flow_version_id, status) values ($1,$2,$3,$4,'running')`,
        [executionId, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006']
      );
      const buffered: Array<{ nodeId: string; sequence: number; input: unknown; output: unknown; durationMs: number; error?: string }> = [];
      await executeFlow(graph, { ...baseContext(), executionId, variables: { benchmark: '1' } }, noopServices, {
        maxSteps: size + 1,
        hooks: {
          onStepComplete: async step => { buffered.push(step); },
        },
      });
      if (buffered.length > 0) {
        batchWriteCount++;
        const values: string[] = [];
        const params: unknown[] = [];
        for (const step of buffered) {
          const base = params.length;
          params.push('00000000-0000-4000-8000-000000000001', executionId, step.nodeId, step.sequence, JSON.stringify(step.input ?? null), JSON.stringify(step.output ?? null), step.durationMs, step.error ?? null);
          values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
        }
        await db.query(
          `insert into public.flow_execution_steps (organization_id, execution_id, node_id, sequence, input, output, duration_ms, error) values ${values.join(',')}`,
          params
        );
      }
    }, args.iterations);

    results.push({
      nodeCount: size,
      engineOnly: engineStats,
      currentPerStepSupabaseWrite: { ...dbStats, writesPerRun: Math.round(writeCount / args.iterations) },
      phase3BatchedWrite: { ...batchedStats, writesPerRun: Math.round(batchWriteCount / args.iterations) },
      persistenceOverheadReductionPct: Math.round((1 - (batchedStats.p50Ms - engineStats.p50Ms) / Math.max(0.001, dbStats.p50Ms - engineStats.p50Ms)) * 1000) / 10,
    });
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    engine: 'packages/flow executeFlow (deterministic flow.condition chain, no LLM/WhatsApp)',
    notes: 'currentPerStepSupabaseWrite mirrors production before Phase 3: one flow_execution_steps insert per node, awaited synchronously (see packages/flow/src/engine.ts onStepComplete). phase3BatchedWrite mirrors production after Phase 3: steps accumulated and written in one batched request per run (packages/runtime/src/trace/trace-batch-writer.ts), the same shape TraceBatchWriter uses. persistenceOverheadReductionPct compares the two write modes\' overhead above pure engine dispatch (target: >=50%, per 9.5).',
    results,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    await writeFile(args.out, json, 'utf8');
    console.log(`Benchmark written to ${args.out}`);
  }
  console.log(json);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
