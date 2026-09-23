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
    // Creating a login never changes the organization's plan (sdr_org_tier is ignored).
    expect((await db.query<{tier:string}>('select tier from public.organizations where id=$1',[orgA])).rows[0]?.tier).toBe('pre-venda');
    expect((await db.query('select id from public.ai_agents where organization_id=$1 and owner_user_id=$2',[orgA,provisionedClient])).rows).toHaveLength(0);
    expect((await db.query("select id from public.ai_agents where organization_id=$1 and status='active'",[orgA])).rows.length).toBeGreaterThanOrEqual(1);
    expect((await db.query("select id from public.audit_events where organization_id=$1 and action='account.login_created' and entity_id=$2",[orgA,provisionedClient])).rows).toHaveLength(1);
  });

  it('reconciles delayed app metadata into the selected organization instead of leaving a personal owner organization',async()=>{
    const delayedClient=randomUUID();
    const orgA=(await db.query<{default_organization_id:string}>('select default_organization_id from public.profiles where user_id=$1',[clientA])).rows[0]!.default_organization_id;

    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'delayed-client@example.test',$2)",
      [delayedClient,JSON.stringify({display_name:'Delayed Client'})],
    );
    const fallbackOrg=(await db.query<{default_organization_id:string}>('select default_organization_id from public.profiles where user_id=$1',[delayedClient])).rows[0]!.default_organization_id;
    expect(fallbackOrg).not.toBe(orgA);

    await db.query(
      'update auth.users set raw_app_meta_data=$2 where id=$1',
      [delayedClient,JSON.stringify({
        sdr_target_organization_id:orgA,
        sdr_member_role:'agent',
        sdr_app_role:'client',
        sdr_org_tier:'pre-venda',
        sdr_provisioned_by:clientA,
      })],
    );

    expect((await db.query<{role:string}>('select role from public.organization_members where organization_id=$1 and user_id=$2',[orgA,delayedClient])).rows[0]?.role).toBe('agent');
    expect((await db.query('select user_id from public.organization_members where organization_id=$1 and user_id=$2',[fallbackOrg,delayedClient])).rows).toHaveLength(0);
    expect((await db.query<{role:string;default_organization_id:string}>('select role,default_organization_id from public.profiles where user_id=$1',[delayedClient])).rows[0]).toMatchObject({role:'client',default_organization_id:orgA});
    expect((await db.query("select id from public.audit_events where organization_id=$1 and action='account.login_created' and entity_id=$2",[orgA,delayedClient])).rows).toHaveLength(1);

    await db.query("update public.organization_members set role='viewer' where organization_id=$1 and user_id=$2",[orgA,delayedClient]);
    await db.query(
      "update auth.users set raw_app_meta_data=raw_app_meta_data || '{\"unrelated\":true}'::jsonb where id=$1",
      [delayedClient],
    );
    expect((await db.query<{role:string}>('select role from public.organization_members where organization_id=$1 and user_id=$2',[orgA,delayedClient])).rows[0]?.role).toBe('viewer');
  });
});

describe('organization-scoped account limits compatibility',()=>{
  let compatibilityDb:PGlite;
  const owner=randomUUID(),newMember=randomUUID();

  beforeAll(async()=>{
    compatibilityDb=await testDatabase();
    await compatibilityDb.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'org-owner@example.test',$2)",
      [owner,JSON.stringify({display_name:'Organization Owner'})],
    );
    await compatibilityDb.exec(`
      alter table public.account_limits drop column owner_user_id cascade;
      alter table public.account_limits add primary key(organization_id);
      create or replace function private.enforce_agent_limit()
      returns trigger language plpgsql security definer set search_path = '' as $$
      declare v_limit integer; v_count integer;
      begin
        select max_agents into v_limit from public.account_limits where organization_id = new.organization_id;
        if v_limit is null then v_limit := 2; end if;
        select count(*) into v_count from public.ai_agents where organization_id = new.organization_id and status = 'active';
        if v_count >= v_limit then raise exception 'Agent limit reached' using errcode = 'P0001'; end if;
        return new;
      end $$;
    `);
  });

  afterAll(async()=>compatibilityDb?.close());

  it('reuses the organization limits row when provisioning another login',async()=>{
    const org=(await compatibilityDb.query<{default_organization_id:string}>('select default_organization_id from public.profiles where user_id=$1',[owner])).rows[0]!.default_organization_id;
    await compatibilityDb.query(
      "insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,'org-member@example.test',$2,$3)",
      [
        newMember,
        JSON.stringify({display_name:'Organization Member'}),
        JSON.stringify({
          sdr_target_organization_id:org,
          sdr_member_role:'agent',
          sdr_app_role:'client',
          sdr_org_tier:'vendedor',
          sdr_provisioned_by:owner,
        }),
      ],
    );
    expect((await compatibilityDb.query('select organization_id from public.account_limits where organization_id=$1',[org])).rows).toHaveLength(1);
    expect((await compatibilityDb.query('select user_id from public.organization_members where organization_id=$1 and user_id=$2',[org,newMember])).rows).toHaveLength(1);
  });
});
