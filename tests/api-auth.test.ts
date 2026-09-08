import { afterEach,describe,it,expect,vi } from 'vitest';
import request from 'supertest';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';
import { createBlankFlow } from '../packages/flow/src/index.js';

const org='00000000-0000-4000-8000-000000000001';
const actor='00000000-0000-4000-8000-000000000002';
const flow='00000000-0000-4000-8000-000000000003';
const config={supabaseUrl:'https://example.supabase.co',anonKey:'public-test-key',serviceRoleKey:'private-test-key'};
function identity(role:string|null='admin',valid=true) {
  const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:role ? {role}:null,error:null})};
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  return vi.spyOn(database,'userDatabase').mockReturnValue({
    auth:{getUser:vi.fn().mockResolvedValue({data:{user:valid ? {id:actor}:null},error:valid ? null:new Error('expired')})},
    from:vi.fn().mockReturnValue(chain),
  } as unknown as database.UserDatabase);
}
afterEach(() => vi.restoreAllMocks());
describe('Authenticated publication boundary (Supabase adapter doubles)',() => {
  it('rejects expired JWTs even if a bearer value is present',async () => {
    identity('admin',false);
    const result=await request(createApp(config)).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('expired',{type:'bearer'}).send(createBlankFlow());
    expect(result.status).toBe(401);
  });
  it('rejects a valid user without membership',async () => {
    identity(null);
    const result=await request(createApp(config)).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('valid',{type:'bearer'}).send(createBlankFlow());
    expect(result.status).toBe(403);
  });
  it('rejects viewers before touching the privileged client',async () => {
    identity('viewer'); const privileged=vi.spyOn(database,'serviceDatabase');
    const result=await request(createApp(config)).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('valid',{type:'bearer'}).send(createBlankFlow());
    expect(result.status).toBe(403); expect(privileged).not.toHaveBeenCalled();
  });
  it('uses the verified actor and route organization for atomic publication',async () => {
    const userClient=identity(); const rpc=vi.fn().mockResolvedValue({data:{id:'version-1',version:1},error:null});
    vi.spyOn(database,'serviceDatabase').mockReturnValue({rpc} as unknown as ReturnType<typeof database.serviceDatabase>);
    const graph=createBlankFlow();
    const result=await request(createApp(config)).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('verified-token',{type:'bearer'}).send(graph);
    expect(result.status).toBe(201); expect(result.body.version).toBe(1);
    expect(userClient).toHaveBeenCalledWith(config.supabaseUrl,config.anonKey,'verified-token');
    expect(rpc).toHaveBeenCalledWith('publish_flow',{p_org:org,p_flow:flow,p_actor:actor,p_graph:graph});
  });
  it('validates every graph before acquiring service privileges',async () => {
    identity(); const privileged=vi.spyOn(database,'serviceDatabase'); const graph=createBlankFlow(); graph.edges=[];
    const result=await request(createApp(config)).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('valid',{type:'bearer'}).send(graph);
    expect(result.status).toBe(422); expect(privileged).not.toHaveBeenCalled();
  });
  it('does not report success when the publication key is missing',async () => {
    identity();
    const result=await request(createApp({...config,serviceRoleKey:undefined})).post(`/api/organizations/${org}/flows/${flow}/publish`).auth('valid',{type:'bearer'}).send(createBlankFlow());
    expect(result.status).toBe(503);
  });
});
