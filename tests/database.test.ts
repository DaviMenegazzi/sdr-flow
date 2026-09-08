import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase,asUser } from './helpers/database.js';
import { createBlankFlow } from '../packages/flow/src/index.js';

let db:PGlite;
const userA=randomUUID(),userB=randomUUID(),viewer=randomUUID(),stranger=randomUUID();
let orgA:string,orgB:string,flowA:string,flowB:string;
const graph=JSON.stringify(createBlankFlow());
beforeAll(async () => {
  db=await testDatabase();
  for(const id of [userA,userB,viewer,stranger]) await db.query('insert into auth.users(id) values($1)',[id]);
  orgA=await asUser(db,userA,async () => (await db.query<{id:string}>("select public.create_organization('Empresa A') as id")).rows[0]!.id);
  orgB=await asUser(db,userB,async () => (await db.query<{id:string}>("select public.create_organization('Empresa B') as id")).rows[0]!.id);
  await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')",[orgA,viewer]);
  for(const [user,org] of [[userA,orgA],[userB,orgB]]) {
    const id=await asUser(db,user!,async () => (await db.query<{id:string}>('insert into public.flows(organization_id,name,draft) values($1,$2,$3) returning id',[org,'Flow',graph])).rows[0]!.id);
    if(user===userA) flowA=id; else flowB=id;
  }
});
afterAll(async () => { await db?.close(); });
describe('Postgres migrations, RLS and publication',() => {
  it('enables RLS on every business table',async () => {
    const result=await db.query<{relname:string}>("select relname from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname in ('public','private') and relkind='r' and not relrowsecurity");
    expect(result.rows).toEqual([]);
  });
  it('creates ownership atomically and prevents recursive membership policies',async () => {
    await asUser(db,userA,async () => {
      const orgs=await db.query<{id:string}>('select id from public.organizations'); expect(orgs.rows.map(row=>row.id)).toEqual([orgA]);
      const members=await db.query<{organization_id:string}>('select organization_id from public.organization_members'); expect(members.rows.every(row=>row.organization_id===orgA)).toBe(true);
    });
  });
  it('isolates two organizations even without application filters',async () => {
    await asUser(db,userA,async () => { expect((await db.query<{id:string}>('select id from public.flows')).rows.map(row=>row.id)).toEqual([flowA]); });
    await asUser(db,userB,async () => { expect((await db.query<{id:string}>('select id from public.flows')).rows.map(row=>row.id)).toEqual([flowB]); });
    await asUser(db,stranger,async () => { expect((await db.query('select * from public.flows')).rows).toEqual([]); });
  });
  it('prevents cross-organization insert and update',async () => {
    await asUser(db,userA,async () => {
      await expect(db.query('insert into public.flows(organization_id,name,draft) values($1,$2,$3)',[orgB,'Intrusion',graph])).rejects.toThrow();
      expect((await db.query('update public.flows set name=$1 where id=$2 returning id',['Intrusion',flowB])).rows).toEqual([]);
    });
  });
  it('allows a viewer to read but not change drafts',async () => {
    await asUser(db,viewer,async () => {
      expect((await db.query('select id from public.flows')).rows).toHaveLength(1);
      expect((await db.query('update public.flows set name=$1 where id=$2 returning id',['Intrusion',flowA])).rows).toEqual([]);
      await expect(db.query('insert into public.flows(organization_id,name,draft) values($1,$2,$3)',[orgA,'Intrusion',graph])).rejects.toThrow();
    });
  });
  it('prevents membership escalation, tenant reassignment and pointer tampering',async () => {
    await asUser(db,viewer,async () => { await expect(db.query("update public.organization_members set role='owner' where user_id=$1",[viewer])).rejects.toThrow(); });
    await asUser(db,userA,async () => {
      await expect(db.query('update public.flows set organization_id=$1 where id=$2',[orgB,flowA])).rejects.toThrow();
      await expect(db.query('update public.flows set published_version_id=$1 where id=$2',[randomUUID(),flowA])).rejects.toThrow();
      await expect(db.query('select public.publish_flow($1,$2,$3,$4)',[orgA,flowA,userA,graph])).rejects.toThrow();
    });
  });
  it('gives anonymous users no access despite Supabase default grants',async () => {
    await db.exec('set role anon');
    try { await expect(db.query('select * from public.flows')).rejects.toThrow(); await expect(db.query('select * from public.leads')).rejects.toThrow(); }
    finally { await db.exec('reset role'); }
  });
  it('publishes immutable sequential snapshots with the real actor and audit',async () => {
    await db.exec('set role service_role');
    let id1:string,id2:string;
    try {
      const first=await db.query<{id:string;version:number}>('select * from public.publish_flow($1,$2,$3,$4)',[orgA,flowA,userA,graph]);
      const second=await db.query<{id:string;version:number}>('select * from public.publish_flow($1,$2,$3,$4)',[orgA,flowA,userA,graph]);
      expect(first.rows[0]!.version).toBe(1); expect(second.rows[0]!.version).toBe(2); id1=first.rows[0]!.id; id2=second.rows[0]!.id;
      await expect(db.query('update public.flow_versions set graph=$1 where id=$2',[graph,id1])).rejects.toThrow('immutable');
      await expect(db.query('select * from public.publish_flow($1,$2,$3,$4)',[orgA,flowA,userB,graph])).rejects.toThrow('forbidden');
    } finally { await db.exec('reset role'); }
    expect((await db.query<{published_version_id:string}>('select published_version_id from public.flows where id=$1',[flowA])).rows[0]!.published_version_id).toBe(id2!);
    expect((await db.query('select * from public.flow_versions where id=$1',[id1!])).rows).toHaveLength(1);
    expect((await db.query<{actor_id:string}>('select actor_id from public.audit_events where entity_id=$1',[flowA])).rows.map(row=>row.actor_id)).toEqual([userA,userA]);
  });
  it('enforces composite foreign keys even for the privileged worker',async () => {
    const connectionA=randomUUID(),connectionB=randomUUID(),leadA=randomUUID(),leadB=randomUUID();
    await db.query("insert into public.connections(id,organization_id,name,provider) values($1,$2,'A','evolution'),($3,$4,'B','meta')",[connectionA,orgA,connectionB,orgB]);
    await db.query("insert into public.leads(id,organization_id,phone) values($1,$2,'5551999990000'),($3,$4,'5551999990000')",[leadA,orgA,leadB,orgB]);
    await expect(db.query('insert into public.conversations(organization_id,connection_id,lead_id) values($1,$2,$3)',[orgA,connectionA,leadB])).rejects.toThrow();
    await expect(db.query('insert into public.conversations(organization_id,connection_id,lead_id) values($1,$2,$3)',[orgA,connectionB,leadA])).rejects.toThrow();
    const convA=(await db.query<{id:string}>('insert into public.conversations(organization_id,connection_id,lead_id) values($1,$2,$3) returning id',[orgA,connectionA,leadA])).rows[0]!.id;
    await expect(db.query("insert into public.messages(organization_id,connection_id,conversation_id,direction,sender,content) values($1,$2,$3,'INBOUND','lead','Oi')",[orgB,connectionB,convA])).rejects.toThrow();
  });
  it('prevents a flow from pointing at another flow version in the same organization',async () => {
    const other=(await db.query<{id:string}>('insert into public.flows(organization_id,name,draft) values($1,$2,$3) returning id',[orgA,'Other',graph])).rows[0]!.id;
    const version=(await db.query<{id:string}>('select * from public.publish_flow($1,$2,$3,$4)',[orgA,other,userA,graph])).rows[0]!.id;
    await expect(db.query('update public.flows set published_version_id=$1 where id=$2',[version,flowA])).rejects.toThrow();
  });
});
