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
  it('caps active agents per owner even when inserted directly, bypassing create_agent_for_current_user',async () => {
    // packages/db/src/connection-repository.ts inserts a dedicated agent per connection
    // straight into ai_agents, never through that RPC — the cap must hold for both paths.
    await db.exec('set role service_role');
    try {
      const before=await db.query<{count:string}>("select count(*)::text as count from public.ai_agents where organization_id=$1 and owner_user_id=$2 and status='active'",[orgA,userA]);
      const limit=Number(before.rows[0]!.count)+1;
      await db.query('update public.account_limits set max_agents=$1 where organization_id=$2 and owner_user_id=$3',[limit,orgA,userA]);
      await db.query("insert into public.ai_agents(organization_id,owner_user_id,name,provider,model) values($1,$2,'Agente extra','openai','gpt-4.1-mini')",[orgA,userA]);
      await expect(db.query("insert into public.ai_agents(organization_id,owner_user_id,name,provider,model) values($1,$2,'Agente demais','openai','gpt-4.1-mini')",[orgA,userA])).rejects.toThrow('Agent limit reached');
    } finally { await db.exec('reset role'); }
  });
  it('caps connections per owner once max_instances is set, and never blocks when it is null',async () => {
    await db.exec('set role service_role');
    try {
      const before=await db.query<{count:string}>('select count(*)::text as count from public.connections where organization_id=$1 and owner_user_id=$2',[orgA,userA]);
      const limit=Number(before.rows[0]!.count)+1;
      await db.query('update public.account_limits set max_instances=$1 where organization_id=$2 and owner_user_id=$3',[limit,orgA,userA]);
      await db.query("insert into public.connections(organization_id,name,provider) values($1,'Instância extra','evolution')",[orgA]);
      await expect(db.query("insert into public.connections(organization_id,name,provider) values($1,'Instância demais','evolution')",[orgA])).rejects.toThrow('Instance limit reached');
      await db.query('update public.account_limits set max_instances=null where organization_id=$1 and owner_user_id=$2',[orgA,userA]);
      await db.query("insert into public.connections(organization_id,name,provider) values($1,'Instância sem teto','evolution')",[orgA]);
    } finally { await db.exec('reset role'); }
  });
  it('blocks two connections — even across organizations — from reusing the same provider_instance_id',async () => {
    await db.exec('set role service_role');
    try {
      await db.query("insert into public.connections(organization_id,name,provider,provider_instance_id) values($1,'Dup 1','evolution','wa-shared-instance')",[orgA]);
      await expect(db.query("insert into public.connections(organization_id,name,provider,provider_instance_id) values($1,'Dup 2','evolution','wa-shared-instance')",[orgB])).rejects.toThrow();
    } finally { await db.exec('reset role'); }
  });
  it("stores each agent's OpenAI key separately: service_role-only, per-agent, invisible to other agents",async () => {
    await db.exec('set role service_role');
    try {
      await db.query('update public.account_limits set max_agents=20 where organization_id=$1 and owner_user_id=$2',[orgA,userA]);
      const agentId=(await db.query<{id:string}>("insert into public.ai_agents(organization_id,owner_user_id,name,provider,model) values($1,$2,'Agente com chave','openai','gpt-4.1-mini') returning id",[orgA,userA])).rows[0]!.id;
      const otherAgentId=(await db.query<{id:string}>("insert into public.ai_agents(organization_id,owner_user_id,name,provider,model) values($1,$2,'Outro agente','openai','gpt-4.1-mini') returning id",[orgA,userA])).rows[0]!.id;

      expect((await db.query<{agent_has_openai_key:boolean}>('select public.agent_has_openai_key($1)',[agentId])).rows[0]!.agent_has_openai_key).toBe(false);
      await db.query('select public.set_agent_openai_key($1,$2,$3,$4)',[orgA,userA,agentId,'cipher-abc']);
      expect((await db.query<{get_agent_openai_key:string}>('select public.get_agent_openai_key($1)',[agentId])).rows[0]!.get_agent_openai_key).toBe('cipher-abc');
      expect((await db.query<{agent_has_openai_key:boolean}>('select public.agent_has_openai_key($1)',[agentId])).rows[0]!.agent_has_openai_key).toBe(true);
      // A sibling agent under the same owner/org never sees this agent's key.
      expect((await db.query<{get_agent_openai_key:string|null}>('select public.get_agent_openai_key($1)',[otherAgentId])).rows[0]!.get_agent_openai_key).toBeNull();
      expect((await db.query<{agent_has_openai_key:boolean}>('select public.agent_has_openai_key($1)',[otherAgentId])).rows[0]!.agent_has_openai_key).toBe(false);
    } finally { await db.exec('reset role'); }

    await asUser(db,userA,async () => {
      await expect(db.query('select public.set_agent_openai_key($1,$2,$3,$4)',[orgA,userA,randomUUID(),'x'])).rejects.toThrow();
      await expect(db.query('select public.get_agent_openai_key($1)',[randomUUID()])).rejects.toThrow();
    });
  });
});
