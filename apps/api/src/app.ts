import crypto from 'node:crypto';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { z } from 'zod';
import {
  FlowRepository,
  ExecutionRepository,
  OrganizationRepository,
  ConnectionRepository,
  CalendarRepository,
  ConversationRepository,
  KnowledgeRepository,
  SummaryRepository,
  InboxRepository,
  MetricsRepository,
  userDatabase,
  serviceDatabase,
  setAgentOpenAIKey,
  agentHasOpenAIKey,
  type EvolutionCredentials,
  type MetaCredentials,
  type ConversationWithLead,
  type CalendarAccountEntity,
} from '@sdr/db';
import {
  saveFlowSchema,
  memberRoleSchema,
  orgTierSchema,
  type MemberRole,
  type FlowGraph,
  normalizeConversationStage,
  queueNames,
  type OrgTier,
  type Capability,
  getCapabilities,
} from '@sdr/shared';
import { catalog, validateGraph, replayFlow, runPlayground, GoogleCalendarClient, type GoogleCalendarCredentials } from '@sdr/flow';
import { parseEvolutionWebhook, parseMetaWebhook, processInboundWebhook } from './webhook.js';
import { ConnectionManager } from './whatsapp/connection-manager.js';
import { EvolutionClient } from './whatsapp/evolution-client.js';
import { requestLogger, logger } from './telemetry/logger.js';
import { SentryService } from './telemetry/sentry.js';
import { orgRateLimiter, publicRateLimiter } from './rate-limit.js';
import { AlertMonitor } from './alerts/alert-monitor.js';
import { OpenAIProvider, type RuntimeConfig } from '@sdr/flow/server';
import { secretMatches, verifyMetaSignature } from './whatsapp/webhook-auth.js';
import { wsServer } from './ws.js';
import {
  RedisTurnBuffer,
  RedisExecutionEventPublisher,
  RedisExecutionEventSubscriber,
  InMemoryExecutionEventBus,
  RedisDebugRegistry,
  InMemoryDebugRegistry,
  publishRealtimeEvent,
  type DebugRegistry,
  type ExecutionEventPublisher,
  type DebugFlowSnapshot,
  resolveTurnFlow,
  resolveFlowForConnection,
} from '@sdr/runtime';
import { authMiddleware, requireRole, requireCapability, requireOrgRole, uuidParam } from './auth.js';

export interface ApiConfig extends RuntimeConfig {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  publicApiUrl?: string;
  evolutionServerUrl?: string;
  evolutionApiKey?: string;
  redisUrl?: string;
  allowedOrigins?: string[];
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthRedirectUri?: string;
}

function resolveGoogleOAuthCredentials(config: ApiConfig) {
  let clientId = config.googleOAuthClientId || process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret = config.googleOAuthClientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  let redirectUri = config.googleOAuthRedirectUri || process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if ((!clientId || !clientSecret) && config.googleCalendarCredentialsJson) {
    try {
      const parsed = JSON.parse(config.googleCalendarCredentialsJson);
      if (!clientId && parsed.client_id) clientId = parsed.client_id;
      if (!clientSecret && parsed.client_secret) clientSecret = parsed.client_secret;
    } catch {
      // ignore JSON parse error
    }
  }

  if (!redirectUri) {
    const base = config.publicApiUrl || `http://localhost:${process.env.PORT || 3001}`;
    redirectUri = `${base.replace(/\/+$/, '')}/api/integrations/google/callback`;
  }

  return { clientId, clientSecret, redirectUri };
}

export function createApp(config: ApiConfig = {}): Express {
  const app = express();

  // Turn processing mode gate (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.5/8.9/8.10):
  // published-flow execution now belongs to apps/worker, consuming the canonical queue
  // (queueNames.turns) — this process must never instantiate a BullMQ Worker for it. 'api'
  // mode (inline, synchronous, no debounce) exists only for local dev without a separate
  // worker process and is refused outright in production.
  const isProduction = process.env.NODE_ENV === 'production';
  const requestedTurnMode = process.env.TURN_PROCESSING_MODE || (config.redisUrl ? 'worker' : 'api');
  if (requestedTurnMode !== 'api' && requestedTurnMode !== 'worker') {
    throw new Error(`TURN_PROCESSING_MODE inválido: "${requestedTurnMode}". Use "api" ou "worker".`);
  }
  if (isProduction && requestedTurnMode !== 'worker') {
    throw new Error('Em produção, TURN_PROCESSING_MODE deve ser "worker" — execução inline na API está desabilitada.');
  }
  if (requestedTurnMode === 'worker' && !config.redisUrl) {
    throw new Error('TURN_PROCESSING_MODE=worker requer REDIS_URL configurado.');
  }
  const turnProcessingMode = requestedTurnMode as 'api' | 'worker';

  // Producer-only handle on the canonical queue: enqueue() only, no handler/Worker attached.
  const turnBuffer = turnProcessingMode === 'worker' ? new RedisTurnBuffer(config.redisUrl!, queueNames.turns) : undefined;

  // Execution events (live step view, WebSocket) and the debug-session registry both need to
  // be shared state once flow execution can happen in a different process (the worker) than
  // the one serving HTTP/WebSocket (this API) — see 8.6. Falls back to in-memory, same-process
  // wiring when Redis isn't configured (dev/tests), never as a silent production substitute
  // (the mode gate above already refuses to boot that way).
  const inMemoryEventBus = config.redisUrl ? undefined : new InMemoryExecutionEventBus();
  const eventPublisher: ExecutionEventPublisher = config.redisUrl ? new RedisExecutionEventPublisher(config.redisUrl) : inMemoryEventBus!;
  const debugRegistry: DebugRegistry = config.redisUrl ? new RedisDebugRegistry(config.redisUrl) : new InMemoryDebugRegistry();
  // Fase 5 (11.1): fire-and-forget publish of inbox:*/system:* realtime events onto the same
  // bus as execution events — a publish failure must never fail the REST action that triggered
  // it (sending a message, taking over a conversation), same non-blocking contract as 8.6.
  const emitInboxEvent = async (input: Parameters<typeof publishRealtimeEvent>[1]) => {
    try {
      await publishRealtimeEvent(eventPublisher, input);
    } catch (err) {
      logger.warn({ err }, 'Falha ao publicar evento de tempo real do inbox (não bloqueante)');
    }
  };
  // Payload carries exactly the fields InboxPage's reducer needs to patch its local state
  // without a REST re-fetch per event (11.1: "payload mínimo e validado").
  const conversationUpdatedEvent = (organizationId: string, conv: ConversationWithLead): Parameters<typeof publishRealtimeEvent>[1] => ({
    type: 'inbox:conversation.updated',
    organizationId,
    connectionId: conv.connection_id,
    conversationId: conv.id,
    payload: {
      id: conv.id,
      stage: conv.stage,
      bot_paused: conv.bot_paused,
      handled_by: conv.handled_by,
      assigned_user_id: conv.assigned_user_id,
      last_message_at: conv.last_message_at,
    },
  });
  const messageCreatedEvent = (
    organizationId: string,
    message: { id: string; conversation_id: string; connection_id: string; sender: string; direction: string; content: string; created_at: string; sender_name?: string | null; sender_jid?: string | null }
  ): Parameters<typeof publishRealtimeEvent>[1] => ({
    type: 'inbox:message.created',
    organizationId,
    connectionId: message.connection_id,
    conversationId: message.conversation_id,
    payload: {
      id: message.id,
      conversationId: message.conversation_id,
      sender: message.sender,
      direction: message.direction,
      content: message.content,
      created_at: message.created_at,
      sender_name: message.sender_name ?? null,
      sender_jid: message.sender_jid ?? null,
    },
  });
  let closeEventSubscriber: (() => Promise<void>) | undefined;
  if (config.redisUrl) {
    const subscriber = new RedisExecutionEventSubscriber(config.redisUrl);
    void subscriber.subscribe(event => wsServer.broadcast(event));
    closeEventSubscriber = () => subscriber.close();
  } else {
    void inMemoryEventBus!.subscribe(event => wsServer.broadcast(event));
  }

  app.locals.closeRuntime = async () => {
    await Promise.all([
      turnBuffer?.close(),
      eventPublisher.close(),
      debugRegistry instanceof RedisDebugRegistry ? debugRegistry.close() : Promise.resolve(),
      closeEventSubscriber?.(),
    ]);
  };
  app.disable('x-powered-by');
  app.use((req,res,next)=>{const origin=req.get('origin');if(origin&&config.allowedOrigins?.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Webhook-Secret, X-Hub-Signature-256');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');}if(req.method==='OPTIONS'){res.sendStatus(origin&&config.allowedOrigins?.includes(origin)?204:403);return;}next();});
  app.use(express.json({ limit: '1mb', verify: (req, _res, body) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(body); } }));
  app.use(requestLogger);
  app.get('/api/health', async (_req, res) => {
    const memory = process.memoryUsage();
    const supabaseConfigured = Boolean(config.supabaseUrl && config.serviceRoleKey);
    let supabaseConnected = false;
    let orgCount = 0;
    let connectionCount = 0;
    if (supabaseConfigured) {
      try {
        const db = serviceDatabase(config.supabaseUrl!, config.serviceRoleKey!);
        const { count: oc } = await db.from('organizations').select('id', { count: 'exact', head: true });
        orgCount = oc || 0;
        const { count: cc } = await db.from('connections').select('id', { count: 'exact', head: true });
        connectionCount = cc || 0;
        supabaseConnected = true;
      } catch {}
    }
    res.json({
      status: 'ok',
      service: 'api',
      persistenceConfigured: supabaseConfigured,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      supabase: { configured: supabaseConfigured, connected: supabaseConnected, organizations: orgCount, connections: connectionCount },
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      },
    });
  });
  const protectedApi = authMiddleware(config);
  app.use('/api/me', protectedApi);
  app.use('/api/admin', protectedApi);

  app.get('/api/me', (req, res) => {
    const auth = res.locals.auth;
    if (!auth) { res.status(401).json({ error: 'Autenticação obrigatória.' }); return; }
    res.json({
      userId: auth.userId,
      email: auth.email,
      role: auth.appRole,
      platformRole: auth.platformRole,
      status: auth.profileStatus,
      organizationId: auth.organizationId,
      memberRole: auth.memberRole,
      orgTier: auth.orgTier,
      capabilities: Array.from(auth.capabilities),
    });
  });

  app.get('/api/me/instances', async (_req, res) => {
    const auth = res.locals.auth!;
    const { data, error } = await auth.db.from('connections').select('id,name,provider,status,phone,agent_id,created_at').eq('organization_id', auth.organizationId).order('created_at');
    if (error) throw error; res.json(data ?? []);
  });
  app.get('/api/me/agents', async (_req, res) => {
    const auth = res.locals.auth!;
    const [{ data, error }, { data: limits }] = await Promise.all([
      auth.db.from('ai_agents').select('id,name,description,status,provider,model,system_prompt,tool_policy,model_config,is_default,created_at,updated_at').eq('organization_id', auth.organizationId).neq('status','archived').order('created_at'),
      auth.db.from('account_limits').select('max_agents,max_instances').eq('organization_id', auth.organizationId).maybeSingle(),
    ]);
    if (error) throw error;
    const serviceDb = getServiceDb();
    const agents = serviceDb
      ? await Promise.all((data ?? []).map(async agent => ({ ...agent, hasOpenaiKey: await agentHasOpenAIKey(serviceDb, agent.id) })))
      : (data ?? []).map(agent => ({ ...agent, hasOpenaiKey: false }));
    res.json({ agents, limits: limits ?? { max_agents: 2, max_instances: null }, used: data?.length ?? 0 });
  });
  app.post('/api/me/agents', async (req, res) => {
    const auth = res.locals.auth!;
    const body = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(), provider: z.string().trim().min(1).max(40), model: z.string().trim().min(1).max(120), systemPrompt: z.string().max(20000), toolPolicy: z.record(z.string(), z.unknown()).optional(), modelConfig: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Dados do agente inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('create_agent_for_current_user', { p_name: body.data.name, p_description: body.data.description ?? null, p_provider: body.data.provider, p_model: body.data.model, p_system_prompt: body.data.systemPrompt, p_tool_policy: body.data.toolPolicy ?? {}, p_model_config: body.data.modelConfig ?? {} });
    if (error) { res.status(error.code === 'P0001' ? 409 : 400).json({ error: error.code === 'P0001' ? 'Limite de agentes atingido.' : 'Não foi possível criar o agente.' }); return; }
    res.status(201).json(data);
  });
  app.get('/api/me/agents/:agentId', async (req, res) => {
    const auth = res.locals.auth!; const agentId = uuidParam.safeParse(req.params.agentId);
    if (!agentId.success) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    const { data, error } = await auth.db.from('ai_agents').select('*').eq('organization_id', auth.organizationId).eq('id', agentId.data).neq('status', 'archived').maybeSingle();
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    const serviceDb = getServiceDb();
    const hasOpenaiKey = serviceDb ? await agentHasOpenAIKey(serviceDb, data.id) : false;
    res.json({ ...data, hasOpenaiKey });
  });
  app.post('/api/me/agents/:agentId/openai-key', async (req, res) => {
    const auth = res.locals.auth!; const agentId = uuidParam.safeParse(req.params.agentId);
    const body = z.object({ apiKey: z.string().trim().min(1).max(400) }).strict().safeParse(req.body);
    if (!agentId.success || !body.success) { res.status(400).json({ error: 'Dados inválidos.' }); return; }
    const { data: agent, error: agentError } = await auth.db.from('ai_agents').select('id,owner_user_id').eq('organization_id', auth.organizationId).eq('id', agentId.data).neq('status', 'archived').maybeSingle();
    if (agentError || !agent) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    const serviceDb = getServiceDb();
    if (!serviceDb) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    try {
      await setAgentOpenAIKey(serviceDb, auth.organizationId, (agent as any).owner_user_id || auth.userId, agentId.data, body.data.apiKey);
    } catch {
      res.status(500).json({ error: 'Não foi possível salvar a chave da OpenAI.' });
      return;
    }
    res.status(204).end();
  });
  app.patch('/api/me/agents/:agentId', async (req, res) => {
    const auth = res.locals.auth!; const agentId = uuidParam.safeParse(req.params.agentId);
    const body = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).nullable().optional(), provider: z.string().trim().min(1).max(40), model: z.string().trim().min(1).max(120), systemPrompt: z.string().max(20000), toolPolicy: z.record(z.string(), z.unknown()).optional(), modelConfig: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(req.body);
    if (!agentId.success || !body.success) { res.status(400).json({ error: 'Dados do agente inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('update_agent_for_current_user', { p_agent: agentId.data, p_name: body.data.name, p_description: body.data.description ?? null, p_provider: body.data.provider, p_model: body.data.model, p_system_prompt: body.data.systemPrompt, p_tool_policy: body.data.toolPolicy ?? {}, p_model_config: body.data.modelConfig ?? {} });
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json(data);
  });
  app.delete('/api/me/agents/:agentId', async (req, res) => {
    const auth = res.locals.auth!; const agentId = uuidParam.safeParse(req.params.agentId);
    if (!agentId.success) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    const { data, error } = await (auth.db as any).rpc('archive_agent_for_current_user', { p_agent: agentId.data });
    if (error?.code === '23503') { res.status(409).json({ error: 'Desassocie o agente das instâncias antes de arquivá-lo.' }); return; }
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.status(204).end();
  });
  app.post('/api/me/instances/:connectionId/assign-agent', async (req, res) => {
    const auth = res.locals.auth!; const connectionId = uuidParam.safeParse(req.params.connectionId);
    const body = z.object({ agentId: z.string().uuid() }).strict().safeParse(req.body);
    if (!connectionId.success || !body.success) { res.status(400).json({ error: 'Dados inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('assign_agent_to_connection', { p_connection: connectionId.data, p_agent: body.data.agentId });
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json(data);
  });

  app.get('/api/admin/users', requireRole('admin'), async (_req, res) => {
    const auth = res.locals.auth!;
    const { data, error } = await (auth.db as any).rpc('admin_list_accounts');
    if (error) throw error; res.json(data ?? []);
  });
  app.post('/api/admin/users/invite', requireRole('admin'), async (req, res) => {
    const body = z.object({ email: z.string().email().max(320), displayName: z.string().trim().min(1).max(120).optional() }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Convite inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Serviço de autenticação não configurado.' }); return; }
    const adminDb = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const redirectTo = config.publicApiUrl ? new URL('/auth/callback', config.publicApiUrl).toString() : undefined;
    const { data, error } = await adminDb.auth.admin.inviteUserByEmail(body.data.email, { redirectTo, data: { display_name: body.data.displayName } });
    if (error) { res.status(error.status === 422 ? 409 : 400).json({ error: 'Não foi possível enviar o convite.' }); return; }
    res.status(201).json({ userId: data.user.id, email: data.user.email });
  });
  app.get('/api/admin/users/:userId', requireRole('admin'), async (req, res) => {
    const auth = res.locals.auth!; const userId = uuidParam.safeParse(req.params.userId);
    if (!userId.success) { res.status(400).json({ error: 'Identificador inválido.' }); return; }
    const { data, error } = await (auth.db as any).rpc('admin_list_accounts');
    const account = !error && Array.isArray(data) ? data.find((item: any) => item.user_id === userId.data) : null;
    if (!account) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json(account);
  });
  app.patch('/api/admin/users/:userId/status', requireRole('admin'), async (req, res) => {
    const auth = res.locals.auth!; const userId = uuidParam.safeParse(req.params.userId);
    const body = z.object({ status: z.enum(['active', 'suspended']) }).strict().safeParse(req.body);
    if (!userId.success || !body.success) { res.status(400).json({ error: 'Dados inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('admin_update_account_status', { p_user: userId.data, p_status: body.data.status });
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json(data);
  });
  app.patch('/api/admin/users/:userId/limits', requireRole('admin'), async (req, res) => {
    const auth = res.locals.auth!; const userId = uuidParam.safeParse(req.params.userId);
    const body = z.object({ maxAgents: z.number().int().min(1).max(20), maxInstances: z.number().int().min(0).nullable() }).strict().safeParse(req.body);
    if (!userId.success || !body.success) { res.status(400).json({ error: 'Dados inválidos.' }); return; }
    const { data, error } = await (auth.db as any).rpc('admin_update_account_limits', { p_user: userId.data, p_max_agents: body.data.maxAgents, p_max_instances: body.data.maxInstances });
    if (error || !data) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    res.json(data);
  });
  app.post('/api/admin/organizations/:organizationId/logins', requireRole('admin'), async (req, res) => {
    const organizationId = uuidParam.safeParse(req.params.organizationId);
    const body = z.object({
      displayName: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(320),
      password: z.string().min(8).max(72),
      accountRole: z.enum(['admin', 'client']).default('client'),
      memberRole: memberRoleSchema.default('viewer'),
      orgTier: orgTierSchema,
    }).strict().safeParse(req.body);

    if (!organizationId.success || !body.success) {
      res.status(400).json({ error: 'Dados do novo login inválidos.' });
      return;
    }
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      res.status(503).json({ error: 'Serviço de autenticação não configurado.' });
      return;
    }

    const auth = res.locals.auth!;
    const adminDb = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const { data, error } = await adminDb.auth.admin.createUser({
      email: body.data.email.toLowerCase(),
      password: body.data.password,
      email_confirm: true,
      user_metadata: { display_name: body.data.displayName },
      app_metadata: {
        sdr_target_organization_id: organizationId.data,
        sdr_member_role: body.data.memberRole,
        sdr_app_role: body.data.accountRole,
        sdr_org_tier: body.data.orgTier,
        sdr_provisioned_by: auth.userId,
      },
    });

    if (error || !data.user) {
      const duplicate = error?.status === 422 || error?.code === 'email_exists' || error?.code === 'user_already_exists';
      res.status(duplicate ? 409 : 400).json({
        error: duplicate ? 'Já existe um login com este e-mail.' : 'Não foi possível criar o login.',
      });
      return;
    }

    res.status(201).json({
      userId: data.user.id,
      email: data.user.email,
      displayName: body.data.displayName,
      accountRole: body.data.accountRole,
      memberRole: body.data.memberRole,
      organizationId: organizationId.data,
      orgTier: body.data.orgTier,
    });
  });
  app.get('/api/debug/inbox-test', async (_req, res) => {
    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      res.json({ error: 'Supabase não configurado', steps });
      return;
    }
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);

    // 1. Read orgs
    const { data: orgs, error: orgReadErr } = await db.from('organizations').select('id, name');
    steps.push({ step: 'read_orgs', ok: !orgReadErr, detail: orgReadErr || { count: orgs?.length, orgs } });

    // 2. Create org if needed
    let orgId = orgs?.[0]?.id;
    if (!orgId) {
      const { data: newOrg, error: orgErr } = await db.from('organizations').insert({ name: 'SDR Flow Test' }).select('id').single();
      steps.push({ step: 'create_org', ok: !orgErr, detail: orgErr || newOrg });
      orgId = newOrg?.id;
    } else {
      steps.push({ step: 'create_org', ok: true, detail: 'already exists: ' + orgId });
    }

    if (!orgId) { res.json({ error: 'Falha ao obter org', steps }); return; }

    // 3. Create connection
    const { data: conn, error: connErr } = await db.from('connections').insert({
      organization_id: orgId, name: 'debug-test', provider: 'evolution', status: 'connected', provider_instance_id: 'debug-test',
    } as any).select().single();
    steps.push({ step: 'create_connection', ok: !connErr, detail: connErr || { id: conn?.id } });

    // 4. Create lead
    const convRepo = new ConversationRepository(db);
    try {
      const lead = await convRepo.findOrCreateLead(orgId, conn!.id, '5500000000000', 'Debug Test');
      steps.push({ step: 'create_lead', ok: true, detail: { id: lead.id } });

      // 5. Create conversation
      if (conn) {
        const conversation = await convRepo.findOrCreateConversation(orgId, conn.id, lead.id);
        steps.push({ step: 'create_conversation', ok: true, detail: { id: conversation.id } });

        // 6. Save message
        const msg = await convRepo.saveMessage({
          organizationId: orgId, connectionId: conn.id, conversationId: conversation.id,
          direction: 'INBOUND', sender: 'lead', content: 'Mensagem de teste do debug endpoint', messageType: 'text',
        });
        steps.push({ step: 'save_message', ok: true, detail: { id: msg.id } });
      }
    } catch (e: any) {
      steps.push({ step: 'db_operation', ok: false, detail: e?.message || String(e) });
    }

    // Cleanup in FK order: messages → conversations → leads → connections
    if (conn) {
      await db.from('messages').delete().eq('connection_id', conn.id);
      await db.from('conversations').delete().eq('connection_id', conn.id);
      await db.from('connections').delete().eq('id', conn.id);
    }
    await db.from('leads').delete().eq('phone', '5500000000000').eq('organization_id', orgId);

    res.json({ success: steps.every(s => s.ok), steps });
  });

  app.get('/api/catalog', (_req,res) => res.json(Object.values(catalog).map(({ schema: _schema, ...node }) => node)));
  app.post('/api/flows/validate', (req,res) => {
    const input = req.body && typeof req.body === 'object' && 'graph' in req.body ? req.body.graph : req.body;
    const result = validateGraph(input);
    res.status(result.valid ? 200 : 422).json(result);
  });

  // Google OAuth 2.0 Global Callback
  app.get('/api/integrations/google/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const errorParam = typeof req.query.error === 'string' ? req.query.error : null;

    if (errorParam) {
      logger.warn({ error: errorParam }, 'Google OAuth consent denied or error');
      res.redirect(`/integrations?error=${encodeURIComponent(errorParam)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).send('Parâmetros inválidos no retorno do Google OAuth (code ou state ausentes).');
      return;
    }

    if (!config.supabaseUrl || !config.serviceRoleKey) {
      res.status(503).send('Supabase não configurado no servidor.');
      return;
    }

    const adminDb = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const repo = new CalendarRepository(adminDb);

    const oauthState = await repo.verifyAndConsumeOAuthState(state, adminDb);
    if (!oauthState) {
      res.status(400).send('Estado OAuth inválido ou expirado. Por favor, tente novamente a partir da tela de integrações.');
      return;
    }

    const { clientId, clientSecret, redirectUri } = resolveGoogleOAuthCredentials(config);
    if (!clientId || !clientSecret) {
      res.status(500).send('Credenciais Google OAuth do aplicativo não configuradas no servidor.');
      return;
    }

    try {
      const tokenRes = await globalThis.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        const errMsg = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
        logger.error({ error: errMsg }, 'Falha na troca de código por token no Google OAuth');
        res.redirect(`/integrations?error=${encodeURIComponent(errMsg)}`);
        return;
      }

      let accountEmail = '';
      let accountName = '';
      try {
        const userInfoRes = await globalThis.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userInfoRes.ok) {
          const userInfo = (await userInfoRes.json()) as { email?: string; name?: string };
          accountEmail = userInfo.email || '';
          accountName = userInfo.name || '';
        }
      } catch {
        // userinfo endpoint may fail or be unavailable
      }

      if (!accountEmail) {
        try {
          const calClient = new GoogleCalendarClient(globalThis.fetch, {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
          });
          accountEmail = await calClient.getCalendarName('primary');
        } catch {
          accountEmail = 'google-calendar';
        }
      }

      const credentialsPayload: Record<string, unknown> = {
        client_id: clientId,
        client_secret: clientSecret,
        access_token: tokenData.access_token,
      };
      if (tokenData.refresh_token) {
        credentialsPayload.refresh_token = tokenData.refresh_token;
      }

      await repo.saveAccount(
        oauthState.organization_id,
        oauthState.user_id,
        {
          email: accountEmail,
          name: accountName || accountEmail,
          status: 'connected',
          credentials: credentialsPayload,
        },
        adminDb,
      );

      const redirectTarget = oauthState.redirect_url || '/integrations?google=connected';
      res.redirect(redirectTarget);
    } catch (err) {
      logger.error({ err }, 'Erro ao processar callback Google OAuth');
      res.redirect(`/integrations?error=${encodeURIComponent((err as Error).message)}`);
    }
  });


  // Keep the pure validation endpoint above, but retire every stateful legacy
  // surface before it reaches any application handler. Canonical requests are
  // always scoped below `/api/organizations/:organizationId` and do not match
  // these exact prefixes.
  const retiredLegacyPrefixes = [
    '/api/flows',
    '/api/integrations',
    '/api/connections/instances',
    '/api/connections/evolution',
    '/api/knowledge',
    '/api/inbox',
    '/api/settings',
    '/api/webhooks/evolution/instance',
  ] as const;
  app.use((req, res, next) => {
    if (retiredLegacyPrefixes.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      res.status(410).json({
        error: 'Esta API legada foi desativada. Use os endpoints autenticados da organização.',
      });
      return;
    }
    next();
  });

  // Webhooks
  async function webhookCredentials(id: string, provider: 'evolution' | 'meta') {
    if (!config.supabaseUrl || !config.serviceRoleKey) return null;
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const { data } = await db.from('connections').select('id').eq('id', id).eq('provider', provider).maybeSingle();
    return data ? new ConnectionRepository(db).getConnectionCredentials(id) : null;
  }

  // Response codes per docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 7.4.5: 503 only when the event
  // itself could not be persisted (Postgres unavailable); 202 once a new event is durably
  // accepted and queued/executed; 200 for an idempotent duplicate; 500 for a downstream
  // business-logic failure (the event was still persisted successfully).
  function webhookStatusCode(result: Record<string, unknown>): number {
    if (result.status === 'error' && result.reason === 'event_not_persisted') return 503;
    if (result.status === 'error' || result.flowStatus === 'failed') return 500;
    if (result.status === 'queued' || result.status === 'executed') return 202;
    return 200;
  }

  async function handleEvolutionWebhook(connectionId: string, req: express.Request, res: express.Response) {
    const event = parseEvolutionWebhook(req.body);
    if (!event) { res.status(400).json({ error: 'Payload de webhook inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Supabase não configurado para webhooks.' }); return; }
    const credentials = await webhookCredentials(connectionId, 'evolution') as EvolutionCredentials | null;
    if (!secretMatches(req.get('x-webhook-token'), credentials?.webhookToken)) { res.sendStatus(401); return; }
    const result = await processInboundWebhook(connectionId, event, config, {
      provider: 'evolution',
      turnBuffer,
      inlineFallback: turnProcessingMode === 'api',
      eventPublisher,
      debugRegistry,
    });
    res.status(webhookStatusCode(result)).json({ ok: webhookStatusCode(result) < 400, result });
  }
  app.get('/api/webhooks/meta/:connectionId', async (req, res) => {
    const id = z.uuid().safeParse(req.params.connectionId);
    if (!id.success) { res.sendStatus(400); return; }
    const credentials = await webhookCredentials(id.data, 'meta') as MetaCredentials | null;
    if (req.query['hub.mode'] !== 'subscribe' || !secretMatches(String(req.query['hub.verify_token'] || ''), credentials?.verifyToken)) { res.sendStatus(403); return; }
    res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  });
  app.post('/api/webhooks/evolution/:connectionId', async (req, res) => {
    const connectionId = z.uuid().safeParse(req.params.connectionId);
    if (!connectionId.success) { res.status(400).json({ error: 'ID de conexão inválido.' }); return; }
    await handleEvolutionWebhook(connectionId.data, req, res);
  });

  app.post('/api/webhooks/meta/:connectionId', async (req, res) => {
    const connectionId = z.uuid().safeParse(req.params.connectionId);
    if (!connectionId.success) { res.status(400).json({ error: 'ID de conexão inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Supabase não configurado para webhooks.' }); return; }
    const credentials = await webhookCredentials(connectionId.data, 'meta') as MetaCredentials | null;
    if (!verifyMetaSignature((req as typeof req & { rawBody?: Buffer }).rawBody || Buffer.alloc(0), req.get('x-hub-signature-256'), credentials?.appSecret)) { res.sendStatus(401); return; }
    const event = parseMetaWebhook(req.body);
    if (!event) { res.status(200).json({ ok: true, result: { status: 'ignored', reason: 'non_message_event' } }); return; }
    const result = await processInboundWebhook(connectionId.data, event, config, {
      provider: 'meta',
      turnBuffer,
      inlineFallback: turnProcessingMode === 'api',
      eventPublisher,
      debugRegistry,
    });
    res.status(webhookStatusCode(result)).json({ ok: webhookStatusCode(result) < 400, result });
  });

  // Accept invitation (authenticated user joins organization using token)
  app.post('/api/invitations/accept', async (req, res) => {
    if (!config.supabaseUrl || !config.anonKey) {
      res.status(503).json({ error: 'Configure o Supabase para aceitar convites.' });
      return;
    }
    const match = /^Bearer (\S+)$/i.exec(req.get('authorization') ?? '');
    if (!match?.[1]) {
      res.status(401).json({ error: 'Autenticação obrigatória para aceitar convite.' });
      return;
    }
    const body = z.object({ token: z.string().min(32) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Token de convite inválido.' });
      return;
    }
    const db = userDatabase(config.supabaseUrl, config.anonKey, match[1]);
    const { data: { user }, error } = await db.auth.getUser(match[1]);
    if (error || !user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
    const orgRepo = new OrganizationRepository(db);
    try {
      const result = await orgRepo.acceptInvitation(body.data.token);
      res.status(200).json({ ok: true, organizationId: result.organizationId });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Convite inválido ou expirado.' });
    }
  });

  // The inbox debugger must mirror the exact immutable version that an inbound
  // turn would execute. Keeping a second "most recently updated flow" query here
  // made its preview disagree with production whenever an agent pinned a version.
  const resolveConversationDebugFlow = async (
    db: any,
    organizationId: string,
    conversation: { connection_id: string },
  ): Promise<DebugFlowSnapshot | null> => {
    const resolution = await resolveTurnFlow(db, conversation.connection_id);
    if (resolution.status !== 'resolved' || resolution.organizationId !== organizationId) return null;

    const graph = resolution.graph;
    return {
      id: resolution.flowId,
      name: resolution.flowName,
      version: `v${resolution.flowVersion}`,
      nodes: graph.nodes.map(node => ({ id: node.id, type: node.type, label: node.label || node.type })),
      graph,
    };
  };

  const armConversationDebug = async (
    db: any,
    inboxRepo: InboxRepository,
    organizationId: string,
    conversationId: string,
  ) => {
    const conversation = await inboxRepo.getConversation(organizationId, conversationId);
    if (!conversation) return { status: 404, body: { error: 'Conversa não encontrada.' } };
    if (conversation.bot_paused || conversation.handled_by === 'HUMAN') {
      return { status: 409, body: { error: 'A IA está pausada nesta conversa. Devolva a conversa para a IA antes de iniciar o debug.' } };
    }
    const flow = await resolveConversationDebugFlow(db, organizationId, conversation);
    if (!flow) {
      return { status: 409, body: { error: 'Nenhum fluxo publicado está ativo para a conexão desta conversa.' } };
    }
    const session = await debugRegistry.arm({
      organizationId,
      conversationId,
      connectionId: conversation.connection_id,
      flow,
    });
    return { status: 201, body: { session } };
  };

  const orgRoutes = express.Router({ mergeParams: true });
  app.use('/api/organizations/:organizationId', orgRoutes);
  orgRoutes.use(async (req, res, next) => {
    if (!config.supabaseUrl || !config.anonKey) {
      res.status(503).json({ error: 'Configure o Supabase para salvar e publicar fluxos.' });
      return;
    }
    const organizationId = z.uuid().safeParse((req.params as Record<string, string>).organizationId);
    if (!organizationId.success) {
      res.status(400).json({ error: 'Organização inválida.' });
      return;
    }

    const apiKeyHeader = req.get('x-api-key') || '';
    const authHeader = req.get('authorization') ?? '';
    const bearerMatch = /^Bearer (\S+)$/i.exec(authHeader);
    const token = apiKeyHeader || (bearerMatch?.[1] ?? '');

    if (!token) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }

    if (token.startsWith('sdr_live_')) {
      const adminDb = serviceDatabase(config.supabaseUrl, config.serviceRoleKey || config.anonKey);
      const orgRepo = new OrganizationRepository(adminDb);
      const verification = await orgRepo.verifyApiKey(token);
      if (!verification.valid) {
        res.status(401).json({ error: verification.error || 'Chave de API inválida.' });
        return;
      }
      if (verification.organizationId !== organizationId.data) {
        res.status(403).json({ error: 'Sem acesso a esta organização.' });
        return;
      }
      const { data: orgData } = await adminDb
        .from('organizations')
        .select('tier')
        .eq('id', organizationId.data)
        .maybeSingle();
      const orgTier = ((orgData as any)?.tier as OrgTier) || 'pre-venda';
      res.locals.organizationId = organizationId.data;
      res.locals.userId = `api_key:${verification.keyId}`;
      res.locals.role = verification.role;
      res.locals.orgTier = orgTier;
      res.locals.capabilities = new Set<Capability>(getCapabilities(orgTier, verification.role as MemberRole));
      res.locals.scopes = verification.scopes || [];
      res.locals.authType = 'api_key';
      res.locals.db = adminDb;
      res.locals.serviceDb = adminDb;
      res.locals.flows = new FlowRepository(adminDb, organizationId.data);
      res.locals.executions = new ExecutionRepository(adminDb);
      res.locals.orgs = orgRepo;
      res.locals.connections = new ConnectionRepository(adminDb);
      res.locals.calendar = new CalendarRepository(adminDb);
      res.locals.knowledge = new KnowledgeRepository(adminDb);
      res.locals.summaries = new SummaryRepository(adminDb);
      res.locals.inbox = new InboxRepository(adminDb);
      res.locals.metrics = new MetricsRepository(adminDb);
      next();
      return;
    }

    const db = userDatabase(config.supabaseUrl, config.anonKey, token);
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
    const membership = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId.data)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) {
      res.status(403).json({ error: 'Sem acesso a esta organização.' });
      return;
    }
    let orgTier: OrgTier = 'pre-venda';
    try {
      const { data: orgData } = await db
        .from('organizations')
        .select('tier')
        .eq('id', organizationId.data)
        .maybeSingle();
      if ((orgData as any)?.tier) {
        orgTier = (orgData as any).tier;
      }
    } catch {
      // fallback to pre-venda
    }
    res.locals.organizationId = organizationId.data;
    res.locals.userId = user.id;
    res.locals.role = membership.data.role;
    res.locals.orgTier = orgTier;
    res.locals.capabilities = new Set<Capability>(getCapabilities(orgTier, membership.data.role as MemberRole));
    res.locals.scopes = ['*'];
    res.locals.authType = 'jwt';
    res.locals.db = db;
    res.locals.flows = new FlowRepository(db, organizationId.data);
    res.locals.executions = new ExecutionRepository(db);
    res.locals.orgs = new OrganizationRepository(db);
    res.locals.connections = new ConnectionRepository(db);
    res.locals.calendar = new CalendarRepository(db);
    res.locals.knowledge = new KnowledgeRepository(db);
    res.locals.summaries = new SummaryRepository(db);
    res.locals.inbox = new InboxRepository(db);
    res.locals.metrics = new MetricsRepository(db);
    next();
  });

  orgRoutes.use(orgRateLimiter.middleware());

  const requireOrgCapability = (cap: Capability) => (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const caps = res.locals.capabilities as Set<Capability> | undefined;
    if (caps && !caps.has(cap)) {
      res.status(403).json({
        error: `Acesso não permitido pelo seu plano (${res.locals.orgTier}) ou perfil (${res.locals.role}).`,
        requiredCapability: cap,
      });
      return;
    }
    next();
  };

  const checkScope = (scope: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.locals.authType === 'api_key') {
      const scopes = res.locals.scopes as string[];
      const [category] = scope.split(':');
      if (!scopes.includes('*') && !scopes.includes(scope) && !scopes.includes(`${category}:*`)) {
        res.status(403).json({ error: `Permissão insuficiente. Escopo necessário: ${scope}` });
        return;
      }
    }
    next();
  };

  const requireAdmin = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = res.locals.role as string;
    const isApiKeyAdmin = res.locals.authType === 'api_key' && (res.locals.scopes as string[]).includes('admin');
    if (!['owner', 'admin'].includes(role) && !isApiKeyAdmin) {
      res.status(403).json({ error: 'Somente donos e administradores têm permissão.' });
      return;
    }
    next();
  };

  // Team & Organization Management
  orgRoutes.get('/members', async (_req, res) => {
    const members = await (res.locals.orgs as OrganizationRepository).listMembers(res.locals.organizationId as string);
    res.json(members);
  });

  orgRoutes.patch('/members/:userId', requireAdmin, async (req, res) => {
    const userId = z.uuid().parse(req.params.userId);
    const body = z.object({ role: memberRoleSchema }).parse(req.body);
    const updated = await (res.locals.orgs as OrganizationRepository).updateMemberRole(
      res.locals.organizationId as string,
      userId,
      body.role
    );
    res.json(updated);
  });

  orgRoutes.delete('/members/:userId', requireAdmin, async (req, res) => {
    const userId = z.uuid().parse(req.params.userId);
    const result = await (res.locals.orgs as OrganizationRepository).removeMember(
      res.locals.organizationId as string,
      userId
    );
    res.json(result);
  });

  // Invitations
  orgRoutes.get('/invitations', requireAdmin, async (_req, res) => {
    const list = await (res.locals.orgs as OrganizationRepository).listInvitations(res.locals.organizationId as string);
    res.json(list);
  });

  orgRoutes.post('/invitations', requireAdmin, async (req, res) => {
    const body = z.object({
      email: z.string().email(),
      role: memberRoleSchema.default('viewer'),
    }).parse(req.body);
    const invitation = await (res.locals.orgs as OrganizationRepository).createInvitation(
      res.locals.organizationId as string,
      body.email,
      body.role
    );
    res.status(201).json(invitation);
  });

  orgRoutes.delete('/invitations/:invitationId', requireAdmin, async (req, res) => {
    const invitationId = z.uuid().parse(req.params.invitationId);
    const result = await (res.locals.orgs as OrganizationRepository).deleteInvitation(
      res.locals.organizationId as string,
      invitationId
    );
    res.json(result);
  });

  // API Keys
  orgRoutes.get('/api-keys', requireAdmin, async (_req, res) => {
    const list = await (res.locals.orgs as OrganizationRepository).listApiKeys(res.locals.organizationId as string);
    res.json(list);
  });

  orgRoutes.post('/api-keys', requireAdmin, async (req, res) => {
    const body = z.object({
      name: z.string().min(1).max(80),
      role: memberRoleSchema.default('viewer'),
      scopes: z.array(z.string()).default(['flows:read']),
      expiresAt: z.string().datetime().optional(),
    }).parse(req.body);
    const keyResult = await (res.locals.orgs as OrganizationRepository).createApiKey(
      res.locals.organizationId as string,
      body.name,
      body.role,
      body.scopes,
      body.expiresAt
    );
    res.status(201).json(keyResult);
  });

  orgRoutes.delete('/api-keys/:keyId', requireAdmin, async (req, res) => {
    const keyId = z.uuid().parse(req.params.keyId);
    const result = await (res.locals.orgs as OrganizationRepository).deleteApiKey(
      res.locals.organizationId as string,
      keyId
    );
    res.json(result);
  });

  const getServiceDb = () => (config.serviceRoleKey && config.supabaseUrl ? serviceDatabase(config.supabaseUrl, config.serviceRoleKey) : undefined);

  // WhatsApp Connections
  const createConnectionSchema = z.object({
    name: z.string().trim().min(1).max(100),
    provider: z.enum(['evolution', 'meta']),
    phone: z.string().trim().optional(),
    credentials: z.union([
      z.object({
        serverUrl: z.string().url(),
        apiKey: z.string().min(1),
        instanceName: z.string().optional(),
        webhookToken: z.string().min(16).optional(),
      }),
      z.object({
        phoneNumberId: z.string().min(1),
        wabaId: z.string().min(1),
        accessToken: z.string().min(1),
        appSecret: z.string().optional(),
        verifyToken: z.string().optional(),
      }),
    ]),
  });

  app.post('/api/admin/users/:userId/instances', requireRole('admin'), async (req, res) => {
    const userId = uuidParam.safeParse(req.params.userId); const body = createConnectionSchema.safeParse(req.body);
    if (!userId.success || !body.success) { res.status(400).json({ error: 'Dados da instância inválidos.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Persistência não configurada.' }); return; }
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const { data: profile } = await db.from('profiles').select('default_organization_id,status').eq('user_id', userId.data).maybeSingle();
    if (!profile?.default_organization_id || profile.status !== 'active') { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    const organizationId = profile.default_organization_id;
    const prepared = await ConnectionManager.prepareConnection(organizationId, body.data.name, body.data.provider, body.data.credentials as any, body.data.phone);
    const connection = await new ConnectionRepository(db).createConnection(organizationId, { name: body.data.name, provider: body.data.provider, phone: prepared.phone, provider_instance_id: prepared.providerInstanceId, status: prepared.status, credentials: prepared.preparedCredentials }, db);
    res.status(201).json({ id: connection.id, name: connection.name, provider: connection.provider, status: connection.status });
  });

  orgRoutes.get('/connections', checkScope('connections:read'), async (_req, res) => {
    const list = await (res.locals.connections as ConnectionRepository).listConnections(res.locals.organizationId as string);
    res.json(list);
  });

  orgRoutes.post('/connections', requireAdmin, checkScope('connections:write'), async (req, res) => {
    const body = createConnectionSchema.parse(req.body);
    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);

    const prepared = await ConnectionManager.prepareConnection(
      res.locals.organizationId as string,
      body.name,
      body.provider,
      body.credentials as any,
      body.phone
    );

    const connection = await connRepo.createConnection(
      res.locals.organizationId as string,
      {
        name: body.name,
        provider: body.provider,
        phone: prepared.phone,
        provider_instance_id: prepared.providerInstanceId,
        status: prepared.status,
        credentials: prepared.preparedCredentials,
      },
      serviceDb
    );

    if (body.provider === 'evolution') {
      const evo = prepared.preparedCredentials as EvolutionCredentials;
      const client = new EvolutionClient(evo.serverUrl, evo.apiKey);
      const baseUrl = config.publicApiUrl || `${req.protocol}://${req.get('host')}`;
      const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/evolution/${connection.id}`;
      try {
        await client.setWebhook(prepared.providerInstanceId, webhookUrl, evo.webhookToken);
      } catch {
        res.status(201).json({ ...connection, setupWarning: 'Conexão salva, mas o webhook não foi registrado. Verifique PUBLIC_API_URL e registre o callback na Evolution.' });
        return;
      }
    }

    res.status(201).json(connection);
  });

  orgRoutes.get('/connections/:connectionId', checkScope('connections:read'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const connRepo = res.locals.connections as ConnectionRepository;
    const connection = await connRepo.getConnection(res.locals.organizationId as string, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }
    res.json(connection);
  });

  // Cache para contatos e grupos da conexão (TTL: 30s)
  const targetsCache = new Map<string, { timestamp: number; data: unknown }>();

  orgRoutes.get('/connections/:connectionId/targets', checkScope('connections:read'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const organizationId = res.locals.organizationId as string;

    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const cached = targetsCache.get(connectionId);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < 30_000) {
      res.json(cached.data);
      return;
    }

    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);
    const connection = await connRepo.getConnection(organizationId, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }
    if (connection.provider !== 'evolution') {
      res.status(400).json({ error: 'Contatos e grupos só estão disponíveis para conexões Evolution API.' });
      return;
    }

    const credentials = await connRepo.getConnectionCredentials<EvolutionCredentials>(connectionId, serviceDb);
    const instanceName = connection.provider_instance_id || credentials?.instanceName || '';
    if (!credentials?.serverUrl || !credentials.apiKey || !instanceName) {
      res.status(409).json({ error: 'A conexão Evolution não possui credenciais ou instância configuradas.' });
      return;
    }

    const client = new EvolutionClient(credentials.serverUrl, credentials.apiKey);
    const [groups, chats] = await Promise.all([
      client.fetchGroups(instanceName).catch(err => {
        logger.warn({ err, connectionId }, 'Falha ao buscar grupos da Evolution');
        return [];
      }),
      client.fetchChats(instanceName).catch(err => {
        logger.warn({ err, connectionId }, 'Falha ao buscar contatos da Evolution');
        return [];
      }),
    ]);

    const groupMap = new Map<string, { id: string; jid: string; name: string; type: 'group'; size?: number }>();
    for (const group of groups) {
      if (!group.id) continue;
      groupMap.set(group.id, {
        id: group.id,
        jid: group.id,
        name: group.subject || group.id,
        type: 'group',
        size: group.size,
      });
    }
    for (const chat of chats) {
      const jid = chat.id || '';
      if ((jid.endsWith('@g.us') || jid.includes('@g.us')) && !groupMap.has(jid)) {
        groupMap.set(jid, {
          id: jid,
          jid,
          name: chat.name || chat.pushName || jid,
          type: 'group',
        });
      }
    }

    const result = {
      connectionId,
      groups: Array.from(groupMap.values()),
      contacts: chats
        .filter(chat => !chat.id.endsWith('@g.us') && !chat.id.includes('@g.us'))
        .map(chat => {
          const id = chat.id.replace(/@.*$/, '');
          return { id, jid: chat.id, name: chat.name || chat.pushName || id, type: 'contact' as const };
        }),
      timestamp: new Date().toISOString(),
    };
    targetsCache.set(connectionId, { timestamp: Date.now(), data: result });
    res.json(result);
  });

  orgRoutes.get('/connections/:connectionId/qr', checkScope('connections:read'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);
    const connection = await connRepo.getConnection(res.locals.organizationId as string, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }
    if (connection.provider !== 'evolution') {
      res.status(400).json({ error: 'QR Code só está disponível para conexões Evolution API.' });
      return;
    }

    const credentials = await connRepo.getConnectionCredentials<EvolutionCredentials>(connectionId, serviceDb);
    if (!credentials || !credentials.serverUrl || !credentials.apiKey) {
      res.status(500).json({ error: 'Credenciais da conexão não encontradas.' });
      return;
    }

    const instanceName = connection.provider_instance_id || credentials.instanceName || '';
    const qrResult = await ConnectionManager.getLiveQr(instanceName, credentials.serverUrl, credentials.apiKey);

    if (qrResult.connected) {
      await connRepo.updateStatus(connectionId, 'connected', undefined, serviceDb);
    }

    res.json(qrResult);
  });

  orgRoutes.post('/connections/:connectionId/verify', checkScope('connections:read'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);
    const connection = await connRepo.getConnection(res.locals.organizationId as string, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }

    const credentials = await connRepo.getConnectionCredentials(connectionId, serviceDb);
    if (!credentials) {
      res.status(500).json({ error: 'Credenciais da conexão não encontradas.' });
      return;
    }

    const health = await ConnectionManager.checkHealth(
      connection.provider,
      connection.provider_instance_id || '',
      credentials
    );

    if (health.status !== connection.status) {
      await connRepo.updateStatus(connectionId, health.status, undefined, serviceDb);
    }

    res.json(health);
  });

  orgRoutes.post('/connections/:connectionId/restart', requireAdmin, checkScope('connections:write'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);
    const connection = await connRepo.getConnection(res.locals.organizationId as string, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }

    if (connection.provider === 'evolution') {
      const credentials = await connRepo.getConnectionCredentials<EvolutionCredentials>(connectionId, serviceDb);
      if (credentials?.serverUrl && credentials?.apiKey) {
        const client = new EvolutionClient(credentials.serverUrl, credentials.apiKey);
        await client.restartInstance(connection.provider_instance_id || credentials.instanceName || '');
      }
    }

    res.json({ ok: true });
  });

  orgRoutes.delete('/connections/:connectionId', requireAdmin, checkScope('connections:write'), async (req, res) => {
    const connectionId = z.uuid().parse(req.params.connectionId);
    const serviceDb = getServiceDb() || res.locals.db;
    const connRepo = new ConnectionRepository(serviceDb);
    const connection = await connRepo.getConnection(res.locals.organizationId as string, connectionId);
    if (!connection) {
      res.status(404).json({ error: 'Conexão não encontrada.' });
      return;
    }

    if (connection.provider === 'evolution') {
      try {
        const credentials = await connRepo.getConnectionCredentials<EvolutionCredentials>(connectionId, serviceDb);
        if (credentials?.serverUrl && credentials?.apiKey) {
          const client = new EvolutionClient(credentials.serverUrl, credentials.apiKey);
          await client.deleteInstance(connection.provider_instance_id || credentials.instanceName || '');
        }
      } catch {
        // Ignore provider deletion error during teardown
      }
    }

    await connRepo.deleteConnection(res.locals.organizationId as string, connectionId, serviceDb);
    res.json({ ok: true });
  });

  // Integrations routes protection by capability ('vendedor' and 'vendedor-senior')
  orgRoutes.use('/integrations', requireOrgCapability('integrations:manage'));

  // Payment Gates (exclusive for 'vendedor-senior')
  orgRoutes.get('/integrations/payment-gates', requireOrgCapability('payment_gates:manage'), async (_req, res) => {
    res.json({
      configured: false,
      gateways: [
        { id: 'asaas', name: 'Asaas', status: 'available', enabled: false, description: 'PIX e Boleto bancário com conciliação automática' },
        { id: 'mercado_pago', name: 'Mercado Pago', status: 'available', enabled: false, description: 'Checkout Pro e transparente' },
        { id: 'stripe', name: 'Stripe', status: 'available', enabled: false, description: 'Cartões nacionais e internacionais e assinaturas' },
      ],
      tier: res.locals.orgTier,
    });
  });

  // Google Calendar External Accounts
  orgRoutes.get('/integrations/calendar/accounts', checkScope('integrations:read'), async (_req, res) => {
    try {
      const repo = res.locals.calendar as CalendarRepository;
      const accounts = await repo.listAccounts(res.locals.organizationId as string);
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  orgRoutes.get('/integrations/google/auth-url', requireAdmin, checkScope('integrations:write'), async (req, res) => {
    const { clientId, redirectUri } = resolveGoogleOAuthCredentials(config);
    if (!clientId) {
      res.status(400).json({ error: 'Google OAuth Client ID não configurado no servidor.' });
      return;
    }
    const state = crypto.randomBytes(32).toString('hex');
    const serviceDb = getServiceDb() || res.locals.db;
    const repo = new CalendarRepository(serviceDb);

    try {
      await repo.createOAuthState(
        res.locals.organizationId as string,
        res.locals.userId as string,
        state,
        'google_calendar',
        typeof req.query.redirectUrl === 'string' ? req.query.redirectUrl : undefined,
        serviceDb,
      );

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.json({ authUrl });
    } catch (error) {
      res.status(500).json({ error: `Falha ao gerar URL de autorização Google: ${(error as Error).message}` });
    }
  });

  orgRoutes.get('/integrations/calendar/accounts/:accountId/calendars', checkScope('integrations:read'), async (req, res) => {
    const accountId = z.uuid().safeParse(req.params.accountId);
    if (!accountId.success) {
      res.status(400).json({ error: 'ID de conta inválido.' });
      return;
    }
    const serviceDb = getServiceDb() || res.locals.db;
    const repo = new CalendarRepository(serviceDb);
    const account = await repo.getAccount(res.locals.organizationId as string, accountId.data);
    if (!account) {
      res.status(404).json({ error: 'Conta de calendário não encontrada na organização.' });
      return;
    }

    const creds = await repo.getAccountCredentials<GoogleCalendarCredentials>(accountId.data, serviceDb);
    if (!creds) {
      res.status(404).json({ error: 'Credenciais da conta não encontradas.' });
      return;
    }

    try {
      const client = new GoogleCalendarClient(globalThis.fetch, creds);
      const calendars = await client.listCalendarList();
      res.json(calendars);
    } catch (error) {
      res.status(502).json({ error: `Falha ao consultar agendas do Google: ${(error as Error).message}` });
    }
  });

  orgRoutes.delete('/integrations/calendar/accounts/:accountId', requireAdmin, checkScope('integrations:write'), async (req, res) => {
    const accountId = z.uuid().safeParse(req.params.accountId);
    if (!accountId.success) {
      res.status(400).json({ error: 'ID de conta inválido.' });
      return;
    }
    const serviceDb = getServiceDb() || res.locals.db;
    const repo = new CalendarRepository(serviceDb);
    const account = await repo.getAccount(res.locals.organizationId as string, accountId.data);
    if (!account) {
      res.status(404).json({ error: 'Conta de calendário não encontrada.' });
      return;
    }

    await repo.deleteAccount(res.locals.organizationId as string, accountId.data, serviceDb);
    res.json({ ok: true });
  });

  // Active flow bindings must use the same resolver as inbound turns. In particular,
  // an agent can pin an immutable version that differs from flows.published_version_id;
  // showing the draft or a global fallback here would make the UI lie about production.
  orgRoutes.get('/active-flows', checkScope('flows:read'), async (_req, res) => {
    const organizationId = res.locals.organizationId as string;
    const db = res.locals.db;
    const { data: connections, error } = await db
      .from('connections')
      .select('id,name,provider_instance_id,owner_user_id,agent_id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const bindings = await Promise.all((connections || []).map(async (connection: any) => {
      const resolution = await resolveFlowForConnection(db, { organization_id: organizationId, owner_user_id: connection.owner_user_id, agent_id: connection.agent_id });
      if (resolution.status !== 'resolved') return null;

      return {
        connection: {
          id: connection.id,
          name: connection.name,
          instanceName: connection.provider_instance_id || connection.name,
        },
        flow: {
          id: resolution.flowId,
          name: resolution.flowName,
          versionId: resolution.flowVersionId,
          version: resolution.flowVersion,
          publishedAt: resolution.flowVersionCreatedAt,
          graph: resolution.graph,
        },
      };
    }));

    res.json(bindings.filter((binding): binding is NonNullable<typeof binding> => binding !== null));
  });

  // Flows
  orgRoutes.get('/flows', checkScope('flows:read'), async (_req, res) => {
    res.json(await (res.locals.flows as FlowRepository).list());
  });
  orgRoutes.use((req, res, next) => {
    if (req.method !== 'GET' && !['owner', 'admin'].includes(res.locals.role as string)) {
      res.status(403).json({ error: 'Somente donos e administradores podem editar fluxos.' });
      return;
    }
    next();
  });
  orgRoutes.post('/flows', checkScope('flows:write'), async (req, res) => {
    const body = saveFlowSchema.parse(req.body);
    res.status(201).json(await (res.locals.flows as FlowRepository).create(body.name, body.graph));
  });
  orgRoutes.put('/flows/:flowId', checkScope('flows:write'), async (req, res) => {
    const flowId = z.uuid().parse(req.params.flowId);
    const body = saveFlowSchema.parse(req.body);
    res.json(await (res.locals.flows as FlowRepository).update(flowId, body.name, body.graph));
  });
  orgRoutes.post('/flows/:flowId/publish', checkScope('flows:write'), async (req, res) => {
    const flowId = z.uuid().parse(req.params.flowId);
    // The builder sends { graph, targetInstance } while API clients may send the
    // graph directly. Accept both shapes so publishing cannot silently discard
    // the test-mode guard before it reaches the immutable flow version.
    const body = z.object({ graph: z.unknown(), targetInstance: z.string().trim().min(1).optional() }).strict().safeParse(req.body);
    const graphInput = body.success ? body.data.graph : req.body;
    const targetInstance = body.success ? body.data.targetInstance : undefined;
    const validation = validateGraph(graphInput);
    if (!validation.valid || !validation.graph) { res.status(422).json(validation); return; }
    if (!config.serviceRoleKey) { res.status(503).json({ error: 'Publicação requer a chave de serviço configurada no servidor.' }); return; }
    const db = serviceDatabase(config.supabaseUrl!, config.serviceRoleKey);

    // Resolve the target before creating the immutable version so a typo in the
    // selected instance cannot leave an orphaned publication behind.
    let selectedAgentId: string | null = null;
    if (targetInstance) {
      let connectionQuery = db
        .from('connections')
        .select('id,agent_id')
        .eq('organization_id', res.locals.organizationId as string);
      if (uuidParam.safeParse(targetInstance).success) {
        connectionQuery = connectionQuery.eq('id', targetInstance);
      } else {
        connectionQuery = connectionQuery.eq('name', targetInstance);
      }
      let { data: connection } = await connectionQuery.maybeSingle();
      if (!connection && !uuidParam.safeParse(targetInstance).success) {
        const fallback = await db
          .from('connections')
          .select('id,agent_id')
          .eq('organization_id', res.locals.organizationId as string)
          .eq('provider_instance_id', targetInstance)
          .maybeSingle();
        connection = fallback.data;
      }
      if (!connection) {
        res.status(404).json({ error: 'Instância selecionada não encontrada nesta organização.' });
        return;
      }
      selectedAgentId = connection.agent_id;
    }

    const { data, error } = await db.rpc('publish_flow', { p_org: res.locals.organizationId as string, p_flow: flowId, p_actor: res.locals.userId as string, p_graph: validation.graph });
    if (error) throw error;

    // A published flow becomes the active flow for the selected connection.
    // This keeps the builder's “Publicar no WhatsApp” action aligned with the
    // canonical resolver used by inbound webhooks.
    if (selectedAgentId && data?.id) {
      const { error: assignmentError } = await db
        .from('ai_agents')
        .update({ flow_id: flowId, active_flow_version_id: data.id, updated_at: new Date().toISOString() })
        .eq('organization_id', res.locals.organizationId as string)
        .eq('id', selectedAgentId);
      if (assignmentError) throw assignmentError;
    }
    res.status(201).json(data);
  });

  // Admin execution log ("Logs de Execução"): shows full conversation content, prompts and
  // lead data across every flow run, so — unlike most orgRoutes, which are open to any member
  // via the JWT scopes=['*'] shortcut above — these three routes require org owner/admin.
  const listExecutionsQuerySchema = z.object({
    connectionId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed']).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate deve estar no formato YYYY-MM-DD.').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate deve estar no formato YYYY-MM-DD.').optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });
  orgRoutes.get('/executions', requireAdmin, checkScope('executions:read'), async (req, res) => {
    const parsedQuery = listExecutionsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: parsedQuery.error.issues[0]?.message || 'Parâmetros inválidos.' });
      return;
    }
    // connections/ai_agents are owner_user_id-scoped by RLS (connection_owner_select,
    // agents_read_self), not org-scoped — under the requester's own JWT client, the
    // lead/connection/agent embeds below would silently come back null for any instance the
    // requesting admin doesn't personally own. Read via service role instead, same fallback
    // idiom as /connections/:connectionId/qr and friends, safe now that this route is
    // requireAdmin-gated.
    const db = getServiceDb() || res.locals.db;
    const execRepo = new ExecutionRepository(db);
    const { limit, offset, ...filters } = parsedQuery.data;
    const result = await execRepo.listExecutions(res.locals.organizationId as string, { ...filters, limit, offset });
    res.json({ ...result, limit: limit ?? 50, offset: offset ?? 0 });
  });

  orgRoutes.get('/executions/:executionId', requireAdmin, checkScope('executions:read'), async (req, res) => {
    const executionId = z.uuid().parse(req.params.executionId);
    const organizationId = res.locals.organizationId as string;
    const db = getServiceDb() || res.locals.db;
    const execRepo = new ExecutionRepository(db);
    const execution = await execRepo.getExecutionDetail(executionId, organizationId);
    if (!execution) { res.status(404).json({ error: 'Execução não encontrada.' }); return; }
    const steps = await execRepo.getExecutionSteps(executionId, organizationId);
    // Strip the raw graph (node positions/edges/config) — the timeline only needs id/type/label
    // per node, the same shape turn-processor.ts's debugFlow.nodes and the Inbox debug route's
    // resolveConversationDebugFlow already derive from this same graph.
    const graph = execution.flow_version?.graph as any;
    const nodes = (graph?.nodes || []).map((node: any) => ({ id: node.id, type: node.type, label: node.label || node.type }));
    const { graph: _graph, ...flowVersionWithoutGraph } = execution.flow_version || {};
    res.json({
      execution: { ...execution, flow_version: execution.flow_version ? { ...flowVersionWithoutGraph, nodes } : null },
      steps,
    });
  });

  orgRoutes.post('/executions/:executionId/replay', requireAdmin, checkScope('executions:write'), async (req, res) => {
    const executionId = z.uuid().parse(req.params.executionId);
    const execRepo = res.locals.executions as ExecutionRepository;
    const execution = await execRepo.getExecution(executionId, res.locals.organizationId as string);
    if (!execution) { res.status(404).json({ error: 'Execução não encontrada.' }); return; }
    // Fase 3 (9.3): a batch writer assíncrona pode ainda não ter persistido todos os passos —
    // nunca tratar um trace pending como completo para fins de replay.
    if ((execution as any).trace_status === 'pending') {
      res.status(409).json({ error: 'O trace desta execução ainda está sendo gravado. Tente novamente em instantes.' });
      return;
    }
    if ((execution as any).trace_status === 'failed') {
      res.status(409).json({ error: 'O trace desta execução não pôde ser confirmado como completo e não é seguro para replay.' });
      return;
    }
    const steps = await execRepo.getExecutionSteps(executionId, res.locals.organizationId as string);

    const { data: flowVersion, error } = await (res.locals.db as any)
      .from('flow_versions')
      .select('graph')
      .eq('id', execution.flow_version_id)
      .single();

    if (error || !flowVersion?.graph) {
      res.status(404).json({ error: 'Versão do fluxo não encontrada.' });
      return;
    }

    const replayResult = await replayFlow(
      flowVersion.graph,
      {
        organizationId: res.locals.organizationId as string,
        connectionId: '',
        leadId: '',
        conversationId: execution.conversation_id,
        executionId: crypto.randomUUID(),
        flowVersionId: execution.flow_version_id,
        messages: [],
        variables: {},
        tokens: { input: 0, output: 0 },
      },
      steps as any
    );
    res.json(replayResult);
  });

  // --- KNOWLEDGE BASE MANAGEMENT ---
  const createDocumentSchema = z.object({
    collection: z.string().trim().min(1).max(50).default('default'),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

  const updateDocumentSchema = z.object({
    collection: z.string().trim().min(1).max(50).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

  orgRoutes.get('/knowledge', checkScope('knowledge:read'), async (req, res) => {
    const collection = typeof req.query.collection === 'string' ? req.query.collection : undefined;
    const repo = res.locals.knowledge as KnowledgeRepository;
    const docs = await repo.listDocuments(res.locals.organizationId as string, collection);
    res.json(docs);
  });

  orgRoutes.post('/knowledge', checkScope('knowledge:write'), async (req, res) => {
    const body = createDocumentSchema.parse(req.body);
    const repo = res.locals.knowledge as KnowledgeRepository;
    const doc = await repo.createDocument(res.locals.organizationId as string, body);
    res.status(201).json(doc);
  });

  orgRoutes.get('/knowledge/collections', checkScope('knowledge:read'), async (_req, res) => {
    const repo = res.locals.knowledge as KnowledgeRepository;
    const collections = await repo.listCollections(res.locals.organizationId as string);
    res.json(collections);
  });

  orgRoutes.get('/knowledge/:id', checkScope('knowledge:read'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const repo = res.locals.knowledge as KnowledgeRepository;
    const doc = await repo.getDocument(res.locals.organizationId as string, id);
    if (!doc) {
      res.status(404).json({ error: 'Documento não encontrado.' });
      return;
    }
    res.json(doc);
  });

  orgRoutes.patch('/knowledge/:id', checkScope('knowledge:write'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = updateDocumentSchema.parse(req.body);
    const repo = res.locals.knowledge as KnowledgeRepository;
    const doc = await repo.updateDocument(res.locals.organizationId as string, id, body);
    res.json(doc);
  });

  orgRoutes.delete('/knowledge/:id', checkScope('knowledge:write'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const repo = res.locals.knowledge as KnowledgeRepository;
    await repo.deleteDocument(res.locals.organizationId as string, id);
    res.json({ success: true });
  });

  orgRoutes.post('/knowledge/search', checkScope('knowledge:read'), async (req, res) => {
    const searchSchema = z.object({
      query: z.string().trim().min(1),
      collection: z.string().optional(),
      threshold: z.number().min(0).max(1).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    });
    const body = searchSchema.parse(req.body);
    const repo = res.locals.knowledge as KnowledgeRepository;
    const queryEmbedding = KnowledgeRepository.generateFallbackEmbedding(body.query);
    const results = await repo.search(res.locals.organizationId as string, queryEmbedding, {
      collection: body.collection,
      threshold: body.threshold,
      limit: body.limit,
    });
    res.json(results);
  });

  // --- PLAYGROUND ---
  const playgroundSchema = z.object({
    llm: z.enum(['mock', 'openai']).default('mock'),
    flowVersionId: z.uuid().optional(),
    message: z.string().trim().min(1),
    lead: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      interest: z.string().optional(),
      urgency: z.string().optional(),
      memory: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
  });

  orgRoutes.post('/flows/:id/playground', checkScope('flows:read'), async (req, res) => {
    const flowId = z.uuid().parse(req.params.id);
    const body = playgroundSchema.parse(req.body);
    const orgId = res.locals.organizationId as string;
    const db = res.locals.db;

    let graph: FlowGraph | null = null;
    if (body.flowVersionId) {
      const { data: fv } = await db
        .from('flow_versions')
        .select('graph')
        .eq('organization_id', orgId)
        .eq('id', body.flowVersionId)
        .eq('flow_id', flowId)
        .maybeSingle();
      if (fv) graph = fv.graph as FlowGraph;
    }

    if (!graph) {
      const { data: flow } = await db
        .from('flows')
        .select('draft')
        .eq('organization_id', orgId)
        .eq('id', flowId)
        .single();
      if (!flow) {
        res.status(404).json({ error: 'Fluxo não encontrado.' });
        return;
      }
      graph = flow.draft as FlowGraph;
    }

    const knowledgeRepo = res.locals.knowledge as KnowledgeRepository;
    const summaryRepo = res.locals.summaries as SummaryRepository;

    const playgroundResult = await runPlayground({
      graph,
      organizationId: orgId,
      message: body.message,
      lead: body.lead,
      services: {
        llm: body.llm === 'openai' ? new OpenAIProvider({ apiKey: config.openaiApiKey, model: config.openaiModel, timeoutMs: config.openaiTimeoutMs }) : undefined,
        db: {
          async updateLead() {},
          async updateConversation() {},
          async saveMessage() { return { id: crypto.randomUUID() }; },
          async syncDeal() { return { id: crypto.randomUUID() }; },
          async searchKnowledge(_org, collection, query, limit, threshold) {
            const queryEmb = KnowledgeRepository.generateFallbackEmbedding(query);
            const hits = await knowledgeRepo.search(orgId, queryEmb, {
              collection: collection === 'default' ? undefined : collection,
              limit,
              threshold,
            });
            return hits.map(h => ({
              text: `[${h.collection.toUpperCase()}] ${h.title}: ${h.content}`,
              collection: h.collection,
              title: h.title,
              similarity: h.similarity,
            }));
          },
          async getConversationSummary(_org, convId) {
            return summaryRepo.getSummary(orgId, convId);
          },
          async saveConversationSummary(_org, convId, summary, count, tokens) {
            // Playground never persists simulated conversations.
          },
        },
      },
    });

    res.json(playgroundResult);
  });

  // --- INBOX ROUTES ---
  orgRoutes.get('/inbox/conversations', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const stage = req.query.stage ? String(req.query.stage) : undefined;
    const connectionId = req.query.connectionId ? String(req.query.connectionId) : undefined;
    const handledBy = req.query.handledBy ? (String(req.query.handledBy) as any) : undefined;
    const assignedUserId = req.query.assignedUserId === 'unassigned'
      ? null
      : req.query.assignedUserId
      ? String(req.query.assignedUserId)
      : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    let resolvedConnectionId = connectionId;
    if (connectionId && !z.string().uuid().safeParse(connectionId).success) {
      const db = res.locals.db;
      const { data: conns } = await db
        .from('connections')
        .select('id')
        .eq('organization_id', orgId)
        .or(`name.eq.${connectionId},provider_instance_id.eq.${connectionId}`)
        .order('created_at', { ascending: true })
        .limit(1);
      if (conns && conns[0]) {
        resolvedConnectionId = conns[0].id;
      }
    }

    const result = await inboxRepo.listConversations(orgId, {
      stage,
      connectionId: resolvedConnectionId,
      handledBy,
      assignedUserId,
      search,
      limit,
      offset,
    });
    res.json(result);
  });

  orgRoutes.get('/inbox/conversations/:id', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);

    const conv = await inboxRepo.getConversation(orgId, convId);
    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    const messages = await inboxRepo.getMessages(orgId, convId);
    res.json({ conversation: conv, messages });
  });

  orgRoutes.get('/inbox/conversations/:id/debug', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const convId = z.string().uuid().parse(req.params.id);
    res.json({ session: await debugRegistry.get(orgId, convId) });
  });

  orgRoutes.post('/inbox/conversations/:id/debug', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const convId = z.string().uuid().parse(req.params.id);
    const result = await armConversationDebug(res.locals.db, res.locals.inbox as InboxRepository, orgId, convId);
    res.status(result.status).json(result.body);
  });

  orgRoutes.delete('/inbox/conversations/:id/debug', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const convId = z.string().uuid().parse(req.params.id);
    res.json({ session: await debugRegistry.cancel(orgId, convId) });
  });

  orgRoutes.post('/inbox/conversations/:id/takeover', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;

    const updated = await inboxRepo.takeover(orgId, convId, userId);
    await emitInboxEvent(conversationUpdatedEvent(orgId, updated));
    res.json(updated);
  });

  orgRoutes.post('/inbox/conversations/:id/release', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;

    const updated = await inboxRepo.release(orgId, convId, userId);
    await emitInboxEvent(conversationUpdatedEvent(orgId, updated));
    res.json(updated);
  });

  orgRoutes.post('/inbox/conversations/:id/assign', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;
    const body = z.object({ assignedUserId: z.string().uuid().nullable() }).parse(req.body);

    const updated = await inboxRepo.assign(orgId, convId, body.assignedUserId, userId);
    await emitInboxEvent(conversationUpdatedEvent(orgId, updated));
    res.json(updated);
  });

  orgRoutes.patch('/inbox/conversations/:id/stage', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;
    const body = z.object({
      stage: z.string().transform(s => normalizeConversationStage(s))
    }).parse(req.body);

    const updated = await inboxRepo.updateStage(orgId, convId, body.stage as any, userId);
    await emitInboxEvent(conversationUpdatedEvent(orgId, updated));
    res.json(updated);
  });

  orgRoutes.patch('/inbox/conversations/:id/lead-memory', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const body = z.object({
      path: z.string().min(1).max(200),
      value: z.unknown().optional(),
      delete: z.boolean().optional(),
    }).parse(req.body);

    const conv = await inboxRepo.getConversation(orgId, convId);
    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

    const memory: Record<string, unknown> = { ...(conv.lead.memory as Record<string, unknown> || {}) };
    const parts = body.path.split('.');
    if (parts.length === 2 && parts[0] === 'custom_fields' && parts[1]) {
      const subKey = parts[1];
      const custom: Record<string, unknown> = {
        ...(memory.custom_fields && typeof memory.custom_fields === 'object' ? memory.custom_fields as Record<string, unknown> : {}),
      };
      if (body.delete) delete custom[subKey];
      else custom[subKey] = body.value;
      memory.custom_fields = custom;
    } else {
      if (body.delete) delete memory[body.path];
      else memory[body.path] = body.value;
    }

    // Dashboard sessions run as `authenticated`, which only has SELECT on public.leads
    // (see supabase/migrations/202609080001_foundation.sql) — writing memory needs the
    // service role, same as the flow engine's own action.update_lead executor.
    const convRepo = new ConversationRepository(getServiceDb() || res.locals.db);
    await convRepo.updateLead(orgId, conv.lead_id, { memory });
    const refreshed = await inboxRepo.getConversation(orgId, convId);
    res.json(refreshed);
  });

  orgRoutes.post('/inbox/conversations/:id/messages', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;
    const body = z.object({ content: z.string().trim().min(1) }).parse(req.body);

    const conv = await inboxRepo.getConversation(orgId, convId);
    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

    const msg = await inboxRepo.sendHumanMessage({
      organizationId: orgId,
      connectionId: conv.connection_id,
      conversationId: conv.id,
      content: body.content,
      actorId: userId,
    });
    await emitInboxEvent(messageCreatedEvent(orgId, msg));
    res.status(201).json(msg);
  });

  // --- METRICS & EXPORT ROUTES ---
  // Fase 4 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 10.4.4): explicit format/order/range
  // validation instead of silently ignoring startDate/endDate (the pre-Fase-4 behavior).
  // Defaults to the last 30 UTC days when neither is given.
  const dashboardQuerySchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate deve estar no formato YYYY-MM-DD.').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate deve estar no formato YYYY-MM-DD.').optional(),
    connectionId: z.string().uuid('connectionId deve ser um UUID válido.').optional(),
  });
  orgRoutes.get('/metrics/dashboard', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const metricsRepo = res.locals.metrics as MetricsRepository;
    const parsedQuery = dashboardQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: parsedQuery.error.issues[0]?.message || 'Parâmetros de data inválidos.' });
      return;
    }
    const todayUtc = new Date().toISOString().split('T')[0]!;
    const thirtyDaysAgoUtc = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
    const startDate = parsedQuery.data.startDate ?? thirtyDaysAgoUtc;
    const endDate = parsedQuery.data.endDate ?? todayUtc;
    if (startDate > endDate) {
      res.status(400).json({ error: 'startDate não pode ser depois de endDate.' });
      return;
    }
    const rangeDays = (Date.parse(endDate) - Date.parse(startDate)) / (24 * 60 * 60 * 1000);
    if (rangeDays > 366) {
      res.status(400).json({ error: 'O intervalo entre startDate e endDate não pode exceder 366 dias.' });
      return;
    }

    const connectionId = parsedQuery.data.connectionId ?? null;
    try {
      const data = await metricsRepo.getDashboardMetrics(orgId, { startDate, endDate, connectionId });
      res.json(data);
    } catch (err: any) {
      // Never fall back to a fake/empty dashboard on a real query failure (10.4.6).
      logger.error({ err, orgId, startDate, endDate, connectionId }, 'Falha ao calcular métricas do dashboard');
      res.status(502).json({ error: 'Não foi possível calcular as métricas no momento.' });
    }
  });

  orgRoutes.post('/metrics/rollup', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const metricsRepo = res.locals.metrics as MetricsRepository;
    const body = z.object({
      targetDate: z.string().optional(),
      flowVersionId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body || {});

    const targetDate = body.success ? body.data.targetDate : undefined;
    const flowVersionId = body.success ? body.data.flowVersionId : undefined;

    const row = await metricsRepo.rollupDaily(orgId, targetDate, flowVersionId);
    res.json(row);
  });

  orgRoutes.get('/export/leads.csv', async (_req, res) => {
    const orgId = res.locals.organizationId as string;
    const metricsRepo = res.locals.metrics as MetricsRepository;
    const csv = await metricsRepo.exportLeadsCsv(orgId);
    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${dateStr}.csv"`);
    res.status(200).send(csv);
  });

  orgRoutes.get('/export/conversations.csv', async (_req, res) => {
    const orgId = res.locals.organizationId as string;
    const metricsRepo = res.locals.metrics as MetricsRepository;
    const csv = await metricsRepo.exportConversationsCsv(orgId);
    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conversations-${dateStr}.csv"`);
    res.status(200).send(csv);
  });

  orgRoutes.get('/alerts/status', async (_req, res) => {
    const orgId = res.locals.organizationId as string;
    const db = res.locals.serviceDb || res.locals.db;
    // Real queue depth (waiting/delayed/active/failed) from the canonical queue (8.7) — absent
    // only when this process has no turnBuffer (dev inline-fallback mode has no queue at all).
    const queueCounts = await turnBuffer?.counts().catch(() => undefined);
    const result = await AlertMonitor.evaluateAlerts(db, orgId, { queueWaitingCount: queueCounts?.waiting });
    res.json({ ...result, queue: queueCounts ? { name: queueNames.turns, ...queueCounts } : undefined });
  });

  app.use((_req,res) => { res.status(404).json({ error: 'Rota não encontrada.' }); });
  const errors: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    SentryService.captureException(error, {
      organizationId: res.locals?.organizationId,
      flowId: (req.params as Record<string, string>)?.id,
      userId: res.locals?.userId,
    });
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Dados inválidos.', issues: error.issues }); return; }
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === '42501') { res.status(403).json({ error: 'Ação não autorizada.' }); return; }
    if (code === 'PGRST116' || code === 'P0002') { res.status(404).json({ error: 'Fluxo não encontrado.' }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'JSON inválido.' }); return; }
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) { res.status(413).json({ error: 'Arquivo excede o limite de 1 MB.' }); return; }
    res.status(500).json({ error: 'Não foi possível concluir a operação.' });
  };
  app.use(errors);

  return app;
}
