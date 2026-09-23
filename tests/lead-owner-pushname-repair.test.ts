import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testDatabase, asUser } from './helpers/database.js';

// 20260923133000_fix_lead_names_from_owner_pushname.sql: repairs leads that the old fromMe path
// named after the connected number's own pushName. The migration already ran (on an empty
// catalog) inside testDatabase(); this seeds the broken state and re-runs the same SQL.

let db: PGlite;
const user = randomUUID();
let org: string;
let connection: string;

async function seedLead(phone: string, name: string | null) {
  const id = randomUUID();
  await db.query('insert into public.leads(id,organization_id,connection_id,phone,name) values($1,$2,$3,$4,$5)', [id, org, connection, phone, name]);
  return id;
}

async function seedFromMeEvent(phone: string, senderName: string) {
  await db.query(
    `insert into public.inbound_events(organization_id,connection_id,provider,provider_message_id,conversation_key,normalized_payload)
     values($1,$2,'evolution',$3,$4,$5)`,
    [org, connection, randomUUID(), `${connection}:${phone}`, JSON.stringify({ phone, fromMe: true, senderName, isGroup: false })]
  );
}

async function seedInbound(leadId: string, senderName: string) {
  const conversationId = randomUUID();
  await db.query('insert into public.conversations(id,organization_id,connection_id,lead_id) values($1,$2,$3,$4)', [conversationId, org, connection, leadId]);
  await db.query(
    `insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content,sender_name)
     values($1,$2,$3,'INBOUND','lead','oi',$4)`,
    [org, connection, conversationId, senderName]
  );
}

const nameOf = async (id: string) => (await db.query<{ name: string | null }>('select name from public.leads where id=$1', [id])).rows[0]!.name;

beforeAll(async () => {
  db = await testDatabase();
  await db.query('insert into auth.users(id) values($1)', [user]);
  org = await asUser(db, user, async () => (await db.query<{ id: string }>("select public.create_organization('Empresa') as id")).rows[0]!.id);
  await db.exec('set role service_role');
  connection = randomUUID();
  await db.query("insert into public.connections(id,organization_id,name,provider) values($1,$2,'wpp dani','evolution')", [connection, org]);
});

afterAll(async () => { await db?.close(); });

describe('repair of lead names taken from the instance owner pushName', () => {
  it('renames to the contact own pushName, clears when unknown, and leaves correct names alone', async () => {
    const replied = await seedLead('5555999940634', 'Danieli');
    await seedFromMeEvent('5555999940634', 'Danieli');
    await seedInbound(replied, 'Davi Menegazzi');

    const silent = await seedLead('5555999990000', 'Danieli');
    await seedFromMeEvent('5555999990000', 'Danieli');

    const correct = await seedLead('5555999991111', 'Carlos');
    await seedFromMeEvent('5555999991111', 'Danieli');

    const sql = await readFile(new URL('../supabase/migrations/20260923133000_fix_lead_names_from_owner_pushname.sql', import.meta.url), 'utf8');
    await db.exec(sql);

    expect(await nameOf(replied)).toBe('Davi Menegazzi');
    expect(await nameOf(silent)).toBeNull();
    expect(await nameOf(correct)).toBe('Carlos');
  });
});
