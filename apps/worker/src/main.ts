import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { queueNames } from '@sdr/shared';
import { runtimeConfigFromEnv } from '@sdr/flow/server';
import { serviceDatabase, BillingRepository, drainBillingEvents, cancelReplacedSubscriptions, resolveBillingGateway } from '@sdr/db';
import {
  RedisTurnBuffer,
  processTurn,
  dispatchPendingInboundEvents,
  RedisExecutionEventPublisher,
  RedisDebugRegistry,
  RedisTraceSink,
  TraceBatchWriter,
  IORedisStreamCommands,
  layaConfigFromEnv,
  RedisLeadClassificationQueue,
  startLeadClassificationWorker,
} from '@sdr/runtime';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const logger = pino({ name: 'worker' });
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  logger.warn('Worker não iniciado: configure REDIS_URL para processamento em segundo plano.');
} else if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.error('Worker não iniciado: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
} else {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = serviceDatabase(supabaseUrl, serviceRoleKey);
  const eventPublisher = new RedisExecutionEventPublisher(redisUrl);
  const debugRegistry = new RedisDebugRegistry(redisUrl);
  const traceSink = new RedisTraceSink(redisUrl);
  const runtimeConfig = runtimeConfigFromEnv(process.env);

  // Fase 3: batches flow_execution_steps writes instead of one insert per node
  // (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 9.2) — its own Redis connection since it reads
  // via a consumer group (XREADGROUP), a different access pattern than the pub/sub/XADD
  // connections above.
  const traceWriterRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const traceBatchWriter = new TraceBatchWriter({
    db,
    streamCommands: new IORedisStreamCommands(traceWriterRedis),
    batchSize: Number(process.env.TRACE_BATCH_SIZE) || 30,
    onError: err => logger.error({ err }, 'Falha ao gravar lote de trace'),
  });
  void traceBatchWriter.start();

  const url = new URL(redisUrl);
  const connectionOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };

  // Laya lead classification (temperature + lost detection). Optional: without LAYA_SERVICE_URL
  // and LAYA_SERVICE_SECRET the funnel still moves on flow signals and text rules.
  const layaConfig = layaConfigFromEnv(process.env);
  const leadClassificationQueue = layaConfig
    ? new RedisLeadClassificationQueue(redisUrl, Number(process.env.LAYA_DEBOUNCE_MS) || 60_000)
    : undefined;
  const leadClassificationWorker = layaConfig
    ? startLeadClassificationWorker(
        redisUrl,
        { db, laya: layaConfig, lostThreshold: Number(process.env.LAYA_LOST_INTEREST_THRESHOLD) || 0.8 },
        {
          onResult: (job, result) => logger.info({ leadId: job.leadId, ...result }, 'Classificação Laya do lead'),
          onError: (job, err) => logger.warn({ leadId: job.leadId, message: err instanceof Error ? err.message : String(err) }, 'Falha na classificação Laya do lead'),
        }
      )
    : undefined;
  if (!layaConfig) logger.warn('Classificação Laya desativada: configure LAYA_SERVICE_URL e LAYA_SERVICE_SECRET.');

  const maintenanceWorker = new Worker(
    queueNames.maintenance,
    async job => {
      if (job.name !== 'healthcheck') throw new Error(`Unsupported maintenance job: ${job.name}`);
      return { status: 'ok' };
    },
    { connection: connectionOptions, concurrency: 1 }
  );

  // The one real consumer of the canonical turns queue in production
  // (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.2/8.9) — apps/api only ever produces to it.
  const turnBuffer = new RedisTurnBuffer(
    redisUrl,
    queueNames.turns,
    async turn => {
      logger.info(
        { conversationKey: turn.job.conversationKey, generation: turn.job.generation, eventCount: turn.inboundEventIds.length, correlationId: turn.job.correlationId },
        'Processando turno de conversa'
      );
      return processTurn(
        { db, runtimeConfig, eventPublisher, debugRegistry, traceSink, leadClassification: leadClassificationQueue },
        {
          organizationId: turn.job.organizationId,
          connectionId: turn.job.connectionId,
          flowVersionId: turn.job.flowVersionId,
          flowId: turn.job.flowId,
          agentId: turn.job.agentId,
          inboundEventIds: turn.inboundEventIds,
          isCurrent: turn.isCurrent,
        }
      );
    },
    { concurrency: Number(process.env.TURN_WORKER_CONCURRENCY) || 5 }
  );

  const dispatchInterval = setInterval(() => {
    void dispatchPendingInboundEvents({ db, buffer: turnBuffer }).catch(err => logger.error({ err }, 'Falha ao varrer outbox de inbound_events'));
  }, Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS) || 30_000);
  dispatchInterval.unref();

  // Cobrança da assinatura (docs/BILLING.md): Postgres é a fonte de verdade. Reprocessa
  // webhooks pendentes/falhos com backoff e aplica fim de carência, cancelamentos no fim
  // do período, downgrades agendados e concessões vencidas. Divergências vão para o log.
  const billing = new BillingRepository(db);
  // Same adapter as the API; misconfiguration fails at boot instead of silently skipping.
  const billingGateway = resolveBillingGateway(process.env);
  let billingTick = 0;
  const billingInterval = setInterval(() => {
    billingTick += 1;
    void (async () => {
      await drainBillingEvents(billing);
      // Upgrade = new gateway subscription; the replaced one must stop charging.
      if (billingGateway) await cancelReplacedSubscriptions(billing, billingGateway);
      const changed = await billing.runMaintenance();
      if (changed) logger.info({ changed }, 'Direitos de plano atualizados pela rotina de cobrança');
      // Relatório de conciliação a cada ~hora (60 ticks de 60 s).
      if (billingTick % 60 === 1) {
        const report = await billing.reconciliationReport();
        if (report.length) logger.warn({ divergences: report.slice(0, 50), total: report.length }, 'Divergências de cobrança encontradas');
      }
    })().catch(err => logger.error({ err }, 'Falha na rotina de cobrança'));
  }, Number(process.env.BILLING_MAINTENANCE_INTERVAL_MS) || 60_000);
  billingInterval.unref();

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
    res.end(JSON.stringify({ ready, service: 'worker', queue: queueNames.turns }));
  }).listen(3002, '0.0.0.0');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      logger.info('Encerrando worker: aguardando trabalhos ativos...');
      clearInterval(dispatchInterval);
      clearInterval(billingInterval);
      await traceBatchWriter.stop();
      await Promise.all([maintenanceWorker.close(), turnBuffer.close(), eventPublisher.close(), debugRegistry.close(), traceSink.close(), traceWriterRedis.quit(), leadClassificationQueue?.close(), leadClassificationWorker?.close()]);
      health.close(() => process.exit(0));
    });
  }
}
