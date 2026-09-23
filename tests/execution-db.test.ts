import { describe, it, expect } from 'vitest';
import { testDatabase, asUser } from './helpers/database.js';

describe('Execution & Conversation Persistence (PGlite)', () => {
  it('creates execution, steps, updates status, tokens and enforces RLS isolation', async () => {
    const db = await testDatabase();

    const user1 = '00000000-0000-4000-8000-000000000001';
    const user2 = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      user1, 'alice@org1.com',
      user2, 'bob@org2.com',
    ]);

    // Create 2 organizations
    const org1Res = await asUser(db, user1, () => db.query<{ id: string }>("select public.create_organization('Empresa 1') as id"));
    const org1 = org1Res.rows[0]?.id!;

    const org2Res = await asUser(db, user2, () => db.query<{ id: string }>("select public.create_organization('Empresa 2') as id"));
    const org2 = org2Res.rows[0]?.id!;

    // Create flow and flow_version in org1
    const flowRes = await db.query<{ id: string }>(
      "insert into public.flows (organization_id, name, draft) values ($1, 'Fluxo 1', '{\"schemaVersion\":1,\"nodes\":[],\"edges\":[]}') returning id",
      [org1]
    );
    const flow1 = flowRes.rows[0]?.id!;

    const versionRes = await db.query<{ id: string }>(
      "insert into public.flow_versions (organization_id, flow_id, version, graph, created_by) values ($1, $2, 1, '{\"schemaVersion\":1,\"nodes\":[],\"edges\":[]}', $3) returning id",
      [org1, flow1, user1]
    );
    const version1 = versionRes.rows[0]?.id!;

    // Create connection in org1
    const connRes = await db.query<{ id: string }>(
      "insert into public.connections (organization_id, name, provider, phone) values ($1, 'Whats 1', 'evolution', '5511999990000') returning id",
      [org1]
    );
    const conn1 = connRes.rows[0]?.id!;

    // Create lead and conversation in org1
    const leadRes = await db.query<{ id: string }>(
      "insert into public.leads (organization_id, phone, name, memory) values ($1, '5511999998888', 'Cliente Org1', '{\"notes\":\"Interessado\"}') returning id",
      [org1]
    );
    const lead1 = leadRes.rows[0]?.id!;

    const convRes = await db.query<{ id: string }>(
      "insert into public.conversations (organization_id, connection_id, lead_id, flow_version_id, stage, handled_by) values ($1, $2, $3, $4, 'QUALIFYING', 'AI') returning id",
      [org1, conn1, lead1, version1]
    );
    const conv1 = convRes.rows[0]?.id!;

    // Insert flow_executions
    const execRes = await db.query<{ id: string }>(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status) values ($1, $2, $3, 'running') returning id",
      [org1, conv1, version1]
    );
    const exec1 = execRes.rows[0]?.id!;

    // Insert flow_execution_steps
    await db.query(
      "insert into public.flow_execution_steps (organization_id, execution_id, node_id, sequence, input, output, duration_ms) values ($1, $2, 'start', 1, '{}', '{\"ok\":true}', 15)",
      [org1, exec1]
    );
    await db.query(
      "insert into public.flow_execution_steps (organization_id, execution_id, node_id, sequence, input, output, duration_ms) values ($1, $2, 'decide', 2, '{\"prompt\":\"oi\"}', '{\"reply\":\"olá\"}', 120)",
      [org1, exec1]
    );

    // Update execution status & tokens
    await db.query(
      "update public.flow_executions set status = 'completed', input_tokens = 150, output_tokens = 40, finished_at = now() where id = $1 and organization_id = $2",
      [exec1, org1]
    );

    // Insert deal in deals table
    const dealRes = await db.query<{ id: string }>(
      "insert into public.deals (organization_id, lead_id, title, status, score) values ($1, $2, 'Cliente Org1 - Odonto', 'OPEN', 85) returning id",
      [org1, lead1]
    );
    expect(dealRes.rows[0]?.id).toBeDefined();

    // Verify as user1 (member of org1) - can see execution and steps
    const user1Execs = await asUser(db, user1, () =>
      db.query<{ id: string; status: string; input_tokens: number }>(
        'select id, status, input_tokens from public.flow_executions where organization_id = $1',
        [org1]
      )
    );
    expect(user1Execs.rows).toHaveLength(1);
    expect(user1Execs.rows[0]?.status).toBe('completed');
    expect(user1Execs.rows[0]?.input_tokens).toBe(150);

    const user1Steps = await asUser(db, user1, () =>
      db.query<{ node_id: string; sequence: number }>(
        'select node_id, sequence from public.flow_execution_steps where execution_id = $1 order by sequence asc',
        [exec1]
      )
    );
    expect(user1Steps.rows).toHaveLength(2);
    expect(user1Steps.rows[0]?.node_id).toBe('start');
    expect(user1Steps.rows[1]?.node_id).toBe('decide');

    // Verify RLS: user2 (from org2) CANNOT see org1 execution or steps
    const user2Execs = await asUser(db, user2, () =>
      db.query('select * from public.flow_executions where id = $1', [exec1])
    );
    expect(user2Execs.rows).toHaveLength(0);

    const user2Steps = await asUser(db, user2, () =>
      db.query('select * from public.flow_execution_steps where execution_id = $1', [exec1])
    );
    expect(user2Steps.rows).toHaveLength(0);

    const user2Deals = await asUser(db, user2, () =>
      db.query('select * from public.deals where organization_id = $1', [org1])
    );
    expect(user2Deals.rows).toHaveLength(0);
    await db.close();
  });

  it('202609162003: denormalizes connection/lead/agent/model per execution, enforces cross-org FKs and clears connection_id on delete', async () => {
    // Each it() here opens its own PGlite instance rather than sharing one via beforeAll/afterAll
    // (contrast tests/database.test.ts) — closing it explicitly, like that file does, matters
    // now that this file has more than one such instance: leaving the first one open while a
    // second is created in the same worker process corrupts unrelated queries on the second one.
    const db = await testDatabase();

    const user1 = '00000000-0000-4000-8000-000000000011';
    const user2 = '00000000-0000-4000-8000-000000000012';
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      user1, 'carol@orga.com',
      user2, 'dave@orgb.com',
    ]);

    const org1Res = await asUser(db, user1, () => db.query<{ id: string }>("select public.create_organization('Org A') as id"));
    const org1 = org1Res.rows[0]?.id!;
    const org2Res = await asUser(db, user2, () => db.query<{ id: string }>("select public.create_organization('Org B') as id"));
    const org2 = org2Res.rows[0]?.id!;

    const flowRes = await db.query<{ id: string }>(
      "insert into public.flows (organization_id, name, draft) values ($1, 'Fluxo A', '{\"schemaVersion\":1,\"nodes\":[],\"edges\":[]}') returning id",
      [org1]
    );
    const versionRes = await db.query<{ id: string }>(
      "insert into public.flow_versions (organization_id, flow_id, version, graph, created_by) values ($1, $2, 1, '{\"schemaVersion\":1,\"nodes\":[],\"edges\":[]}', $3) returning id",
      [org1, flowRes.rows[0]?.id!, user1]
    );
    const version1 = versionRes.rows[0]?.id!;
    // Pre-venda caps instances at 1 (private.plan_limits); this scenario needs two.
    await db.query("insert into public.organization_limits(organization_id,override_instances,max_instances,reason) values($1,true,null,'teste')", [org1]);

    const conn1Res = await db.query<{ id: string }>(
      "insert into public.connections (organization_id, name, provider, phone) values ($1, 'Whats A', 'evolution', '5511999991111') returning id",
      [org1]
    );
    const conn1 = conn1Res.rows[0]?.id!;
    const conn2Res = await db.query<{ id: string }>(
      "insert into public.connections (organization_id, name, provider, phone) values ($1, 'Whats B', 'evolution', '5511999993333') returning id",
      [org2]
    );
    const conn2 = conn2Res.rows[0]?.id!;

    const lead1Res = await db.query<{ id: string }>(
      "insert into public.leads (organization_id, phone, name) values ($1, '5511999992222', 'Cliente A') returning id",
      [org1]
    );
    const lead1 = lead1Res.rows[0]?.id!;
    const lead2Res = await db.query<{ id: string }>(
      "insert into public.leads (organization_id, phone, name) values ($1, '5511999994444', 'Cliente B') returning id",
      [org2]
    );
    const lead2 = lead2Res.rows[0]?.id!;

    const convRes = await db.query<{ id: string }>(
      "insert into public.conversations (organization_id, connection_id, lead_id, flow_version_id, stage, handled_by) values ($1, $2, $3, $4, 'QUALIFYING', 'AI') returning id",
      [org1, conn1, lead1, version1]
    );
    const conv1 = convRes.rows[0]?.id!;

    const agentRes = await db.query<{ id: string }>(
      "insert into public.ai_agents (organization_id, owner_user_id, name, provider, model) values ($1, $2, 'Agente A', 'openai', 'gpt-4.1-mini') returning id",
      [org1, user1]
    );
    const agent1 = agentRes.rows[0]?.id!;

    // Denormalized context, captured at creation exactly like turn-processor.ts now does.
    const execRes = await db.query<{ id: string }>(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status, connection_id, lead_id, agent_id, model) values ($1, $2, $3, 'running', $4, $5, $6, 'gpt-4.1-mini') returning id",
      [org1, conv1, version1, conn1, lead1, agent1]
    );
    const exec1 = execRes.rows[0]?.id!;

    const stored = await db.query<{ connection_id: string; lead_id: string; agent_id: string; model: string }>(
      'select connection_id, lead_id, agent_id, model from public.flow_executions where id = $1',
      [exec1]
    );
    expect(stored.rows[0]).toMatchObject({ connection_id: conn1, lead_id: lead1, agent_id: agent1, model: 'gpt-4.1-mini' });

    // A bare insert without the 4 new columns (every pre-migration caller, and any turn that
    // predates this session's turn-processor.ts change) must keep working — all four stay null.
    const bareExecRes = await db.query<{ connection_id: string | null; model: string | null }>(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status) values ($1, $2, $3, 'running') returning connection_id, model",
      [org1, conv1, version1]
    );
    expect(bareExecRes.rows[0]?.connection_id).toBeNull();
    expect(bareExecRes.rows[0]?.model).toBeNull();

    // Composite FK: a connection_id/lead_id from a DIFFERENT organization must be rejected even
    // though each id independently exists — everything else in the row is valid for org1, so
    // only the new flow_executions_connection_fk/_lead_fk constraints can be catching this.
    // (Plain `await expect(db.query(...)).rejects.toThrow()` does not reliably surface PGlite's
    // rejection here, so this asserts on the caught error directly instead.)
    await db.query(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status, connection_id) values ($1, $2, $3, 'running', $4)",
      [org1, conv1, version1, conn2]
    ).then(
      () => { throw new Error('expected cross-org connection_id insert to be rejected by flow_executions_connection_fk'); },
      (err: Error) => { expect(err.message).toContain('flow_executions_connection_fk'); }
    );
    await db.query(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status, lead_id) values ($1, $2, $3, 'running', $4)",
      [org1, conv1, version1, lead2]
    ).then(
      () => { throw new Error('expected cross-org lead_id insert to be rejected by flow_executions_lead_fk'); },
      (err: Error) => { expect(err.message).toContain('flow_executions_lead_fk'); }
    );

    // on delete set null: removing the connection later must not delete, or be blocked by, the
    // execution that already ran under it — this is an audit trail, not a live reference. Uses
    // its own connection (conn3), never attached to any conversation, so only
    // flow_executions_connection_fk governs the delete — conn1 stays in place because
    // conversations.connection_id (a separate, pre-existing FK with no ON DELETE clause) still
    // legitimately blocks deleting a connection with a live conversation under it. This also
    // proves the FK's "on delete set null (connection_id)" column list is doing its job — a
    // plain "on delete set null" on this composite key would try to null organization_id too
    // (NOT NULL on flow_executions) and the delete itself would fail.
    const conn3Res = await db.query<{ id: string }>(
      "insert into public.connections (organization_id, name, provider, phone) values ($1, 'Whats C', 'evolution', '5511999995555') returning id",
      [org1]
    );
    const conn3 = conn3Res.rows[0]?.id!;
    const exec2Res = await db.query<{ id: string }>(
      "insert into public.flow_executions (organization_id, conversation_id, flow_version_id, status, connection_id) values ($1, $2, $3, 'running', $4) returning id",
      [org1, conv1, version1, conn3]
    );
    const exec2 = exec2Res.rows[0]?.id!;

    await db.query('delete from public.connections where id = $1', [conn3]);
    const afterDelete = await db.query<{ organization_id: string; connection_id: string | null }>(
      'select organization_id, connection_id from public.flow_executions where id = $1',
      [exec2]
    );
    expect(afterDelete.rows[0]?.organization_id).toBe(org1);
    expect(afterDelete.rows[0]?.connection_id).toBeNull();

    await db.close();
  });
});
