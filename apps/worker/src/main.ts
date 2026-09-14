import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { queueNames } from '@sdr/shared';
import { runtimeConfigFromEnv } from '@sdr/flow/server';
import { serviceDatabase } from '@sdr/db';
import {
  RedisTurnBuffer,
  processTurn,
  dispatchPendingInboundEvents,
  RedisExecutionEventPublisher,
  RedisDebugRegistry,
  RedisTraceSink,
  TraceBatchWriter,
  IORedisStreamCommands,
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
        { db, runtimeConfig, eventPublisher, debugRegistry, traceSink },
        {
          organizationId: turn.job.organizationId,
          connectionId: turn.job.connectionId,
          flowVersionId: turn.job.flowVersionId,
          flowId: turn.job.flowId,
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
      await traceBatchWriter.stop();
      await Promise.all([maintenanceWorker.close(), turnBuffer.close(), eventPublisher.close(), debugRegistry.close(), traceSink.close(), traceWriterRedis.quit()]);
      health.close(() => process.exit(0));
    });
  }
}
