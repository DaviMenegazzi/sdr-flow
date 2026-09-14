import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase, asUser } from './helpers/database.js';

// Fase 4 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md secao 10): public.get_dashboard_metrics
// computed entirely in Postgres, exercised directly against the real migrations (PGlite) —
// same pattern as tests/database.test.ts. Covers the semantics the plan explicitly requires:
// date-range exclusion, UTC boundaries, the full canonical funnel (including zero-count
// stages), FRT from real messages (never fixed), and — the confirmed bug from the Fase 0
// baseline — that the flow-version comparison no longer multiplies token sums by conversation
// count.

async function seedOrg(db: PGlite, name: string) {
  const owner = randomUUID();
  await db.query('insert into auth.users(id, email) values($1,$2)', [owner, `${owner}@test.local`]);
  const orgId = await asUser(db, owner, async () =>
    (await db.query<{ id: string }>(`select public.create_organization('${name}') as id`)).rows[0]!.id
  );
  const conn = await db.query<{ id: string }>(
    "insert into public.connections(organization_id,name,provider) values($1,'WA','evolution') returning id",
    [orgId]
  );
  return { orgId, connectionId: conn.rows[0]!.id };
}

async function seedFlowVersion(db: PGlite, orgId: string, name: string) {
  const flow = await db.query<{ id: string }>(`insert into public.flows(organization_id,name,draft) values($1,$2,'{}') returning id`, [orgId, name]);
  const version = await db.query<{ id: string }>(
    `insert into public.flow_versions(organization_id,flow_id,version,graph) values($1,$2,1,'{}') returning id`,
    [orgId, flow.rows[0]!.id]
  );
  return { flowId: flow.rows[0]!.id, flowVersionId: version.rows[0]!.id };
}

async function seedConversation(
  db: PGlite,
  args: { orgId: string; connectionId: string; flowVersionId: string; stage: string; createdAt: string },
) {
  const leadId = randomUUID();
  await db.query(
    `insert into public.leads(id,organization_id,connection_id,phone) values($1,$2,$3,$4)`,
    [leadId, args.orgId, args.connectionId, `5511${Math.floor(Math.random() * 1e9)}`]
  );
  const conv = await db.query<{ id: string }>(
    `insert into public.conversations(organization_id,connection_id,lead_id,stage,flow_version_id,created_at) values($1,$2,$3,$4,$5,$6) returning id`,
    [args.orgId, args.connectionId, leadId, args.stage, args.flowVersionId, args.createdAt]
  );
  return conv.rows[0]!.id;
}

async function callRpc(db: PGlite, orgId: string, startDate: string, endDate: string) {
  const res = await db.query<{ metrics: any }>('select public.get_dashboard_metrics($1,$2::date,$3::date) as metrics', [orgId, startDate, endDate]);
  return res.rows[0]!.metrics;
}

describe('get_dashboard_metrics (Fase 4)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await testDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('excludes conversations created before startDate or on/after endDate+1', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa Range');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-01-01T12:00:00Z' }); // before range
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-01-10T12:00:00Z' }); // in range
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-01-20T12:00:00Z' }); // after range

    const metrics = await callRpc(db, orgId, '2026-01-05', '2026-01-15');
    expect(metrics.totalConversations).toBe(1);
  });

  it('treats the interval as inclusive of startDate and endDate in UTC, regardless of exact time-of-day', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa UTC');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-02-01T00:00:00.000Z' }); // exact start of startDate
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-02-03T23:59:59.999Z' }); // last instant of endDate
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: '2026-02-04T00:00:00.000Z' }); // first instant after endDate — excluded

    const metrics = await callRpc(db, orgId, '2026-02-01', '2026-02-03');
    expect(metrics.totalConversations).toBe(2);
  });

  it('always returns all eight canonical stages in the funnel, including zero-count ones, in pipeline order', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa Funil');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'PRESENTING_SOLUTION', createdAt: new Date().toISOString() });

    const today = new Date().toISOString().split('T')[0]!;
    const metrics = await callRpc(db, orgId, today, today);
    expect(metrics.funnel).toHaveLength(8);
    expect(metrics.funnel.map((f: any) => f.stage)).toEqual([
      'NEW_CONVERSATION', 'QUALIFYING', 'COLLECTING_INFORMATION', 'PRESENTING_SOLUTION',
      'NEGOTIATING', 'CONVERTED', 'HUMAN_HANDOFF', 'CLOSED',
    ]);
    expect(metrics.funnel.find((f: any) => f.stage === 'CLOSED').count).toBe(0);
    expect(metrics.funnel.find((f: any) => f.stage === 'PRESENTING_SOLUTION').count).toBe(1);
  });

  it('computes FRT from real inbound/outbound message timestamps, never a fixed constant', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa FRT');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    const convId = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: new Date().toISOString() });
    const inboundAt = new Date(Date.now() - 42_000).toISOString();
    const outboundAt = new Date().toISOString();
    await db.query(
      `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,created_at) values($1,$2,$3,'INBOUND','lead','oi',$4)`,
      [orgId, connectionId, convId, inboundAt]
    );
    await db.query(
      `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,created_at) values($1,$2,$3,'OUTBOUND','ai','ola',$4)`,
      [orgId, connectionId, convId, outboundAt]
    );

    const today = new Date().toISOString().split('T')[0]!;
    const metrics = await callRpc(db, orgId, today, today);
    expect(metrics.avgFirstResponseTimeSec).not.toBe(4.2);
    expect(metrics.avgFirstResponseTimeSec).toBeGreaterThanOrEqual(41);
    expect(metrics.avgFirstResponseTimeSec).toBeLessThanOrEqual(43);
  });

  it('does not let a conversation with no reply contaminate the FRT average', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa Sem Resposta');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    // Answered conversation: 10s FRT.
    const answered = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: new Date().toISOString() });
    const t0 = new Date(Date.now() - 10_000).toISOString();
    const t1 = new Date().toISOString();
    await db.query(`insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,created_at) values($1,$2,$3,'INBOUND','lead','oi',$4)`, [orgId, connectionId, answered, t0]);
    await db.query(`insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,created_at) values($1,$2,$3,'OUTBOUND','ai','ola',$4)`, [orgId, connectionId, answered, t1]);
    // Unanswered conversation: inbound only, no outbound ever.
    const unanswered = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: new Date().toISOString() });
    await db.query(`insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,created_at) values($1,$2,$3,'INBOUND','lead','oi',now())`, [orgId, connectionId, unanswered]);

    const today = new Date().toISOString().split('T')[0]!;
    const metrics = await callRpc(db, orgId, today, today);
    // Only the answered conversation contributes — average stays ~10s, not diluted or NaN.
    expect(metrics.avgFirstResponseTimeSec).toBeGreaterThanOrEqual(9);
    expect(metrics.avgFirstResponseTimeSec).toBeLessThanOrEqual(11);
  });

  it('never multiplies token sums by conversation count when several conversations share a flow version (the confirmed fanout bug)', async () => {
    const { orgId, connectionId } = await seedOrg(db, 'Empresa Fanout');
    const { flowVersionId } = await seedFlowVersion(db, orgId, 'F');
    const now = new Date().toISOString();
    const conv1 = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: now });
    const conv2 = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: now });
    const conv3 = await seedConversation(db, { orgId, connectionId, flowVersionId, stage: 'NEW_CONVERSATION', createdAt: now });
    // 3 conversations, 3 executions, all on the same flow_version_id — a naive
    // LEFT JOIN conversations x LEFT JOIN executions fans out to 3*3=9 rows.
    for (const convId of [conv1, conv2, conv3]) {
      await db.query(
        `insert into public.flow_executions(organization_id,conversation_id,flow_version_id,status,input_tokens,output_tokens) values($1,$2,$3,'completed',100,50)`,
        [orgId, convId, flowVersionId]
      );
    }

    const today = new Date().toISOString().split('T')[0]!;
    const metrics = await callRpc(db, orgId, today, today);
    expect(metrics.totalTokens).toBe(450); // 3 * (100+50), not 9 * 150 = 1350
    expect(metrics.flowComparison).toHaveLength(1);
    expect(metrics.flowComparison[0].totalTokens).toBe(450);
    expect(metrics.flowComparison[0].conversationsCount).toBe(3);
  });

  it('keeps organizations fully isolated — org B never sees org A conversations or tokens', async () => {
    const a = await seedOrg(db, 'Empresa Isolamento A');
    const b = await seedOrg(db, 'Empresa Isolamento B');
    const fvA = await seedFlowVersion(db, a.orgId, 'FA');
    const fvB = await seedFlowVersion(db, b.orgId, 'FB');
    const now = new Date().toISOString();
    await seedConversation(db, { orgId: a.orgId, connectionId: a.connectionId, flowVersionId: fvA.flowVersionId, stage: 'CONVERTED', createdAt: now });
    await seedConversation(db, { orgId: b.orgId, connectionId: b.connectionId, flowVersionId: fvB.flowVersionId, stage: 'CONVERTED', createdAt: now });
    await seedConversation(db, { orgId: b.orgId, connectionId: b.connectionId, flowVersionId: fvB.flowVersionId, stage: 'CONVERTED', createdAt: now });

    const today = new Date().toISOString().split('T')[0]!;
    const metricsA = await callRpc(db, a.orgId, today, today);
    const metricsB = await callRpc(db, b.orgId, today, today);
    expect(metricsA.totalConversations).toBe(1);
    expect(metricsB.totalConversations).toBe(2);
  });

  it('rejects an end_date before start_date and a range wider than 366 days, instead of returning a fake result', async () => {
    const { orgId } = await seedOrg(db, 'Empresa Validacao');
    await expect(callRpc(db, orgId, '2026-02-10', '2026-02-01')).rejects.toThrow();
    await expect(callRpc(db, orgId, '2025-01-01', '2026-06-01')).rejects.toThrow();
  });
});
