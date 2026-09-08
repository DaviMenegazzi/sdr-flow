import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
`;
export async function migrations() {
  const directory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
  return Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).sort().map(name => readFile(`${directory}/${name}`, 'utf8')));
}
export async function testDatabase() {
  const db = new PGlite();
  await db.exec(bootstrapSql);
  for (const sql of await migrations()) await db.exec(sql);
  return db;
}
export async function asUser<T>(db: PGlite, user: string, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.exec('set role authenticated');
  try { return await action(); } finally { await db.exec('reset role'); }
}
