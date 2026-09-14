// Reproducible benchmark for MetricsRepository.getDashboardMetrics against a disposable
// PGlite database seeded with synthetic (no real customer data) conversations/messages/
// executions, per docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 6.2.
//
// Usage: tsx scripts/benchmark-metrics.ts [--messages=100000] [--conversations=4000] [--iterations=5] [--out=file.json]
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../tests/helpers/database.js';
import { MetricsRepository } from '../packages/db/src/metrics-repository.js';

interface CliArgs {
  messages: number;
  conversations: number;
  iterations: number;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { messages: 100_000, conversations: 4000, iterations: 5 };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'messages' && value) args.messages = Number(value);
    if (key === 'conversations' && value) args.conversations = Number(value);
    if (key === 'iterations' && value) args.iterations = Math.max(1, Number(value));
    if (key === 'out' && value) args.out = value;
  }
  return args;
}

const STAGES = [
  'NEW_CONVERSATION', 'QUALIFYING', 'COLLECTING_INFORMATION', 'PRESENTING_SOLUTION',
  'NEGOTIATING', 'CONVERTED', 'HUMAN_HANDOFF', 'CLOSED',
] as const;

async function seed(db: Awaited<ReturnType<typeof testDatabase>>, args: CliArgs) {
  const orgId = randomUUID();
  const connectionId = randomUUID();
  const ownerId = randomUUID();
  await db.exec(`insert into auth.users (id, email) values ('${ownerId}','bench@example.com')`);
  await db.query(`insert into public.organizations (id, name) values ($1,'bench-metrics')`, [orgId]);
  await db.query(`insert into public.organization_members (organization_id, user_id, role) values ($1,$2,'owner')`, [orgId, ownerId]);
  await db.query(
    `insert into public.connections (id, organization_id, name, provider) values ($1,$2,'bench','evolution')`,
    [connectionId, orgId]
  );
  const flowId = randomUUID();
  // Spread across several published versions like a real org republishing over time. A single
  // shared flow_version_id here reproduces a confirmed defect in the current flowComparison
  // query (packages/db/src/metrics-repository.ts): it LEFT JOINs conversations and
  // flow_executions on flow_version_id independently, so summing tokens fans out to
  // conversations_count x executions_count rows per version. At 4000 conversations x 5000
  // executions on one version this overflows the ::int cast outright ("integer out of range",
  // Postgres code 22003) instead of merely inflating totals — see the Phase 0 evidence report.
  const FLOW_VERSION_COUNT = 10;
  const flowVersionIds: string[] = [];
  await db.query(`insert into public.flows (id, organization_id, name, draft) values ($1,$2,'bench','{}')`, [flowId, orgId]);
  for (let v = 1; v <= FLOW_VERSION_COUNT; v++) {
    const id = randomUUID();
    flowVersionIds.push(id);
    await db.query(
      `insert into public.flow_versions (id, organization_id, flow_id, version, graph) values ($1,$2,$3,$4,'{}')`,
      [id, orgId, flowId, v]
    );
  }

  const conversationIds: string[] = [];
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const CONV_BATCH = 500;
  for (let batchStart = 0; batchStart < args.conversations; batchStart += CONV_BATCH) {
    const batch = Math.min(CONV_BATCH, args.conversations - batchStart);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < batch; i++) {
      const id = randomUUID();
      conversationIds.push(id);
      const leadId = randomUUID();
      const stage = STAGES[(batchStart + i) % STAGES.length];
      const createdAt = new Date(now - Math.random() * ninetyDaysMs).toISOString();
      const flowVersionId = flowVersionIds[(batchStart + i) % flowVersionIds.length]!;
      const base = params.length;
      params.push(id, orgId, connectionId, leadId, stage, flowVersionId, createdAt);
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
      // Each lead/conversation pair needs a lead row for FK integrity.
      await db.query(`insert into public.leads (id, organization_id, phone) values ($1,$2,$3)`, [leadId, orgId, `55119${String(batchStart + i).padStart(8, '0')}`]);
    }
    await db.query(
      `insert into public.conversations (id, organization_id, connection_id, lead_id, stage, flow_version_id, created_at, handled_by)
       select v.id::uuid, v.org::uuid, v.conn::uuid, v.lead::uuid, v.stage::public.conversation_stage, v.fv::uuid, v.created_at::timestamptz, 'AI'
       from (values ${values.join(',')}) as v(id, org, conn, lead, stage, fv, created_at)`,
      params
    );
  }

  const MSG_BATCH = 2000;
  let inserted = 0;
  while (inserted < args.messages) {
    const batch = Math.min(MSG_BATCH, args.messages - inserted);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < batch; i++) {
      const conversationId = conversationIds[Math.floor(Math.random() * conversationIds.length)]!;
      const direction = i % 2 === 0 ? 'INBOUND' : 'OUTBOUND';
      const sender = direction === 'INBOUND' ? 'lead' : 'ai';
      const createdAt = new Date(now - Math.random() * ninetyDaysMs).toISOString();
      const base = params.length;
      params.push(randomUUID(), orgId, connectionId, conversationId, direction, sender, `msg ${inserted + i}`, createdAt);
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
    }
    await db.query(
      `insert into public.messages (id, organization_id, connection_id, conversation_id, direction, sender, content, created_at)
       values ${values.join(',')}`,
      params
    );
    inserted += batch;
  }

  const EXEC_BATCH = 1000;
  let execInserted = 0;
  const execTarget = Math.min(args.conversations, 5000);
  while (execInserted < execTarget) {
    const batch = Math.min(EXEC_BATCH, execTarget - execInserted);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < batch; i++) {
      const convIndex = (execInserted + i) % conversationIds.length;
      const conversationId = conversationIds[convIndex]!;
      const flowVersionId = flowVersionIds[convIndex % flowVersionIds.length]!;
      const base = params.length;
      params.push(randomUUID(), orgId, conversationId, flowVersionId, 'completed', 500, 250);
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    }
    await db.query(
      `insert into public.flow_executions (id, organization_id, conversation_id, flow_version_id, status, input_tokens, output_tokens)
       values ${values.join(',')}`,
      params
    );
    execInserted += batch;
  }

  return { orgId };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]! * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await testDatabase();

  const seedStart = performance.now();
  const { orgId } = await seed(db, args);
  const seedMs = Math.round(performance.now() - seedStart);

  const repo = new MetricsRepository(db);
  const endDate = new Date().toISOString().split('T')[0]!;
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
  const samples: number[] = [];
  let lastResult: unknown;
  for (let i = 0; i < args.iterations; i++) {
    const start = performance.now();
    lastResult = await repo.getDashboardMetrics(orgId, { startDate, endDate });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: { organizationId: orgId, conversations: args.conversations, messages: args.messages, seedMs },
    queryDurationMs: {
      iterations: args.iterations,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      min: Math.round(samples[0]! * 100) / 100,
      max: Math.round(samples[samples.length - 1]! * 100) / 100,
    },
    resultSample: lastResult,
    note: 'PGlite/local measurement per docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 10.6 — staging (hosted Supabase, warm indexes) homologation remains pending until run against a real project. Message timestamps are uniformly random over the window (not correlated inbound->outbound), so resultSample.avgFirstResponseTimeSec / avgResponseTimeSec are not representative of real response latency — this script measures query duration, not FRT accuracy (covered separately by tests/dashboard-metrics.test.ts). Since Fase 4, this calls the same public.get_dashboard_metrics RPC production uses (packages/db/src/metrics-repository.ts), not a bespoke benchmark query.',
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
