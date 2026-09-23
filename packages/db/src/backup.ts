import { createHash } from 'node:crypto';

export interface DatabaseSnapshot {
  version: string;
  createdAt: string;
  checksum: string;
  tables: Record<string, any[]>;
}

const PUBLIC_TABLES = [
  'organizations',
  'profiles',
  'organization_members',
  'account_limits',
  'ai_agents',
  'invitations',
  'api_keys',
  'flows',
  'flow_versions',
  'connections',
  'leads',
  'conversations',
  'messages',
  'deals',
  'flow_executions',
  'flow_execution_steps',
  'audit_events',
  'knowledge_documents',
  'conversation_summaries',
  'metrics_daily',
  // Cobrança da assinatura (histórico financeiro; sem cartão, documento ou segredo —
  // clientes do gateway e a inbox de webhooks ficam no schema privado e fora do backup).
  'organization_limits',
  'organization_plan_grants',
  'organization_subscriptions',
  'checkout_intents',
  'billing_payments',
  'billing_entitlement_changes',
];

export class BackupService {
  static async createSnapshot(db: any): Promise<DatabaseSnapshot> {
    const tablesData: Record<string, any[]> = {};

    if (typeof db.query === 'function' && typeof db.from !== 'function') {
      for (const table of PUBLIC_TABLES) {
        try {
          const res = await db.query(`select * from public.${table} order by created_at asc`);
          tablesData[table] = res.rows;
        } catch {
          // Table might not exist or be empty
          tablesData[table] = [];
        }
      }
    } else {
      for (const table of PUBLIC_TABLES) {
        const { data } = await db.from(table).select('*');
        tablesData[table] = data || [];
      }
    }

    const jsonStr = JSON.stringify(tablesData);
    const checksum = createHash('sha256').update(jsonStr).digest('hex');

    return {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      checksum,
      tables: tablesData,
    };
  }

  static async restoreSnapshot(db: any, snapshot: DatabaseSnapshot): Promise<{ restoredCounts: Record<string, number> }> {
    // Validate checksum integrity
    const jsonStr = JSON.stringify(snapshot.tables);
    const calculatedChecksum = createHash('sha256').update(jsonStr).digest('hex');

    if (calculatedChecksum !== snapshot.checksum) {
      throw new Error('Falha de integridade: o checksum do snapshot de backup é inválido.');
    }

    const restoredCounts: Record<string, number> = {};

    if (typeof db.query === 'function' && typeof db.from !== 'function') {
      // In PGlite / PostgreSQL, disable triggers or insert in topological order
      // Order of insertion respecting Foreign Keys:
      const orderedTables = [
        'organizations',
        'profiles',
        'organization_members',
        'account_limits',
        'ai_agents',
        'invitations',
        'api_keys',
        'flows',
        'flow_versions',
        'connections',
        'leads',
        'conversations',
        'messages',
        'deals',
        'flow_executions',
        'flow_execution_steps',
        'audit_events',
        'knowledge_documents',
        'conversation_summaries',
        'metrics_daily',
        'organization_limits',
        'organization_plan_grants',
        'organization_subscriptions',
        'checkout_intents',
        'billing_payments',
        'billing_entitlement_changes',
      ];

      await db.query('begin');
      try {
        // Creating auth.users runs the signup provisioning trigger. On a clean
        // disaster-recovery target, remove only that empty bootstrap tenant so
        // the original profile, limits and default agent can be restored.
        const profileRows = snapshot.tables.profiles || [];
        const snapshotOrganizationIds = (snapshot.tables.organizations || []).map((row) => row.id);
        for (const profile of profileRows) {
          const bootstrap = await db.query(
            `select o.id from public.organizations o join public.profiles p on p.default_organization_id=o.id
             where p.user_id=$1 and not (o.id=any($2::uuid[]))
               and not exists(select 1 from public.connections c where c.organization_id=o.id)
               and not exists(select 1 from public.flows f where f.organization_id=o.id)`,
            [profile.user_id, snapshotOrganizationIds]
          );
          for (const row of bootstrap.rows as Array<{ id: string }>) {
            await db.query('delete from public.ai_agents where organization_id=$1', [row.id]);
            await db.query('delete from public.account_limits where organization_id=$1', [row.id]);
            await db.query('delete from public.profiles where user_id=$1 and default_organization_id=$2', [profile.user_id, row.id]);
            await db.query('delete from public.organizations where id=$1', [row.id]);
          }
        }
        const flowPublishedUpdates: Array<{ id: string; orgId: string; pubId: string }> = [];
        // organization_subscriptions.latest_payment_id ↔ billing_payments.subscription_id is circular.
        const latestPaymentUpdates: Array<{ id: string; orgId: string; paymentId: string }> = [];

        for (const table of orderedTables) {
          const rows = snapshot.tables[table] || [];
          restoredCounts[table] = 0;

          for (const row of rows) {
            const rowCopy = { ...row };
            if (table === 'flows' && rowCopy.published_version_id) {
              flowPublishedUpdates.push({
                id: rowCopy.id,
                orgId: rowCopy.organization_id,
                pubId: rowCopy.published_version_id,
              });
              rowCopy.published_version_id = null;
            }
            if (table === 'organization_subscriptions' && rowCopy.latest_payment_id) {
              latestPaymentUpdates.push({ id: rowCopy.id, orgId: rowCopy.organization_id, paymentId: rowCopy.latest_payment_id });
              rowCopy.latest_payment_id = null;
            }

            const keys = Object.keys(rowCopy);
            if (keys.length === 0) continue;

            const cols = keys.join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const values = keys.map((k) => {
              const v = rowCopy[k];
              if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
                return JSON.stringify(v);
              }
              return v;
            });

            await db.query(
              `insert into public.${table} (${cols}) values (${placeholders}) on conflict do nothing`,
              values
            );
            restoredCounts[table]++;
          }
        }

        // Restaura os ponteiros published_version_id após inserção de flow_versions
        for (const item of flowPublishedUpdates) {
          await db.query(
            `update public.flows set published_version_id = $1 where id = $2 and organization_id = $3`,
            [item.pubId, item.id, item.orgId]
          );
        }

        for (const item of latestPaymentUpdates) {
          await db.query(
            `update public.organization_subscriptions set latest_payment_id = $1 where id = $2 and organization_id = $3`,
            [item.paymentId, item.id, item.orgId]
          );
        }

        await db.query('commit');
      } catch (err) {
        await db.query('rollback');
        throw err;
      }
    }

    return { restoredCounts };
  }

  static verifyConsistency(
    snapshotA: DatabaseSnapshot,
    snapshotB: DatabaseSnapshot
  ): { match: boolean; discrepancies: string[] } {
    const discrepancies: string[] = [];

    for (const table of PUBLIC_TABLES) {
      const countA = snapshotA.tables[table]?.length || 0;
      const countB = snapshotB.tables[table]?.length || 0;
      if (countA !== countB) {
        discrepancies.push(`Tabela ${table}: original tem ${countA} registros, restaurado tem ${countB}`);
      }
    }

    return {
      match: discrepancies.length === 0,
      discrepancies,
    };
  }
}
