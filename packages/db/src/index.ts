import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types.js';
import type { FlowGraph } from '@sdr/shared';
export type { Database } from './database.types.js';

export function userDatabase(url: string, anonKey: string, token: string) {
  return createClient<Database>(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export function serviceDatabase(url: string, key: string) {
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export type UserDatabase = ReturnType<typeof userDatabase>;
export class FlowRepository {
  constructor(private readonly db: UserDatabase, private readonly organizationId: string) {}
  async list() {
    const { data, error } = await this.db.from('flows').select('*').eq('organization_id',this.organizationId).order('updated_at',{ ascending: false });
    if (error) throw error; return data;
  }
  async create(name: string, graph: FlowGraph) {
    const { data, error } = await this.db.from('flows').insert({ organization_id: this.organizationId, name, draft: graph as unknown as Json }).select().single();
    if (error) throw error; return data;
  }
  async update(id: string, name: string, graph: FlowGraph) {
    const { data, error } = await this.db.from('flows').update({ name, draft: graph as unknown as Json, updated_at: new Date().toISOString() }).eq('id',id).eq('organization_id',this.organizationId).select().single();
    if (error) throw error; return data;
  }
}

export * from './execution-repository.js';
export * from './conversation-repository.js';
export * from './organization-repository.js';
export * from './crypto.js';
export * from './connection-repository.js';
export * from './knowledge-repository.js';
export * from './summary-repository.js';
export * from './inbox-repository.js';
export * from './metrics-repository.js';
export * from './backup.js';


