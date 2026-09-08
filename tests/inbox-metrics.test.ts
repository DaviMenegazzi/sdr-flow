import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { testDatabase, asUser } from './helpers/database.js';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';

describe('Phase 6 — Live Inbox, Metrics Dashboard, Daily Rollup & CSV Export', () => {
  let db: PGlite;
  const ownerA = randomUUID();
  const agentA = randomUUID();
  const ownerB = randomUUID();

  let orgA: string;
  let orgB: string;

  let connA: string;
  let connB: string;

  let lead1Id: string;
  let lead2Id: string;
  let leadBId: string;

  let conv1Id: string;
  let conv2Id: string;
  let convBId: string;

  beforeAll(async () => {
    db = await testDatabase();

    for (const uid of [ownerA, agentA, ownerB]) {
      await db.query('insert into auth.users(id, email) values($1, $2)', [uid, `${uid}@test.local`]);
    }

    orgA = await asUser(db, ownerA, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Clinica Alpha') as id");
      return res.rows[0]!.id;
    });

    orgB = await asUser(db, ownerB, async () => {
      const res = await db.query<{ id: string }>("select public.create_organization('Clinica Beta') as id");
      return res.rows[0]!.id;
    });

    // Add agentA to orgA as agent
    await db.query(
      "insert into public.organization_members(organization_id, user_id, role) values($1, $2, 'agent')",
      [orgA, agentA]
    );

    // Create connections
    const connARes = await db.query<{ id: string }>(
      `insert into public.connections(organization_id, name, provider, phone, status)
       values($1, 'WhatsApp Principal Alpha', 'evolution', '+5511999990001', 'connected')
       returning id`,
      [orgA]
    );
    connA = connARes.rows[0]!.id;

    const connBRes = await db.query<{ id: string }>(
      `insert into public.connections(organization_id, name, provider, phone, status)
       values($1, 'WhatsApp Beta', 'evolution', '+5511999990002', 'connected')
       returning id`,
      [orgB]
    );
    connB = connBRes.rows[0]!.id;

    // Create leads in orgA
    const l1 = await db.query<{ id: string }>(
      `insert into public.leads(organization_id, phone, name, city, interest, urgency, memory)
       values($1, '+5511988881111', 'Carlos Silva', 'São Paulo', 'Cardiologia', 'Alta', $2)
       returning id`,
      [orgA, JSON.stringify({ budget: 'R$ 300/mês', pain_points: 'Dor no peito' })]
    );
    lead1Id = l1.rows[0]!.id;

    const l2 = await db.query<{ id: string }>(
      `insert into public.leads(organization_id, phone, name, city, interest, urgency, memory)
       values($1, '+5511988882222', 'Mariana Souza', 'Campinas', 'Dermatologia', 'Média', $2)
       returning id`,
      [orgA, JSON.stringify({ budget: 'R$ 150/mês' })]
    );
    lead2Id = l2.rows[0]!.id;

    // Create lead in orgB
    const lb = await db.query<{ id: string }>(
      `insert into public.leads(organization_id, phone, name, city, interest, urgency, memory)
       values($1, '+5511988883333', 'Fernando OrgB', 'Santos', 'Ortopedia', 'Baixa', '{}')
       returning id`,
      [orgB]
    );
    leadBId = lb.rows[0]!.id;

    // Create conversations
    const c1 = await db.query<{ id: string }>(
      `insert into public.conversations(organization_id, connection_id, lead_id, stage, handled_by, bot_paused)
       values($1, $2, $3, 'NEW_CONVERSATION', 'AI', false)
       returning id`,
      [orgA, connA, lead1Id]
    );
    conv1Id = c1.rows[0]!.id;

    const c2 = await db.query<{ id: string }>(
      `insert into public.conversations(organization_id, connection_id, lead_id, stage, handled_by, bot_paused)
       values($1, $2, $3, 'QUALIFYING', 'AI', false)
       returning id`,
      [orgA, connA, lead2Id]
    );
    conv2Id = c2.rows[0]!.id;

    const cb = await db.query<{ id: string }>(
      `insert into public.conversations(organization_id, connection_id, lead_id, stage, handled_by, bot_paused)
       values($1, $2, $3, 'NEW_CONVERSATION', 'AI', false)
       returning id`,
      [orgB, connB, leadBId]
    );
    convBId = cb.rows[0]!.id;

    // Messages for conv1: inbound then outbound (test first response time)
    const baseTime = new Date('2026-09-08T10:00:00Z');
    const replyTime = new Date('2026-09-08T10:00:05Z'); // 5 seconds later (5000ms)

    await db.query(
      `insert into public.messages(organization_id, connection_id, conversation_id, direction, sender, content, created_at)
       values($1, $2, $3, 'INBOUND', 'lead', 'Olá, gostaria de saber o valor da consulta.', $4)`,
      [orgA, connA, conv1Id, baseTime.toISOString()]
    );

    await db.query(
      `insert into public.messages(organization_id, connection_id, conversation_id, direction, sender, content, created_at)
       values($1, $2, $3, 'OUTBOUND', 'ai', 'Olá Carlos! A consulta é R$ 150.', $4)`,
      [orgA, connA, conv1Id, replyTime.toISOString()]
    );

    await db.query(
      `update public.conversations set last_message_at = $2 where id = $1`,
      [conv1Id, replyTime.toISOString()]
    );

    // Flow executions with tokens for orgA
    const flowRes = await db.query<{ id: string }>(
      `insert into public.flows(organization_id, name, draft) values($1, 'Fluxo SDR V1', '{}') returning id`,
      [orgA]
    );
    const flowId = flowRes.rows[0]!.id;

    const fvRes = await db.query<{ id: string }>(
      `insert into public.flow_versions(organization_id, flow_id, version, graph, created_by)
       values($1, $2, 1, '{"nodes":[],"edges":[]}', $3) returning id`,
      [orgA, flowId, ownerA]
    );
    const fvId = fvRes.rows[0]!.id;

    await db.query(
      `update public.conversations set flow_version_id = $2 where id = $1`,
      [conv1Id, fvId]
    );

    await db.query(
      `insert into public.flow_executions(organization_id, conversation_id, flow_version_id, status, input_tokens, output_tokens, created_at)
       values($1, $2, $3, 'completed', 1000, 500, now())`,
      [orgA, conv1Id, fvId]
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('1. RLS Isolation on Conversations, Messages, and Metrics', () => {
    it('allows agentA to read conversations in orgA but strictly isolates orgB', async () => {
      const convs = await asUser(db, agentA, async () => {
        const res = await db.query('select * from public.conversations where organization_id = $1', [orgA]);
        return res.rows;
      });
      expect(convs.length).toBe(2);

      const convsB = await asUser(db, agentA, async () => {
        const res = await db.query('select * from public.conversations where organization_id = $1', [orgB]);
        return res.rows;
      });
      expect(convsB.length).toBe(0);
    });

    it('allows authenticated update on conversations within the same organization', async () => {
      await asUser(db, agentA, async () => {
        await db.query(
          "update public.conversations set stage = 'QUALIFYING' where id = $1 and organization_id = $2",
          [conv1Id, orgA]
        );
      });

      const check = await db.query<{ stage: string }>(
        'select stage from public.conversations where id = $1',
        [conv1Id]
      );
      expect(check.rows[0]!.stage).toBe('QUALIFYING');
    });

    it('blocks user from updating conversations in another organization', async () => {
      await asUser(db, ownerB, async () => {
        await db.query(
          "update public.conversations set stage = 'CLOSED' where id = $1 and organization_id = $2",
          [conv1Id, orgA]
        );
      });

      const check = await db.query<{ stage: string }>(
        'select stage from public.conversations where id = $1',
        [conv1Id]
      );
      // Stage must remain QUALIFYING because ownerB has no access to orgA
      expect(check.rows[0]!.stage).toBe('QUALIFYING');
    });

    it('enforces RLS on metrics_daily table', async () => {
      // Insert a metrics_daily row for orgB
      await db.query(
        `insert into public.metrics_daily(organization_id, metric_date, total_conversations)
         values($1, '2026-09-08', 50)`,
        [orgB]
      );

      // agentA in orgA should see 0 rows from orgB
      const rows = await asUser(db, agentA, async () => {
        const res = await db.query('select * from public.metrics_daily where organization_id = $1', [orgB]);
        return res.rows;
      });
      expect(rows.length).toBe(0);
    });
  });

  describe('2. InboxRepository Operations', () => {
    it('lists conversations with lead info, stage filters, and search term', async () => {
      const inboxRepo = new database.InboxRepository(db);

      // List all in orgA
      const all = await inboxRepo.listConversations(orgA);
      expect(all.total).toBe(2);
      expect(all.conversations.length).toBe(2);
      expect(all.conversations[0].lead.phone).toBeDefined();

      // Filter by search 'Carlos'
      const searchRes = await inboxRepo.listConversations(orgA, { search: 'Carlos' });
      expect(searchRes.total).toBe(1);
      expect(searchRes.conversations[0].lead.name).toBe('Carlos Silva');

      // Filter by search phone
      const phoneRes = await inboxRepo.listConversations(orgA, { search: '988882222' });
      expect(phoneRes.total).toBe(1);
      expect(phoneRes.conversations[0].lead.name).toBe('Mariana Souza');
    });

    it('retrieves single conversation detail and its messages', async () => {
      const inboxRepo = new database.InboxRepository(db);
      const conv = await inboxRepo.getConversation(orgA, conv1Id);

      expect(conv).toBeDefined();
      expect(conv?.lead.name).toBe('Carlos Silva');
      expect(conv?.connection?.name).toBe('WhatsApp Principal Alpha');

      const messages = await inboxRepo.getMessages(orgA, conv1Id);
      expect(messages.length).toBe(2);
      expect(messages[0].direction).toBe('INBOUND');
      expect(messages[1].direction).toBe('OUTBOUND');
      expect(messages[1].sender).toBe('ai');
    });

    it('performs takeover, pausing bot and recording audit event', async () => {
      const inboxRepo = new database.InboxRepository(db);
      const updated = await inboxRepo.takeover(orgA, conv1Id, agentA);

      expect(updated.handled_by).toBe('HUMAN');
      expect(updated.bot_paused).toBe(true);
      expect(updated.assigned_user_id).toBe(agentA);

      // Verify audit event
      const audit = await db.query<{ action: string; actor_id: string }>(
        "select action, actor_id from public.audit_events where entity_id = $1 and action = 'conversation.takeover'",
        [conv1Id]
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].actor_id).toBe(agentA);
    });

    it('sends human outbound message and updates last_message_at', async () => {
      const inboxRepo = new database.InboxRepository(db);
      const msg = await inboxRepo.sendHumanMessage({
        organizationId: orgA,
        connectionId: connA,
        conversationId: conv1Id,
        content: 'Olá Carlos, sou o atendente humano. Como posso te auxiliar?',
        actorId: agentA,
      });

      expect(msg.sender).toBe('human');
      expect(msg.direction).toBe('OUTBOUND');
      expect(msg.content).toContain('atendente humano');

      const conv = await inboxRepo.getConversation(orgA, conv1Id);
      expect(conv?.last_message_at).toBeDefined();
    });

    it('releases conversation back to AI, resuming bot and recording audit event', async () => {
      const inboxRepo = new database.InboxRepository(db);
      const updated = await inboxRepo.release(orgA, conv1Id, agentA);

      expect(updated.handled_by).toBe('AI');
      expect(updated.bot_paused).toBe(false);

      const audit = await db.query<{ action: string; actor_id: string }>(
        "select action, actor_id from public.audit_events where entity_id = $1 and action = 'conversation.release'",
        [conv1Id]
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].actor_id).toBe(agentA);
    });

    it('assigns user and updates stage with audit events', async () => {
      const inboxRepo = new database.InboxRepository(db);

      // Assign to agentA
      const assigned = await inboxRepo.assign(orgA, conv2Id, agentA, ownerA);
      expect(assigned.assigned_user_id).toBe(agentA);

      // Update stage to PRESENTING_SOLUTION
      const staged = await inboxRepo.updateStage(orgA, conv2Id, 'PRESENTING_SOLUTION', agentA);
      expect(staged.stage).toBe('PRESENTING_SOLUTION');
      expect(staged.stage_updated_at).toBeDefined();
    });
  });

  describe('3. Daily Metrics Rollup and Consolidation', () => {
    it('executes rollup_metrics_daily consolidating conversations, stages, response times and tokens', async () => {
      const metricsRepo = new database.MetricsRepository(db);
      const today = new Date().toISOString().split('T')[0]!;

      const rolled = await metricsRepo.rollupDaily(orgA, today);

      expect(rolled).toBeDefined();
      expect(rolled.organization_id).toBe(orgA);
      expect(rolled.total_conversations).toBeGreaterThanOrEqual(2);
      expect(rolled.total_input_tokens).toBe(1000);
      expect(rolled.total_output_tokens).toBe(500);
      expect(Number(rolled.estimated_token_cost)).toBeGreaterThan(0);
      expect(typeof rolled.stage_counts).toBe('object');
    });

    it('provides comprehensive dashboard metrics with funnel and flow comparison', async () => {
      const metricsRepo = new database.MetricsRepository(db);
      const dashboard = await metricsRepo.getDashboardMetrics(orgA);

      expect(dashboard.totalConversations).toBe(2);
      expect(dashboard.funnel.length).toBe(8); // 8 canonical stages
      expect(dashboard.funnel[0].stage).toBe('NEW_CONVERSATION');
      expect(dashboard.totalTokens).toBe(1500); // 1000 + 500
      expect(dashboard.totalEstimatedCost).toBeGreaterThan(0);
      expect(dashboard.flowComparison.length).toBe(1);
      expect(dashboard.flowComparison[0].flowName).toBe('Fluxo SDR V1');
      expect(dashboard.dailyTrends.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. RFC 4180 CSV Export for Leads and Conversations', () => {
    it('exports leads in RFC 4180 CSV format with all required fields', async () => {
      const metricsRepo = new database.MetricsRepository(db);
      const csv = await metricsRepo.exportLeadsCsv(orgA);

      expect(csv).toContain('ID,Telefone,Nome,Cidade,Interesse,Urgencia,Estagio,Criado_Em,Memoria_Resumo');
      expect(csv).toContain('Carlos Silva');
      expect(csv).toContain('+5511988881111');
      expect(csv).toContain('Cardiologia');
      expect(csv).toContain('Mariana Souza');
    });

    it('exports conversations in RFC 4180 CSV format', async () => {
      const metricsRepo = new database.MetricsRepository(db);
      const csv = await metricsRepo.exportConversationsCsv(orgA);

      expect(csv).toContain('ID,Telefone_Lead,Nome_Lead,Estagio,Atendido_Por,Bot_Pausado,Responsavel,Ultima_Mensagem_Em,Criado_Em,Total_Mensagens');
      expect(csv).toContain('Carlos Silva');
      expect(csv).toContain('+5511988881111');
    });
  });

  describe('5. API Endpoints Integration', () => {
    const config = {
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'public-test-key',
      serviceRoleKey: 'private-test-key',
    };

    it('serves inbox conversations, metrics, and CSV export via HTTP', async () => {
      // Mock userDatabase to authenticate as ownerA
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
      };

      vi.spyOn(database, 'userDatabase').mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: ownerA } }, error: null }),
        },
        from: vi.fn().mockReturnValue(mockChain),
      } as any);

      // Mock InboxRepository and MetricsRepository prototypes for HTTP calls
      vi.spyOn(database.InboxRepository.prototype, 'listConversations').mockResolvedValueOnce({
        conversations: [
          {
            id: conv1Id,
            organization_id: orgA,
            connection_id: connA,
            lead_id: lead1Id,
            flow_version_id: null,
            stage: 'NEW_CONVERSATION',
            bot_paused: false,
            handled_by: 'AI',
            assigned_user_id: null,
            last_message_at: null,
            stage_updated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            lead: { id: lead1Id, phone: '+5511988881111', name: 'Carlos', city: null, interest: null, urgency: null, memory: {} },
          },
        ],
        total: 1,
      });

      const app = createApp(config);

      // GET /inbox/conversations
      const resInbox = await request(app)
        .get(`/api/organizations/${orgA}/inbox/conversations`)
        .auth('valid-token', { type: 'bearer' });

      expect(resInbox.status).toBe(200);
      expect(resInbox.body.total).toBe(1);
      expect(resInbox.body.conversations[0].lead.name).toBe('Carlos');

      // GET /metrics/dashboard
      vi.spyOn(database.MetricsRepository.prototype, 'getDashboardMetrics').mockResolvedValueOnce({
        totalConversations: 10,
        newConversations: 10,
        qualifiedConversations: 4,
        qualificationRate: 40,
        handoffConversations: 2,
        avgFirstResponseTimeSec: 3.5,
        totalTokens: 15000,
        totalEstimatedCost: 0.025,
        costPerQualifiedLead: 0.006,
        funnel: [],
        flowComparison: [],
        dailyTrends: [],
      });

      const resMetrics = await request(app)
        .get(`/api/organizations/${orgA}/metrics/dashboard`)
        .auth('valid-token', { type: 'bearer' });

      expect(resMetrics.status).toBe(200);
      expect(resMetrics.body.totalConversations).toBe(10);
      expect(resMetrics.body.qualificationRate).toBe(40);

      // GET /export/leads.csv
      vi.spyOn(database.MetricsRepository.prototype, 'exportLeadsCsv').mockResolvedValueOnce(
        'ID,Telefone,Nome\n"123","+5511988881111","Carlos"'
      );

      const resCsv = await request(app)
        .get(`/api/organizations/${orgA}/export/leads.csv`)
        .auth('valid-token', { type: 'bearer' });

      expect(resCsv.status).toBe(200);
      expect(resCsv.headers['content-type']).toContain('text/csv');
      expect(resCsv.text).toContain('Carlos');
    });
  });
});
