import { createHash } from 'node:crypto';

export interface DatabaseSnapshot {
  version: string;
  createdAt: string;
  checksum: string;
  tables: Record<string, any[]>;
}

const PUBLIC_TABLES = [
  'organizations',
  'organization_members',
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
        'organization_members',
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
      ];

      await db.query('begin');
      try {
        const flowPublishedUpdates: Array<{ id: string; orgId: string; pubId: string }> = [];

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
