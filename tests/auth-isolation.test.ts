import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { asUser,testDatabase } from './helpers/database.js';

let db:PGlite; const clientA=randomUUID(),clientB=randomUUID(),provisionedClient=randomUUID();
beforeAll(async()=>{db=await testDatabase();await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.test',$3),($2,'b@example.test',$4)",[clientA,clientB,JSON.stringify({display_name:'A'}),JSON.stringify({display_name:'B'})])});
afterAll(async()=>db?.close());
describe('Supabase account and instance isolation',()=>{
  it('provisions client profiles, limits and one default agent atomically',async()=>{for(const user of [clientA,clientB]){const p=await db.query<{role:string;status:string;default_organization_id:string}>('select role,status,default_organization_id from public.profiles where user_id=$1',[user]);expect(p.rows[0]).toMatchObject({role:'client',status:'active'});expect((await db.query('select id from public.ai_agents where owner_user_id=$1 and is_default',[user])).rows).toHaveLength(1);expect((await db.query<{max_agents:number}>('select max_agents from public.account_limits where owner_user_id=$1',[user])).rows[0]?.max_agents).toBe(2)}});
  it('enforces the two-agent quota in the database',async()=>{await asUser(db,clientA,()=>db.query("select id from public.create_agent_for_current_user('Extra',null,'openai','gpt-4.1-mini','', '{}'::jsonb, '{}'::jsonb)"));await expect(asUser(db,clientA,()=>db.query("select id from public.create_agent_for_current_user('Third',null,'openai','gpt-4.1-mini','', '{}'::jsonb, '{}'::jsonb)"))).rejects.toThrow('limit');expect((await db.query("select id from public.ai_agents where owner_user_id=$1 and status='active'",[clientA])).rows).toHaveLength(2)});
  it('prevents assigning another login agent and hides its connections through RLS',async()=>{const orgA=(await db.query<{default_organization_id:string}>('select default_organization_id from public.profiles where user_id=$1',[clientA])).rows[0]!.default_organization_id;const agentA=(await db.query<{id:string}>('select id from public.ai_agents where owner_user_id=$1 and is_default',[clientA])).rows[0]!.id;const agentB=(await db.query<{id:string}>('select id from public.ai_agents where owner_user_id=$1 and is_default',[clientB])).rows[0]!.id;const connection=randomUUID();await db.query("insert into public.connections(id,organization_id,owner_user_id,agent_id,name,provider) values($1,$2,$3,$4,'A1','evolution')",[connection,orgA,clientA,agentA]);await expect(asUser(db,clientA,()=>db.query('select * from public.assign_agent_to_connection($1,$2)',[connection,agentB]))).rejects.toThrow('not found');await asUser(db,clientB,async()=>expect((await db.query('select id from public.connections where id=$1',[connection])).rows).toEqual([]))});
  it('provisions an admin-created login inside the selected organization without creating an orphan organization',async()=>{
    const orgA=(await db.query<{default_organization_id:string}>('select default_organization_id from public.profiles where user_id=$1',[clientA])).rows[0]!.default_organization_id;
    const before=(await db.query<{count:number}>('select count(*)::int as count from public.organizations')).rows[0]!.count;
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,'new-client@example.test',$2,$3)",
      [
        provisionedClient,
        JSON.stringify({display_name:'Nova Cliente'}),
        JSON.stringify({
          sdr_target_organization_id:orgA,
          sdr_member_role:'agent',
          sdr_app_role:'client',
          sdr_org_tier:'vendedor',
          sdr_provisioned_by:clientA,
        }),
      ],
    );
    const after=(await db.query<{count:number}>('select count(*)::int as count from public.organizations')).rows[0]!.count;
    expect(after).toBe(before);
    expect((await db.query<{role:string}>('select role from public.organization_members where organization_id=$1 and user_id=$2',[orgA,provisionedClient])).rows[0]?.role).toBe('agent');
    expect((await db.query<{role:string;default_organization_id:string}>('select role,default_organization_id from public.profiles where user_id=$1',[provisionedClient])).rows[0]).toMatchObject({role:'client',default_organization_id:orgA});
    expect((await db.query<{tier:string}>('select tier from public.organizations where id=$1',[orgA])).rows[0]?.tier).toBe('vendedor');
    expect((await db.query('select id from public.ai_agents where organization_id=$1 and owner_user_id=$2 and is_default',[orgA,provisionedClient])).rows).toHaveLength(1);
  });
});
