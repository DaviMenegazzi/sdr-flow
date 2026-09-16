import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase, asUser } from './helpers/database.js';

// 202609162001_inbox_group_threads.sql: list_inbox_threads/get_thread_messages turn "one card per
// conversations row" into "one card per (connection_id, lead_id) thread" without changing what a
// conversation is — a WhatsApp group that timed out into three separate sessions must still show
// as a single Inbox card, backed by the most recently active session, with history merged across
// every session. Both functions are SECURITY INVOKER (not DEFINER), so this also exercises that
// the existing org_read RLS policy — not hand-rolled membership logic — is what keeps one
// organization from reading another's threads.

let db: PGlite;
const userA = randomUUID();
const stranger = randomUUID();
let orgA: string;
let connectionA: string;
let leadGroup: string;
let leadSolo: string;
let convSession1: string;
let convSession2: string;
let convSession3: string;
let convSolo: string;

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-01-01T11:00:00.000Z';
const T1_5 = '2026-01-01T11:30:00.000Z';
const T2 = '2026-01-01T12:00:00.000Z';

beforeAll(async () => {
  db = await testDatabase();
  for (const id of [userA, stranger]) await db.query('insert into auth.users(id) values($1)', [id]);
  orgA = await asUser(db, userA, async () => (await db.query<{ id: string }>("select public.create_organization('Empresa A') as id")).rows[0]!.id);

  await db.exec('set role service_role');
  try {
    connectionA = randomUUID();
    await db.query("insert into public.connections(id,organization_id,name,provider) values($1,$2,'Instância A','evolution')", [connectionA, orgA]);

    leadGroup = randomUUID();
    await db.query(
      `insert into public.leads(id,organization_id,connection_id,phone,name,is_group,group_subject)
       values($1,$2,$3,'120363202896190096','Lobos do Varejo',true,'Lobos do Varejo')`,
      [leadGroup, orgA, connectionA]
    );
    leadSolo = randomUUID();
    await db.query(`insert into public.leads(id,organization_id,connection_id,phone,name) values($1,$2,$3,'5511988887777','Cliente Solo')`, [leadSolo, orgA, connectionA]);

    // Three sessions of the same group, the way a session-timeout gap produces them — the first
    // two are CLOSED (conversations_one_active_per_lead_idx allows only one non-closed row per
    // lead), the third is the current, still-open session and therefore the most recently active.
    convSession1 = randomUUID();
    await db.query(
      `insert into public.conversations(id,organization_id,connection_id,lead_id,stage,created_at,updated_at,last_message_at)
       values($1,$2,$3,$4,'CLOSED',$5,$5,$5)`,
      [convSession1, orgA, connectionA, leadGroup, T0]
    );
    convSession2 = randomUUID();
    await db.query(
      `insert into public.conversations(id,organization_id,connection_id,lead_id,stage,created_at,updated_at,last_message_at)
       values($1,$2,$3,$4,'CLOSED',$5,$5,$5)`,
      [convSession2, orgA, connectionA, leadGroup, T1]
    );
    convSession3 = randomUUID();
    await db.query(
      `insert into public.conversations(id,organization_id,connection_id,lead_id,stage,created_at,updated_at,last_message_at)
       values($1,$2,$3,$4,'NEW_CONVERSATION',$5,$5,$5)`,
      [convSession3, orgA, connectionA, leadGroup, T2]
    );
    convSolo = randomUUID();
    await db.query(
      `insert into public.conversations(id,organization_id,connection_id,lead_id,stage,created_at,updated_at,last_message_at)
       values($1,$2,$3,$4,'NEW_CONVERSATION',$5,$5,$5)`,
      [convSolo, orgA, connectionA, leadSolo, T1_5]
    );

    await db.query(
      `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,message_type,created_at,sender_name,sender_jid)
       values($1,$2,$3,'INBOUND','lead','Bom dia, pessoal!','text',$4,'Emanuel','5511911111111@s.whatsapp.net')`,
      [orgA, connectionA, convSession1, T0]
    );
    await db.query(
      `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,message_type,created_at,sender_name,sender_jid)
       values($1,$2,$3,'INBOUND','lead','Chegou a proposta','text',$4,'Davi','5511922222222@s.whatsapp.net')`,
      [orgA, connectionA, convSession2, T1]
    );
    await db.query(
      `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,message_type,created_at,sender_name,sender_jid)
       values($1,$2,$3,'INBOUND','lead','Combinado!','text',$4,'Helenara','5511933333333@s.whatsapp.net')`,
      [orgA, connectionA, convSession3, T2]
    );
  } finally {
    await db.exec('reset role');
  }
});
afterAll(async () => { await db?.close(); });

describe('list_inbox_threads / get_thread_messages (inbox thread grouping)', () => {
  it('collapses every session of the same group into a single thread, represented by the most recently active conversation', async () => {
    const result = await asUser(db, userA, () =>
      db.query<{ id: string; total_count: number }>(
        'select * from public.list_inbox_threads(p_organization_id => $1, p_limit => $2, p_offset => $3)',
        [orgA, 50, 0]
      )
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(r => r.id)).toEqual([convSession3, convSolo]);
    expect(result.rows.every(r => Number(r.total_count) === 2)).toBe(true);
  });

  it('paginates by distinct thread count, not by raw conversation row count', async () => {
    const page1 = await asUser(db, userA, () =>
      db.query<{ id: string; total_count: number }>('select * from public.list_inbox_threads(p_organization_id => $1, p_limit => $2, p_offset => $3)', [orgA, 1, 0])
    );
    expect(page1.rows.map(r => r.id)).toEqual([convSession3]);
    expect(Number(page1.rows[0]!.total_count)).toBe(2);

    const page2 = await asUser(db, userA, () =>
      db.query<{ id: string; total_count: number }>('select * from public.list_inbox_threads(p_organization_id => $1, p_limit => $2, p_offset => $3)', [orgA, 1, 1])
    );
    expect(page2.rows.map(r => r.id)).toEqual([convSolo]);
  });

  it('merges message history across every session of the thread, in chronological order', async () => {
    const result = await asUser(db, userA, () =>
      db.query<{ sender_name: string | null }>('select * from public.get_thread_messages(p_organization_id => $1, p_conversation_id => $2, p_limit => $3)', [orgA, convSession3, 200])
    );
    expect(result.rows.map(r => r.sender_name)).toEqual(['Emanuel', 'Davi', 'Helenara']);
  });

  it('relies on org_read RLS to keep one organization from reading another organization\'s threads', async () => {
    const threads = await asUser(db, stranger, () =>
      db.query('select * from public.list_inbox_threads(p_organization_id => $1)', [orgA])
    );
    expect(threads.rows).toEqual([]);

    const messages = await asUser(db, stranger, () =>
      db.query('select * from public.get_thread_messages(p_organization_id => $1, p_conversation_id => $2)', [orgA, convSession3])
    );
    expect(messages.rows).toEqual([]);
  });

  it('is callable by service_role for the worker/API-key path, bypassing RLS as usual', async () => {
    await db.exec('set role service_role');
    try {
      const result = await db.query<{ id: string }>('select * from public.list_inbox_threads(p_organization_id => $1)', [orgA]);
      expect(result.rows.map(r => r.id)).toEqual([convSession3, convSolo]);
    } finally {
      await db.exec('reset role');
    }
  });
});
