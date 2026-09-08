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
  });
});
