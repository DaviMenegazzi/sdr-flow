import type { PGlite } from '@electric-sql/pglite';

/**
 * Minimal Supabase-client stand-in backed by PGlite, so RLS policies and billing RPCs run
 * for real. Queries are serialized because role switching is per-connection.
 */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}
async function runAs<T>(db: PGlite, userId: string | null, sql: string, params: unknown[]): Promise<T[]> {
  return serialized(async () => {
    if (userId) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
      await db.exec('set role authenticated');
    } else {
      await db.exec('set role service_role');
    }
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('reset role');
    }
  });
}
const SET_RETURNING = new Set(['billing_record_event', 'billing_claim_events', 'billing_reconciliation_report', 'get_organization_limits', 'billing_pending_replaced_subscriptions']);
export function pgClient(db: PGlite, userId: string | null) {
  const toError = (error: any) => ({ code: error?.code, message: error?.message, hint: error?.hint });
  const from = (table: string) => {
    let columns = '*';
    const where: string[] = [];
    const params: unknown[] = [];
    let order = '';
    let limit = '';
    const builder: any = {
      select(cols = '*') { columns = cols; return builder; },
      eq(col: string, value: unknown) { params.push(value); where.push(`${col} = $${params.length}`); return builder; },
      neq(col: string, value: unknown) { params.push(value); where.push(`${col} <> $${params.length}`); return builder; },
      in(col: string, values: unknown[]) { params.push(values); where.push(`${col}::text = any($${params.length}::text[])`); return builder; },
      is(col: string, value: null) { where.push(`${col} is ${value === null ? 'null' : 'not null'}`); return builder; },
      order(col: string, opts?: { ascending?: boolean }) { order = ` order by ${col} ${opts?.ascending === false ? 'desc' : 'asc'}`; return builder; },
      limit(n: number) { limit = ` limit ${Number(n)}`; return builder; },
      async execute() {
        const sql = `select ${columns} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${order}${limit}`;
        try { return { data: await runAs(db, userId, sql, params), error: null }; } catch (error) { return { data: null, error: toError(error) }; }
      },
      async maybeSingle() { const result = await builder.execute(); return { data: result.data?.[0] ?? null, error: result.error }; },
      then(resolve: any, reject: any) { return builder.execute().then(resolve, reject); },
    };
    return builder;
  };
  return {
    auth: { getUser: async (token: string) => ({ data: { user: { id: token, email: `${token.slice(0, 8)}@example.test` } }, error: null }) },
    from,
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const values = keys.map(key => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
      const sql = `select * from public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')})`;
      try {
        const rows = await runAs<Record<string, unknown>>(db, userId, sql, values);
        if (SET_RETURNING.has(name)) return { data: rows, error: null };
        const first = rows[0];
        if (first && Object.keys(first).length === 1 && name in first) return { data: first[name], error: null };
        return { data: first ?? null, error: null };
      } catch (error) {
        return { data: null, error: toError(error) };
      }
    },
  };
}

