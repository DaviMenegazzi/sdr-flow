import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import pino from 'pino';
import { queueNames, type FlowContext } from '@sdr/shared';
import { executeFlow, type FlowServices } from '@sdr/flow';
import { createRuntimeProviders, runtimeConfigFromEnv } from '@sdr/flow/server';
import { serviceDatabase, ConnectionRepository, ConversationRepository, ExecutionRepository } from '@sdr/db';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const logger = pino({ name: 'worker' });
const redis = process.env.REDIS_URL;

if (!redis) {
  logger.warn('Worker não iniciado: configure REDIS_URL para processamento em segundo plano.');
} else {
  const url = new URL(redis);
  const connectionOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };

  const maintenanceWorker = new Worker(
    queueNames.maintenance,
    async job => {
      if (job.name !== 'healthcheck') throw new Error(`Unsupported maintenance job: ${job.name}`);
      return { status: 'ok' };
    },
    { connection: connectionOptions, concurrency: 1 }
  );

  const turnsWorker = new Worker(
    queueNames.turns,
    async job => {
      logger.info({ jobId: job.id, name: job.name }, 'Processando turno de conversa');
      const data = job.data as {
        organizationId: string;
        connectionId: string;
        leadId: string;
        conversationId: string;
        flowVersionId: string;
        messages: Array<{ id: string; text: string; fromMe: boolean; type?: string; mediaUrl?: string }>;
      };

      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Supabase não configurado no worker.');
      }

      const db = serviceDatabase(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const convRepo = new ConversationRepository(db);
      const execRepo = new ExecutionRepository(db);

      const { data: flowVersion } = await db
        .from('flow_versions')
        .select('*')
        .eq('id', data.flowVersionId)
        .eq('organization_id', data.organizationId)
        .single();

      if (!flowVersion?.graph) {
        throw new Error(`Flow version ${data.flowVersionId} not found`);
      }

      const [{ data: lead }, { data: conversation }] = await Promise.all([
        db.from('leads').select('*').eq('organization_id', data.organizationId).eq('id', data.leadId).single(),
        db.from('conversations').select('*').eq('organization_id', data.organizationId).eq('id', data.conversationId)
          .eq('connection_id', data.connectionId).eq('lead_id', data.leadId).single(),
      ]);
      if (!lead || !conversation) throw new Error('Lead ou conversa não pertence ao turno solicitado.');

      const execution = await execRepo.createExecution({
        organizationId: data.organizationId,
        conversationId: data.conversationId,
        flowVersionId: data.flowVersionId,
        status: 'running',
      });

      const flowCtx: FlowContext = {
        organizationId: data.organizationId,
        connectionId: data.connectionId,
        leadId: data.leadId,
        conversationId: data.conversationId,
        executionId: execution.id,
        flowVersionId: data.flowVersionId,
        lead: { id: lead.id, phone: lead.phone, name: lead.name, city: lead.city, interest: lead.interest,
          urgency: lead.urgency, memory: (lead.memory as Record<string, unknown>) || {} },
        conversation: { id: conversation.id, stage: conversation.stage, bot_paused: conversation.bot_paused,
          handled_by: conversation.handled_by as 'AI' | 'HUMAN' },
        messages: data.messages,
        variables: {},
        tokens: { input: 0, output: 0 },
      };

      const services: FlowServices = {
        ...createRuntimeProviders(runtimeConfigFromEnv(process.env), id => new ConnectionRepository(db).resolveMessagingConnection(data.organizationId, id)),
        db: {
          updateLead: async (_o, lId, patch) => { await convRepo.updateLead(_o, lId, patch); },
          updateConversation: async (_o, cId, patch) => { await convRepo.updateConversation(_o, cId, patch); },
          saveMessage: async (_o, cId, convId, msg) => {
            const res = await convRepo.saveMessage({
              organizationId: _o,
              connectionId: cId,
              conversationId: convId,
              direction: msg.direction,
              sender: msg.sender,
              content: msg.content,
              messageType: msg.messageType,
              providerMessageId: msg.providerMessageId,
            });
            return { id: res.id };
          },
          syncDeal: async (_o, lId, deal) => {
            const res = await convRepo.syncDeal(_o, lId, deal);
            return { id: res.id };
          },
        },
        now: () => new Date(),
      };

      const result = await executeFlow(flowVersion.graph as any, flowCtx, services, {
        hooks: {
          onStepComplete: async step => {
            await execRepo.recordStep({
              organizationId: data.organizationId,
              executionId: execution.id,
              nodeId: step.nodeId,
              sequence: step.sequence,
              input: step.input,
              output: step.output,
              durationMs: step.durationMs,
              error: step.error,
            });
          },
        },
      });

      await execRepo.updateExecution(execution.id, data.organizationId, {
        status: result.status,
        inputTokens: result.tokens.input,
        outputTokens: result.tokens.output,
        resumeNodeId: result.resumeNodeId,
        finishedAt: result.status !== 'waiting' ? new Date().toISOString() : null,
      });

      if (result.status === 'failed') throw new Error(result.error || 'Execução do fluxo falhou.');
      return { status: result.status, executionId: execution.id };
    },
    { connection: connectionOptions, concurrency: 5 }
  );

  let ready = false;
  maintenanceWorker.on('ready', () => {
    ready = true;
    logger.info('Workers prontos: manutenção e processamento de turnos ativos.');
  });
  maintenanceWorker.on('error', error => {
    ready = false;
    logger.error({ message: error.message }, 'Redis indisponível');
  });

  const health = createServer(async (_req, res) => {
    try {
      const client = await maintenanceWorker.client;
      if (client.status !== 'ready') throw new Error('Redis not ready');
      await client.get('sdr:health');
      ready = true;
    } catch {
      ready = false;
    }
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready, service: 'worker' }));
  }).listen(3002, '0.0.0.0');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await Promise.all([maintenanceWorker.close(), turnsWorker.close()]);
      health.close(() => process.exit(0));
    });
  }
}
