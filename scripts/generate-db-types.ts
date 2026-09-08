// Generates the checked-in Supabase client types from our actual migrated Postgres catalog.
// PGlite is used only for tooling/tests; applications always use the Supabase client.
import { writeFile, readFile } from 'node:fs/promises';
import { testDatabase } from '../tests/helpers/database.js';

const db = await testDatabase();
try {
  const enums = await db.query<{ name: string; labels: string[] }>(`select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname`);
  const enumMap = new Map(enums.rows.map(row => [row.name,row.labels.map(label => JSON.stringify(label)).join(' | ')]));
  const columns = await db.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string; column_default: string | null }>(`select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`);
  const names = [...new Set(columns.rows.map(row => row.table_name))];
  const scalarTypeOf = (udt: string) => enumMap.has(udt) ? `Database['public']['Enums']['${udt}']` : udt === 'jsonb' ? 'Json' : ['int2','int4','int8','float4','float8','numeric'].includes(udt) ? 'number' : udt === 'bool' ? 'boolean' : 'string';
  const typeOf = (udt: string) => udt.startsWith('_') ? `${scalarTypeOf(udt.slice(1))}[]` : scalarTypeOf(udt);
  const tables = names.map(name => {
    const fields = columns.rows.filter(row => row.table_name === name);
    const shape = (mode: 'Row'|'Insert'|'Update') => fields.map(row => `        ${row.column_name}${mode === 'Update' || (mode === 'Insert' && (row.column_default !== null || row.is_nullable === 'YES')) ? '?' : ''}: ${typeOf(row.udt_name)}${row.is_nullable === 'YES' ? ' | null' : ''};`).join('\n');
    return `    ${name}: {\n      Row: {\n${shape('Row')}\n      };\n      Insert: {\n${shape('Insert')}\n      };\n      Update: {\n${shape('Update')}\n      };\n      Relationships: [];\n    };`;
  }).join('\n');
  const result = `// Generated from supabase/migrations by pnpm db:types. Do not edit.\nexport type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\nexport type Database = {\n  public: {\n    Tables: {\n${tables}\n    };\n    Views: Record<never, never>;\n    Functions: {\n      set_connection_credentials: { Args: { p_org: string; p_connection: string; p_ciphertext: string }; Returns: undefined };\n      get_connection_credentials: { Args: { p_connection: string }; Returns: string | null };\n      create_organization: { Args: { org_name: string }; Returns: string };\n      publish_flow: { Args: { p_org: string; p_flow: string; p_actor: string; p_graph: Json }; Returns: Database['public']['Tables']['flow_versions']['Row'] };\n      create_invitation: { Args: { p_org: string; p_email: string; p_role: Database['public']['Enums']['member_role']; p_token: string }; Returns: Database['public']['Tables']['invitations']['Row'] };\n      accept_invitation: { Args: { p_token: string }; Returns: string };\n      match_knowledge: { Args: { p_org: string; p_embedding: number[]; p_collection?: string | null; p_threshold?: number; p_limit?: number }; Returns: { id: string; collection: string; title: string; content: string; metadata: Json; similarity: number }[] };\n      rollup_metrics_daily: { Args: { p_org: string; p_target_date: string; p_flow_version?: string | null }; Returns: Database['public']['Tables']['metrics_daily']['Row'] };\n    };\n    Enums: {\n${enums.rows.sort((a,b) => a.name.localeCompare(b.name)).map(row => `      ${row.name}: ${enumMap.get(row.name)};`).join('\n')}\n    };\n    CompositeTypes: Record<never, never>;\n  };\n};\n`;
  const path = new URL('../packages/db/src/database.types.ts', import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(path,'utf8') !== result) throw new Error('Database types differ from migrations. Run pnpm db:types.');
  } else await writeFile(path,result);
  console.log(`Database types verified: ${names.length} tables, ${enums.rows.length} enums.`);
} finally { await db.close(); }
