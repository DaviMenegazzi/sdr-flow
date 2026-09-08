import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { testDatabase, asUser } from './helpers/database.js';
import { BackupService, type DatabaseSnapshot } from '../packages/db/src/index.js';

describe('Phase 7 — Database Backup & Tested Restoration (pg_dump / pg_restore equivalent)', () => {
  let sourceDb: PGlite;
  let targetDb: PGlite;

  const ownerId = randomUUID();
  let orgId: string;
  let flowId: string;
  let flowVersionId: string;
  let leadId: string;
  let convId: string;

  beforeAll(async () => {
    sourceDb = await testDatabase();
    targetDb = await testDatabase();

    // 1. Create auth user in sourceDb
    await sourceDb.query('insert into auth.users(id, email) values($1, $2)', [ownerId, 'backup_owner@test.local']);

    // 2. Create organization via stored procedure
    orgId = await asUser(sourceDb, ownerId, async () => {
      const res = await sourceDb.query<{ id: string }>("select public.create_organization('Org com Backup') as id");
      return res.rows[0]!.id;
    });

    // 3. Create connection
    const connRes = await sourceDb.query<{ id: string }>(
      `insert into public.connections(organization_id, name, provider, phone, status)
       values($1, 'WhatsApp Backup Source', 'evolution', '+5511999998888', 'connected')
       returning id`,
      [orgId]
    );
    const connId = connRes.rows[0]!.id;

    // 4. Create flow & published version
    const flowRes = await sourceDb.query<{ id: string }>(
      `insert into public.flows(organization_id, name, draft) values($1, 'Fluxo de Vendas Backup', '{"nodes":[],"edges":[]}') returning id`,
      [orgId]
    );
    flowId = flowRes.rows[0]!.id;

    const fvRes = await sourceDb.query<{ id: string }>(
      `insert into public.flow_versions(organization_id, flow_id, version, graph, created_by)
       values($1, $2, 1, '{"nodes":[],"edges":[]}', $3) returning id`,
      [orgId, flowId, ownerId]
    );
    flowVersionId = fvRes.rows[0]!.id;

    await sourceDb.query(
      `update public.flows set published_version_id = $2 where id = $1`,
      [flowId, flowVersionId]
    );

    // 5. Create lead
    const leadRes = await sourceDb.query<{ id: string }>(
      `insert into public.leads(organization_id, phone, name, city, interest, memory)
       values($1, '+5511988887777', 'Renata Oliveira', 'Campinas', 'Odonto Plus', '{"orcamento":"250"}')
       returning id`,
      [orgId]
    );
    leadId = leadRes.rows[0]!.id;

    // 6. Create conversation & messages
    const convRes = await sourceDb.query<{ id: string }>(
      `insert into public.conversations(organization_id, connection_id, lead_id, flow_version_id, stage, handled_by)
       values($1, $2, $3, $4, 'QUALIFYING', 'AI')
       returning id`,
      [orgId, connId, leadId, flowVersionId]
    );
    convId = convRes.rows[0]!.id;

    await sourceDb.query(
      `insert into public.messages(organization_id, connection_id, conversation_id, direction, sender, content)
       values($1, $2, $3, 'INBOUND', 'lead', 'Olá, quero contratar o plano!')`,
      [orgId, connId, convId]
    );

    // 7. Create deal
    await sourceDb.query(
      `insert into public.deals(organization_id, lead_id, title, status, score)
       values($1, $2, 'Renata - Odonto Plus', 'OPEN', 85)`,
      [orgId, leadId]
    );

    // 8. Create knowledge document
    await sourceDb.query(
      `insert into public.knowledge_documents(organization_id, collection, title, content, token_count)
       values($1, 'pricing', 'Tabela Odonto', 'Plano Odonto Plus custa R$ 120 por mês.', 15)`,
      [orgId]
    );

    // 9. Create metrics daily record
    await sourceDb.query(
      `insert into public.metrics_daily(organization_id, metric_date, flow_id, flow_version_id, total_conversations, qualified_conversations)
       values($1, '2026-09-08', $2, $3, 1, 1)`,
      [orgId, flowId, flowVersionId]
    );
  });

  afterAll(async () => {
    await sourceDb?.close();
    await targetDb?.close();
  });

  it('creates a consistent backup snapshot with cryptographic checksum', async () => {
    const snapshot = await BackupService.createSnapshot(sourceDb);

    expect(snapshot.version).toBe('1.0.0');
    expect(snapshot.checksum).toHaveLength(64); // SHA-256
    expect(snapshot.createdAt).toBeDefined();

    expect(snapshot.tables.organizations.length).toBe(1);
    expect(snapshot.tables.flows.length).toBe(1);
    expect(snapshot.tables.flow_versions.length).toBe(1);
    expect(snapshot.tables.leads.length).toBe(1);
    expect(snapshot.tables.conversations.length).toBe(1);
    expect(snapshot.tables.messages.length).toBe(1);
    expect(snapshot.tables.deals.length).toBe(1);
    expect(snapshot.tables.knowledge_documents.length).toBe(1);
    expect(snapshot.tables.metrics_daily.length).toBe(1);
  });

  it('detects tampering and rejects restoration with corrupted checksum', async () => {
    const snapshot = await BackupService.createSnapshot(sourceDb);
    const tampered: DatabaseSnapshot = {
      ...snapshot,
      checksum: '0000000000000000000000000000000000000000000000000000000000000000', // Invalid checksum
    };

    await expect(BackupService.restoreSnapshot(targetDb, tampered)).rejects.toThrow(
      /checksum.*inválido/i
    );
  });

  it('restores 100% of tables and rows in a clean database preserving relations and RLS', async () => {
    // 1. Also replicate auth.users in targetDb so foreign keys to auth.users resolve
    await targetDb.query('insert into auth.users(id, email) values($1, $2)', [ownerId, 'backup_owner@test.local']);

    const snapshot = await BackupService.createSnapshot(sourceDb);
    const result = await BackupService.restoreSnapshot(targetDb, snapshot);

    expect(result.restoredCounts.organizations).toBe(1);
    expect(result.restoredCounts.leads).toBe(1);
    expect(result.restoredCounts.conversations).toBe(1);
    expect(result.restoredCounts.knowledge_documents).toBe(1);

    // 2. Snapshot targetDb and verify total consistency
    const restoredSnapshot = await BackupService.createSnapshot(targetDb);
    const verification = BackupService.verifyConsistency(snapshot, restoredSnapshot);

    expect(verification.match).toBe(true);
    expect(verification.discrepancies).toHaveLength(0);

    // 3. Verify that RLS works identically on the restored database
    const userConvs = await asUser(targetDb, ownerId, async () => {
      const res = await targetDb.query('select * from public.conversations where organization_id = $1', [orgId]);
      return res.rows;
    });
    expect(userConvs.length).toBe(1);

    // A non-member cannot see conversations
    const foreignUser = randomUUID();
    await targetDb.query('insert into auth.users(id, email) values($1, $2)', [foreignUser, 'foreign@test.local']);

    const foreignConvs = await asUser(targetDb, foreignUser, async () => {
      const res = await targetDb.query('select * from public.conversations where organization_id = $1', [orgId]);
      return res.rows;
    });
    expect(foreignConvs.length).toBe(0);
  });
});
