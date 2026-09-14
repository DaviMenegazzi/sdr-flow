import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase, asUser } from './helpers/database.js';

// Fase 1 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md secao 7.6): durable webhook acceptance and
// idempotency, exercised directly at the SQL/RLS level against the real migrations (PGlite),
// the same pattern as tests/database.test.ts.
describe('inbound_events — aceitacao duravel e idempotencia (Fase 1)', () => {
  let db: PGlite;
  const owner = randomUUID();
  const otherOwner = randomUUID();
  let orgId: string;
  let connectionId: string;
  let otherOrgConnectionId: string;

  async function asService<T>(action: () => Promise<T>): Promise<T> {
    await db.exec('set role service_role');
    try {
      return await action();
    } finally {
      await db.exec('reset role');
    }
  }

  beforeAll(async () => {
    db = await testDatabase();
    await db.query('insert into auth.users(id, email) values($1,$2)', [owner, 'owner@inbound.test']);
    await db.query('insert into auth.users(id, email) values($1,$2)', [otherOwner, 'other@inbound.test']);

    orgId = await asUser(db, owner, async () =>
      (await db.query<{ id: string }>("select public.create_organization('Empresa Inbound') as id")).rows[0]!.id
    );
    const conn = await db.query<{ id: string }>(
      "insert into public.connections(organization_id,name,provider) values($1,'WA principal','evolution') returning id",
      [orgId]
    );
    connectionId = conn.rows[0]!.id;

    const otherOrgId = await asUser(db, otherOwner, async () =>
      (await db.query<{ id: string }>("select public.create_organization('Empresa B') as id")).rows[0]!.id
    );
    const otherConn = await db.query<{ id: string }>(
      "insert into public.connections(organization_id,name,provider) values($1,'WA B','evolution') returning id",
      [otherOrgId]
    );
    otherOrgConnectionId = otherConn.rows[0]!.id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it('the same event delivered 100 times concurrently creates exactly one inbound_event', async () => {
    const results = await asService(() =>
      Promise.all(
        Array.from({ length: 100 }, () =>
          db.query<{ event_id: string; is_new: boolean; status: string }>(
            `select * from public.accept_inbound_event($1,'evolution','dup-msg-1','conv-key-1','{"a":1}'::jsonb)`,
            [connectionId]
          )
        )
      )
    );
    const eventIds = new Set(results.map(r => r.rows[0]!.event_id));
    expect(eventIds.size).toBe(1);
    expect(results.filter(r => r.rows[0]!.is_new).length).toBe(1);

    const rows = await db.query<{ c: number }>(
      'select count(*)::int as c from public.inbound_events where connection_id=$1 and provider_message_id=$2',
      [connectionId, 'dup-msg-1']
    );
    expect(rows.rows[0]!.c).toBe(1);
  });

  it('the same provider_message_id on different connections does not collide', async () => {
    const [a, b] = await asService(() =>
      Promise.all([
        db.query<{ event_id: string; is_new: boolean }>(
          `select * from public.accept_inbound_event($1,'evolution','shared-id','k1','{}'::jsonb)`,
          [connectionId]
        ),
        db.query<{ event_id: string; is_new: boolean }>(
          `select * from public.accept_inbound_event($1,'evolution','shared-id','k2','{}'::jsonb)`,
          [otherOrgConnectionId]
        ),
      ])
    );
    expect(a!.rows[0]!.event_id).not.toBe(b!.rows[0]!.event_id);
    expect(a!.rows[0]!.is_new).toBe(true);
    expect(b!.rows[0]!.is_new).toBe(true);
  });

  it('an event missing provider_message_id is never deduplicated against another missing one', async () => {
    const [a, b] = await asService(() =>
      Promise.all([
        db.query<{ event_id: string; is_new: boolean }>(
          `select * from public.accept_inbound_event($1,'evolution',null,'k-no-id','{}'::jsonb)`,
          [connectionId]
        ),
        db.query<{ event_id: string; is_new: boolean }>(
          `select * from public.accept_inbound_event($1,'evolution',null,'k-no-id','{}'::jsonb)`,
          [connectionId]
        ),
      ])
    );
    expect(a!.rows[0]!.is_new).toBe(true);
    expect(b!.rows[0]!.is_new).toBe(true);
    expect(a!.rows[0]!.event_id).not.toBe(b!.rows[0]!.event_id);
  });

  it('rejects an invalid/incomplete payload and creates no record', async () => {
    await expect(
      asService(() =>
        db.query(`select * from public.accept_inbound_event($1,'evolution','bad-event','k',null)`, [connectionId])
      )
    ).rejects.toThrow();

    const rows = await db.query<{ c: number }>('select count(*)::int as c from public.inbound_events where provider_message_id=$1', ['bad-event']);
    expect(rows.rows[0]!.c).toBe(0);
  });

  it('an unknown connection is rejected — a real failure, never a silently accepted success', async () => {
    await expect(
      asService(() => db.query(`select * from public.accept_inbound_event($1,'evolution','x','k','{}'::jsonb)`, [randomUUID()]))
    ).rejects.toThrow();
  });

  it('an authenticated (non service) user cannot read inbound_events — RLS with zero policies denies all', async () => {
    await asService(() => db.query(`select * from public.accept_inbound_event($1,'evolution','rls-check','k','{}'::jsonb)`, [connectionId]));
    await asUser(db, owner, async () => {
      await expect(db.query('select * from public.inbound_events')).rejects.toThrow();
    });
  });

  it('status flows received -> processing -> failed, with a stored (sanitized-length) error', async () => {
    const accepted = await asService(() =>
      db.query<{ event_id: string; organization_id: string; status: string }>(
        `select * from public.accept_inbound_event($1,'evolution','status-flow','k','{}'::jsonb)`,
        [connectionId]
      )
    );
    const eventId = accepted.rows[0]!.event_id;
    const eventOrgId = accepted.rows[0]!.organization_id;
    expect(accepted.rows[0]!.status).toBe('received');
    expect(eventOrgId).toBe(orgId);

    await asService(() => db.query(`select public.mark_inbound_event_status($1,$2,'processing')`, [eventOrgId, eventId]));
    let row = await db.query<{ status: string; attempt_count: number }>('select status, attempt_count from public.inbound_events where id=$1', [eventId]);
    expect(row.rows[0]).toEqual({ status: 'processing', attempt_count: 1 });

    await asService(() => db.query(`select public.mark_inbound_event_status($1,$2,'failed',$3)`, [eventOrgId, eventId, 'boom']));
    row = await db.query('select status, attempt_count from public.inbound_events where id=$1', [eventId]);
    expect(row.rows[0]!.status).toBe('failed');
    const errRow = await db.query<{ last_error: string }>('select last_error from public.inbound_events where id=$1', [eventId]);
    expect(errRow.rows[0]!.last_error).toBe('boom');
  });

  it('a retry after "processed" is reported as an idempotent duplicate, not reprocessed', async () => {
    const accepted = await asService(() =>
      db.query<{ event_id: string; organization_id: string }>(
        `select * from public.accept_inbound_event($1,'evolution','already-processed','k','{}'::jsonb)`,
        [connectionId]
      )
    );
    const eventId = accepted.rows[0]!.event_id;
    const eventOrgId = accepted.rows[0]!.organization_id;
    await asService(() => db.query(`select public.mark_inbound_event_status($1,$2,'processed')`, [eventOrgId, eventId]));

    const retry = await asService(() =>
      db.query<{ event_id: string; is_new: boolean; status: string }>(
        `select * from public.accept_inbound_event($1,'evolution','already-processed','k','{}'::jsonb)`,
        [connectionId]
      )
    );
    expect(retry.rows[0]!.is_new).toBe(false);
    expect(retry.rows[0]!.status).toBe('processed');
    expect(retry.rows[0]!.event_id).toBe(eventId);
  });

  it('save_inbound_message is idempotent by provider_message_id and never moves last_message_at backwards', async () => {
    const leadId = randomUUID();
    await db.query("insert into public.leads(id,organization_id,connection_id,phone) values($1,$2,$3,'5511999990001')", [leadId, orgId, connectionId]);
    const conv = await db.query<{ id: string }>(
      "insert into public.conversations(organization_id,connection_id,lead_id) values($1,$2,$3) returning id",
      [orgId, connectionId, leadId]
    );
    const conversationId = conv.rows[0]!.id;

    const first = await asService(() =>
      db.query<{ id: string; created_at: string; is_new: boolean }>(
        `select * from public.save_inbound_message($1,$2,$3,'INBOUND','lead','Oi','text','wa-msg-1')`,
        [orgId, connectionId, conversationId]
      )
    );
    expect(first.rows[0]!.is_new).toBe(true);
    const afterFirst = await db.query<{ last_message_at: string }>('select last_message_at from public.conversations where id=$1', [conversationId]);
    const firstStamp = afterFirst.rows[0]!.last_message_at;
    expect(firstStamp).toBeTruthy();

    const duplicate = await asService(() =>
      db.query<{ id: string; created_at: string; is_new: boolean }>(
        `select * from public.save_inbound_message($1,$2,$3,'INBOUND','lead','Oi retry','text','wa-msg-1')`,
        [orgId, connectionId, conversationId]
      )
    );
    expect(duplicate.rows[0]!.is_new).toBe(false);
    expect(duplicate.rows[0]!.id).toBe(first.rows[0]!.id);

    const messageRows = await db.query<{ c: number }>('select count(*)::int as c from public.messages where conversation_id=$1', [conversationId]);
    expect(messageRows.rows[0]!.c).toBe(1);

    const afterDuplicate = await db.query<{ last_message_at: string }>('select last_message_at from public.conversations where id=$1', [conversationId]);
    expect(new Date(afterDuplicate.rows[0]!.last_message_at).getTime()).toBe(new Date(firstStamp).getTime());
  });

  it('find_or_create_lead upserts atomically without throwing on the classic select-then-insert race', async () => {
    const results = await asService(() =>
      Promise.all(
        Array.from({ length: 20 }, () =>
          db.query<{ id: string }>(`select * from public.find_or_create_lead($1,$2,'5511999990099','Concurrent Lead')`, [orgId, connectionId])
        )
      )
    );
    const leadIds = new Set(results.map(r => r.rows[0]!.id));
    expect(leadIds.size).toBe(1);
    const rows = await db.query<{ c: number }>('select count(*)::int as c from public.leads where organization_id=$1 and connection_id=$2 and phone=$3', [orgId, connectionId, '5511999990099']);
    expect(rows.rows[0]!.c).toBe(1);
  });

  it('flow_executions.idempotency_key lets a retried execution recover the same row instead of duplicating it', async () => {
    const leadId = randomUUID();
    await db.query("insert into public.leads(id,organization_id,connection_id,phone) values($1,$2,$3,'5511999990002')", [leadId, orgId, connectionId]);
    const conv = await db.query<{ id: string }>('insert into public.conversations(organization_id,connection_id,lead_id) values($1,$2,$3) returning id', [orgId, connectionId, leadId]);
    const flow = await db.query<{ id: string }>("insert into public.flows(organization_id,name,draft) values($1,'F','{}') returning id", [orgId]);
    const version = await db.query<{ id: string }>('insert into public.flow_versions(organization_id,flow_id,version,graph) values($1,$2,1,$3) returning id', [orgId, flow.rows[0]!.id, '{"schemaVersion":1,"nodes":[],"edges":[]}']);

    const key = 'turn-key-abc';
    await db.query(
      "insert into public.flow_executions(organization_id,conversation_id,flow_version_id,status,idempotency_key) values($1,$2,$3,'running',$4) returning id",
      [orgId, conv.rows[0]!.id, version.rows[0]!.id, key]
    );
    await expect(
      db.query(
        "insert into public.flow_executions(organization_id,conversation_id,flow_version_id,status,idempotency_key) values($1,$2,$3,'running',$4) returning id",
        [orgId, conv.rows[0]!.id, version.rows[0]!.id, key]
      )
    ).rejects.toThrow();

    const rows = await db.query<{ c: number }>('select count(*)::int as c from public.flow_executions where organization_id=$1 and idempotency_key=$2', [orgId, key]);
    expect(rows.rows[0]!.c).toBe(1);
  });
});
