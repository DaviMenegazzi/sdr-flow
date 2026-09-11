import express, { type ErrorRequestHandler, type Express } from 'express';
import { z } from 'zod';
import {
  FlowRepository,
  ExecutionRepository,
  OrganizationRepository,
  ConnectionRepository,
  ConversationRepository,
  KnowledgeRepository,
  SummaryRepository,
  InboxRepository,
  MetricsRepository,
  userDatabase,
  serviceDatabase,
  type EvolutionCredentials,
  type MetaCredentials,
} from '@sdr/db';
import { saveFlowSchema, memberRoleSchema, type FlowGraph, normalizeConversationStage, isPhoneNumberMatch, type FlowContext } from '@sdr/shared';
import { catalog, validateGraph, replayFlow, runPlayground, executeFlow, MockLLMProvider, GoogleCalendarClient, type FlowServices } from '@sdr/flow';
import { parseEvolutionWebhook, parseMetaWebhook, processInboundWebhook } from './webhook.js';
import { ConnectionManager } from './whatsapp/connection-manager.js';
import { EvolutionClient } from './whatsapp/evolution-client.js';
import { requestLogger, logger } from './telemetry/logger.js';
import { SentryService } from './telemetry/sentry.js';
import { orgRateLimiter, publicRateLimiter } from './rate-limit.js';
import { AlertMonitor } from './alerts/alert-monitor.js';
import { createCalendarProvider, OpenAIProvider, type RuntimeConfig } from '@sdr/flow/server';
import { secretMatches, verifyMetaSignature } from './whatsapp/webhook-auth.js';
import { standaloneStore, type StoredFlow, type ExternalIntegration } from './storage.js';
import { wsServer } from './ws.js';
import { conversationDebugRegistry, type DebugFlowSnapshot } from './debug-session.js';
import {
  bufferWindowSeconds,
  ConversationTurnQueue,
  SUPERSEDED_TURN_ERROR,
  type BufferedConversationTurn,
} from './conversation-turn-queue.js';

export interface ApiConfig extends RuntimeConfig {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  publicApiUrl?: string;
  evolutionServerUrl?: string;
  evolutionApiKey?: string;
  redisUrl?: string;
}
export function createApp(config: ApiConfig = {}): Express {
  const app = express();
  let processStandaloneBufferedTurn: ((turn: BufferedConversationTurn) => Promise<{ status: string; [key: string]: unknown }>) | undefined;
  const turnQueue = config.redisUrl
    ? new ConversationTurnQueue(config.redisUrl, async turn => {
        if (turn.kind === 'published') {
          return processInboundWebhook(turn.target, turn.events, config, {
            bypassQueue: true,
            messagesAlreadySaved: true,
            isCurrent: turn.isCurrent,
            flowId: typeof turn.metadata?.flowId === 'string' ? turn.metadata.flowId : undefined,
            flowVersionId: typeof turn.metadata?.flowVersionId === 'string' ? turn.metadata.flowVersionId : undefined,
          }) as Promise<{ status: string; [key: string]: unknown }>;
        }
        if (processStandaloneBufferedTurn) return processStandaloneBufferedTurn(turn);
        return { status: 'error', error: 'standalone_turn_handler_not_ready' };
      })
    : undefined;
  app.locals.conversationTurnQueue = turnQueue;
  app.disable('x-powered-by');
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
    const bindings = standaloneStore.getActiveBindings();
    res.json({
      status: 'ok',
      service: 'api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      supabase: { configured: supabaseConfigured, connected: supabaseConnected, organizations: orgCount, connections: connectionCount },
      standalone: { activeFlows: Object.keys(bindings).length, instances: Object.keys(bindings) },
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      },
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
    }).select().single();
    steps.push({ step: 'create_connection', ok: !connErr, detail: connErr || { id: conn?.id } });

    // 4. Create lead
    const convRepo = new ConversationRepository(db);
    try {
      const lead = await convRepo.findOrCreateLead(orgId, '5500000000000', 'Debug Test');
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

  // Direct WhatsApp & Evolution Endpoints (Standalone Mode)
  const getEvoClient = (serverUrl?: string, apiKey?: string) => {
    const settings = standaloneStore.getSettings();
    const url = serverUrl?.trim() || settings.evolutionServerUrl || config.evolutionServerUrl || process.env.EVOLUTION_SERVER_URL || 'http://127.0.0.1:8080';
    const key = apiKey?.trim() || settings.evolutionApiKey || config.evolutionApiKey || process.env.EVOLUTION_API_KEY || 'EvolutionApiSecretKey_2026';
    return new EvolutionClient(url, key);
  };
  const getPublicApiUrl = () => {
    const settings = standaloneStore.getSettings();
    return settings.publicApiUrl || config.publicApiUrl || process.env.PUBLIC_API_URL || '';
  };

  app.get('/api/connections/instances', async (req, res) => {
    try {
      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);
      const instances = await client.fetchInstances();
      const mapped = instances.map((inst: any) => {
        const instanceName = inst.instance?.instanceName || inst.name || inst.instanceName || inst.id || 'unknown';
        const connStatus = inst.instance?.status || inst.connectionStatus || inst.state;
        return {
          id: instanceName,
          name: instanceName,
          provider: 'evolution' as const,
          status: connStatus === 'open' || connStatus === 'connected' ? 'connected' : connStatus === 'connecting' ? 'connecting' : 'disconnected',
          phone: inst.number || inst.instance?.number || (inst.ownerJid ? inst.ownerJid.replace(/@.*$/, '') : (inst.instance?.ownerJid ? inst.instance.ownerJid.replace(/@.*$/, '') : null)),
          provider_instance_id: instanceName,
          created_at: inst.createdAt || inst.instance?.createdAt || new Date().toISOString(),
          profileName: inst.profileName || inst.instance?.profileName,
          profilePicUrl: inst.profilePicUrl || inst.instance?.profilePicUrl,
          webhook_url: `/api/webhooks/evolution/instance/${encodeURIComponent(instanceName)}`,
        };
      });
      res.json(mapped);
    } catch (err) {
      logger.error({ err }, 'Falha ao buscar instâncias da Evolution API');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao comunicar com Evolution API.' });
    }
  });

  // Cache para contatos e grupos da instância (TTL: 30s)
  const targetsCache = new Map<string, { timestamp: number; data: any }>();

  app.get('/api/connections/instances/:instanceName/targets', async (req, res) => {
    try {
      const { instanceName } = req.params;
      const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
      const cached = targetsCache.get(instanceName);
      if (!forceRefresh && cached && Date.now() - cached.timestamp < 30_000) {
        res.json(cached.data);
        return;
      }

      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);

      const [groups, chats] = await Promise.all([
        client.fetchGroups(instanceName).catch((err) => {
          logger.warn({ err, instanceName }, 'Falha em fetchGroups da Evolution');
          return [];
        }),
        client.fetchChats(instanceName).catch((err) => {
          logger.warn({ err, instanceName }, 'Falha em fetchChats da Evolution');
          return [];
        }),
      ]);

      const groupMap = new Map<string, { id: string; jid: string; name: string; type: 'group'; size?: number }>();

      // Adiciona grupos vindos de fetchGroups
      for (const g of groups) {
        if (g.id) {
          groupMap.set(g.id, {
            id: g.id,
            jid: g.id,
            name: g.subject || g.id,
            type: 'group' as const,
            size: g.size,
          });
        }
      }

      // Adiciona chats que são grupos (@g.us) como fallback essencial
      for (const c of chats) {
        const jid = c.id || '';
        if (jid.endsWith('@g.us') || jid.includes('@g.us')) {
          if (!groupMap.has(jid)) {
            groupMap.set(jid, {
              id: jid,
              jid: jid,
              name: c.name || c.pushName || jid,
              type: 'group' as const,
            });
          }
        }
      }

      const formattedGroups = Array.from(groupMap.values());

      const formattedContacts = chats
        .filter(c => !c.id.endsWith('@g.us') && !c.id.includes('@g.us'))
        .map(c => {
          const cleanPhone = c.id.replace(/@.*$/, '');
          return {
            id: cleanPhone,
            jid: c.id,
            name: c.name || c.pushName || cleanPhone,
            type: 'contact' as const,
          };
        });

      const result = {
        instanceName,
        groups: formattedGroups,
        contacts: formattedContacts,
        timestamp: new Date().toISOString(),
      };

      targetsCache.set(instanceName, { timestamp: Date.now(), data: result });
      res.json(result);
    } catch (err) {
      logger.error({ err, instance: req.params.instanceName }, 'Erro ao buscar destinatários da instância');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao listar contatos/grupos' });
    }
  });

  app.post('/api/connections/evolution/create', async (req, res) => {
    try {
      const { name, serverUrl, apiKey, phone } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Nome da instância é obrigatório.' });
        return;
      }
      const instanceName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const client = getEvoClient(serverUrl, apiKey);

      try {
        await client.createInstance(instanceName, phone);
      } catch (err: any) {
        logger.info({ instanceName, err: err.message }, 'Instância já pode existir, prosseguindo com conexão');
      }

      // Auto-configure webhook so incoming messages reach our API
      const webhookPath = `/api/webhooks/evolution/instance/${encodeURIComponent(instanceName)}`;
      const publicUrl = getPublicApiUrl();
      let webhookWarning: string | undefined;
      if (publicUrl) {
        try {
          await client.setWebhook(instanceName, `${publicUrl}${webhookPath}`);
          logger.info({ instanceName, webhookUrl: `${publicUrl}${webhookPath}` }, 'Webhook configurado automaticamente');
        } catch (err: any) {
          webhookWarning = `Webhook não pôde ser configurado automaticamente: ${err.message}. Configure manualmente.`;
          logger.warn({ instanceName, err: err.message }, 'Falha ao configurar webhook automaticamente');
        }
      } else {
        webhookWarning = 'URL pública da API não configurada em Configurações. Configure o webhook manualmente na Evolution API.';
      }

      const qr = await client.getConnectQr(instanceName);
      const state = await client.getConnectionState(instanceName);

      res.status(201).json({
        id: instanceName,
        name: instanceName,
        provider: 'evolution',
        provider_instance_id: instanceName,
        status: state.state === 'open' ? 'connected' : 'connecting',
        phone: phone || null,
        created_at: new Date().toISOString(),
        qr,
        webhook_url: webhookPath,
        setupWarning: webhookWarning,
      });
    } catch (err) {
      logger.error({ err }, 'Erro ao criar instância Evolution');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao criar instância na Evolution.' });
    }
  });

  app.get('/api/connections/evolution/qr/:instanceName', async (req, res) => {
    try {
      const instanceName = req.params.instanceName;
      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);

      const state = await client.getConnectionState(instanceName);
      if (state.state === 'open') {
        res.json({ connected: true, status: 'connected' });
        return;
      }

      const qr = await client.getConnectQr(instanceName);
      res.json({
        connected: false,
        status: state.state || 'connecting',
        code: qr.code,
        base64: qr.base64,
        pairingCode: qr.pairingCode,
        error: qr.error,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao obter QR code.' });
    }
  });

  app.get('/api/connections/evolution/status/:instanceName', async (req, res) => {
    try {
      const instanceName = req.params.instanceName;
      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);
      const state = await client.getConnectionState(instanceName);
      res.json({
        status: state.state === 'open' ? 'connected' : state.state === 'connecting' ? 'connecting' : 'disconnected',
        state: state.state,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao verificar status.' });
    }
  });

  app.post('/api/connections/evolution/restart/:instanceName', async (req, res) => {
    try {
      const instanceName = req.params.instanceName;
      const client = getEvoClient(req.body?.serverUrl, req.body?.apiKey);
      await client.restartInstance(instanceName);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao reiniciar instância.' });
    }
  });

  app.delete('/api/connections/evolution/:instanceName', async (req, res) => {
    try {
      const instanceName = req.params.instanceName;
      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);
      await client.deleteInstance(instanceName);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao excluir instância.' });
    }
  });

  // --- STANDALONE FLOWS & MANAGEMENT ---
  app.get('/api/flows', (_req, res) => {
    res.json(standaloneStore.listFlows());
  });

  app.get('/api/flows/active', (_req, res) => {
    res.json(standaloneStore.getActiveBindings());
  });

  app.get('/api/flows/:id', (req, res) => {
    const flow = standaloneStore.getFlow(req.params.id);
    if (!flow) {
      res.status(404).json({ error: 'Fluxo não encontrado.' });
      return;
    }
    res.json(flow);
  });

  app.post('/api/flows', (req, res) => {
    try {
      const { id, name, graph, targetInstance } = req.body;
      if (!name || !graph) {
        res.status(400).json({ error: 'Nome e grafo do fluxo são obrigatórios.' });
        return;
      }
      const validation = validateGraph(graph);
      const saved = standaloneStore.saveFlow({ id, name, graph, targetInstance });
      res.status(201).json({ ...saved, validation });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao salvar fluxo.' });
    }
  });

  app.put('/api/flows/:id', (req, res) => {
    try {
      const { name, graph, targetInstance } = req.body;
      if (!name || !graph) {
        res.status(400).json({ error: 'Nome e grafo do fluxo são obrigatórios.' });
        return;
      }
      const validation = validateGraph(graph);
      const saved = standaloneStore.saveFlow({ id: req.params.id, name, graph, targetInstance });
      res.json({ ...saved, validation });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao atualizar fluxo.' });
    }
  });

  app.delete('/api/flows/:id', (req, res) => {
    standaloneStore.deleteFlow(req.params.id);
    res.json({ ok: true });
  });

  const publishStandaloneHandler = async (req: express.Request, res: express.Response) => {
    try {
      const flowId = req.params.id || req.body.id || req.body.flowId || crypto.randomUUID();
      const graph = req.body.graph || req.body;
      const targetInstance = req.body.targetInstance;

      const validation = validateGraph(graph);
      if (!validation.valid) {
        res.status(422).json({ error: 'Grafo inválido para publicação.', issues: validation.issues });
        return;
      }

      const result = standaloneStore.publishFlow(flowId, graph, targetInstance);

      let webhookUrl: string | undefined;
      let webhookError: string | undefined;

      const activeTarget = result.flow.targetInstance || targetInstance;
      if (activeTarget) {
        try {
          const baseUrl = (config.publicApiUrl || process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
          webhookUrl = `${baseUrl}/api/webhooks/evolution/instance/${encodeURIComponent(activeTarget)}`;
          const client = getEvoClient();
          await client.setWebhook(activeTarget, webhookUrl);
          logger.info({ instance: activeTarget, webhookUrl }, 'Webhook da Evolution registrado com sucesso para fluxo publicado');
        } catch (err) {
          webhookError = err instanceof Error ? err.message : 'Falha ao registrar webhook no Evolution';
          logger.warn({ err, instance: activeTarget }, 'Aviso ao registrar webhook da Evolution');
        }
      }

      res.status(201).json({
        ok: true,
        version: result.version,
        flow: result.flow,
        targetInstance: activeTarget,
        webhookUrl,
        webhookError,
      });
    } catch (err) {
      logger.error({ err }, 'Erro ao publicar fluxo');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha na publicação do fluxo.' });
    }
  };

  app.post('/api/flows/publish', publishStandaloneHandler);
  app.post('/api/flows/:id/publish', publishStandaloneHandler);

  // --- PLAYGROUND STANDALONE ---
  const playgroundStandaloneHandler = async (req: express.Request, res: express.Response) => {
    try {
      const { graph: inputGraph, flowId, message, lead, llm, openaiApiKey, openaiModel } = req.body;
      let graph = inputGraph;
      const targetId = req.params.id || flowId;
      if (!graph && targetId) {
        const flow = standaloneStore.getFlow(targetId);
        if (flow) graph = flow.graph;
      }
      if (!graph) {
        res.status(400).json({ error: 'Grafo do fluxo é obrigatório.' });
        return;
      }

      const settings = standaloneStore.getSettings();
      const effectiveApiKey = (openaiApiKey || settings.openaiApiKey || config.openaiApiKey || '').trim();
      const effectiveModel = (openaiModel || settings.openaiModel || config.openaiModel || 'gpt-4.1-mini').trim();

      if (llm === 'openai' && !effectiveApiKey) {
        res.status(400).json({
          error: 'Chave da OpenAI não configurada. Configure na aba de Configurações ou informe a chave.',
        });
        return;
      }

      const playgroundResult = await runPlayground({
        graph,
        organizationId: 'standalone-org',
        message: message || 'Olá',
        lead: lead || { name: 'Lead Teste', phone: '+5511999999999' },
        services: {
          llm: llm === 'openai' && effectiveApiKey
            ? new OpenAIProvider({ apiKey: effectiveApiKey, model: effectiveModel, timeoutMs: settings.openaiTimeoutMs || 60000 })
            : undefined,
          db: {
            async updateLead() {},
            async updateConversation() {},
            async saveMessage() { return { id: crypto.randomUUID() }; },
            async syncDeal() { return { id: crypto.randomUUID() }; },
            async searchKnowledge(_org, collection, query, limit, threshold) {
              const hits = standaloneStore.searchKnowledge(query, {
                collection: collection === 'default' ? undefined : collection,
                limit: limit || 5,
                threshold: typeof threshold === 'number' ? threshold : 0.2,
              });
              return hits.map(h => ({
                text: `[${h.collection.toUpperCase()}] ${h.title}: ${h.content}`,
                collection: h.collection,
                title: h.title,
                similarity: h.similarity,
              }));
            },
            async getConversationSummary() { return null; },
            async saveConversationSummary() {},
          },
        },
      });
      res.json(playgroundResult);
    } catch (err) {
      logger.error({ err }, 'Erro ao rodar playground');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao executar playground.' });
    }
  };

  app.post('/api/flows/playground', playgroundStandaloneHandler);
  app.post('/api/flows/:id/playground', playgroundStandaloneHandler);

  // --- KNOWLEDGE STANDALONE ---
  const knowledgeRouter = express.Router();

  knowledgeRouter.get('/', (req, res) => {
    const collection = typeof req.query.collection === 'string' ? req.query.collection : undefined;
    res.json(standaloneStore.listKnowledge(collection));
  });

  knowledgeRouter.get('/collections', (_req, res) => {
    res.json(standaloneStore.listCollections());
  });

  knowledgeRouter.post('/', (req, res) => {
    try {
      const { collection, title, content, metadata } = req.body || {};
      if (!title || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'Título do documento é obrigatório.' });
        return;
      }
      if (!content || typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'Conteúdo do documento é obrigatório.' });
        return;
      }
      const doc = standaloneStore.createKnowledge({
        collection,
        title,
        content,
        metadata,
      });
      res.status(201).json(doc);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao salvar documento.' });
    }
  });

  knowledgeRouter.get('/:id', (req, res) => {
    const doc = standaloneStore.getKnowledge(req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Documento não encontrado.' });
      return;
    }
    res.json(doc);
  });

  knowledgeRouter.patch('/:id', (req, res) => {
    try {
      const doc = standaloneStore.updateKnowledge(req.params.id, req.body || {});
      if (!doc) {
        res.status(404).json({ error: 'Documento não encontrado.' });
        return;
      }
      res.json(doc);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao atualizar documento.' });
    }
  });

  knowledgeRouter.delete('/:id', (req, res) => {
    const success = standaloneStore.deleteKnowledge(req.params.id);
    res.json({ success });
  });

  knowledgeRouter.post('/search', (req, res) => {
    try {
      const { query, collection, threshold, limit } = req.body || {};
      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'Termo de busca é obrigatório.' });
        return;
      }
      const results = standaloneStore.searchKnowledge(query, {
        collection: collection === 'all' ? undefined : collection,
        threshold: typeof threshold === 'number' ? threshold : 0.2,
        limit: typeof limit === 'number' ? limit : 5,
      });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha na busca de conhecimento.' });
    }
  });

  app.use('/api/knowledge', knowledgeRouter);

  // --- INBOX STANDALONE ROUTER ---
  const inboxRouter = express.Router();

  const getInboxContext = async (requestedOrgId?: string) => {
    if (!config.supabaseUrl || !config.serviceRoleKey) return null;
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const inboxRepo = new InboxRepository(db);

    let orgId = requestedOrgId;
    if (!orgId || orgId === 'undefined' || orgId === 'standalone-org' || orgId === 'null') {
      const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle();
      orgId = org?.id;
    }
    if (!orgId) return null;
    return { db, inboxRepo, orgId };
  };

  const resolveConversationDebugFlow = async (
    db: any,
    organizationId: string,
    conversation: { connection_id: string }
  ): Promise<DebugFlowSnapshot | null> => {
    const { data: connection } = await db
      .from('connections')
      .select('id, name, provider_instance_id')
      .eq('organization_id', organizationId)
      .eq('id', conversation.connection_id)
      .maybeSingle();

    const instanceName = connection?.provider_instance_id || connection?.name;
    const standaloneFlow = instanceName ? standaloneStore.getActiveFlowForInstance(instanceName) : null;
    if (standaloneFlow) {
      return {
        id: standaloneFlow.id,
        name: standaloneFlow.name,
        version: `v${standaloneFlow.publishedVersion || 1}`,
        nodes: standaloneFlow.graph.nodes.map(node => ({ id: node.id, type: node.type, label: node.label || node.type })),
        graph: standaloneFlow.graph,
      };
    }

    const { data: flow } = await db
      .from('flows')
      .select('id, name, published_version_id')
      .eq('organization_id', organizationId)
      .not('published_version_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!flow?.published_version_id) return null;
    const { data: publishedVersion } = await db
      .from('flow_versions')
      .select('id, flow_id, version, graph')
      .eq('organization_id', organizationId)
      .eq('id', flow.published_version_id)
      .maybeSingle();
    const version: any = publishedVersion ? { ...publishedVersion, flowName: flow.name } : null;

    if (!version?.graph) return null;
    let flowName = version.flowName as string | undefined;
    if (!flowName) {
      const { data: flow } = await db
        .from('flows')
        .select('name')
        .eq('organization_id', organizationId)
        .eq('id', version.flow_id)
        .maybeSingle();
      flowName = flow?.name;
    }
    const graph = version.graph as FlowGraph;
    return {
      id: version.flow_id,
      name: flowName || 'Fluxo publicado',
      version: `v${version.version}`,
      nodes: graph.nodes.map(node => ({ id: node.id, type: node.type, label: node.label || node.type })),
      graph,
    };
  };

  const armConversationDebug = async (db: any, inboxRepo: InboxRepository, organizationId: string, conversationId: string) => {
    const conversation = await inboxRepo.getConversation(organizationId, conversationId);
    if (!conversation) return { status: 404, body: { error: 'Conversa não encontrada.' } };
    if (conversation.bot_paused || conversation.handled_by === 'HUMAN') {
      return { status: 409, body: { error: 'A IA está pausada nesta conversa. Devolva a conversa para a IA antes de iniciar o debug.' } };
    }
    const flow = await resolveConversationDebugFlow(db, organizationId, conversation);
    if (!flow) {
      return { status: 409, body: { error: 'Nenhum fluxo publicado está ativo para a instância desta conversa.' } };
    }
    const session = conversationDebugRegistry.arm({
      organizationId,
      conversationId,
      connectionId: conversation.connection_id,
      flow,
    });
    return { status: 201, body: { session } };
  };

  inboxRouter.get('/conversations', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.json({ conversations: [], total: 0 });
        return;
      }
      const stage = req.query.stage ? String(req.query.stage) : undefined;
      const connectionId = req.query.connectionId && req.query.connectionId !== 'ALL' ? String(req.query.connectionId) : undefined;
      const handledBy = req.query.handledBy && req.query.handledBy !== 'ALL' ? (String(req.query.handledBy) as any) : undefined;
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
        const { data: conn } = await ctx.db
          .from('connections')
          .select('id')
          .or(`name.eq.${connectionId},provider_instance_id.eq.${connectionId}`)
          .maybeSingle();
        if (conn) {
          resolvedConnectionId = conn.id;
        }
      }

      const result = await ctx.inboxRepo.listConversations(ctx.orgId, {
        stage,
        connectionId: resolvedConnectionId,
        handledBy,
        assignedUserId,
        search,
        limit,
        offset,
      });
      res.json(result);
    } catch (err: any) {
      logger.error({ err }, 'Erro ao listar conversas do inbox');
      res.status(500).json({ error: err.message || 'Falha ao listar conversas.' });
    }
  });

  inboxRouter.get('/conversations/:id', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.status(404).json({ error: 'Supabase não conectado.' });
        return;
      }
      const convId = z.string().uuid().parse(req.params.id);
      const conv = await ctx.inboxRepo.getConversation(ctx.orgId, convId);
      if (!conv) {
        res.status(404).json({ error: 'Conversa não encontrada.' });
        return;
      }
      const messages = await ctx.inboxRepo.getMessages(ctx.orgId, convId);
      res.json({ conversation: conv, messages });
    } catch (err: any) {
      logger.error({ err }, 'Erro ao carregar conversa');
      res.status(500).json({ error: err.message || 'Falha ao carregar conversa.' });
    }
  });

  inboxRouter.get('/conversations/:id/debug', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) { res.status(404).json({ error: 'Supabase não conectado.' }); return; }
      const convId = z.string().uuid().parse(req.params.id);
      res.json({ session: conversationDebugRegistry.get(ctx.orgId, convId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao consultar debug.' });
    }
  });

  inboxRouter.post('/conversations/:id/debug', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) { res.status(404).json({ error: 'Supabase não conectado.' }); return; }
      const convId = z.string().uuid().parse(req.params.id);
      const result = await armConversationDebug(ctx.db, ctx.inboxRepo, ctx.orgId, convId);
      res.status(result.status).json(result.body);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao iniciar debug.' });
    }
  });

  inboxRouter.delete('/conversations/:id/debug', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) { res.status(404).json({ error: 'Supabase não conectado.' }); return; }
      const convId = z.string().uuid().parse(req.params.id);
      res.json({ session: conversationDebugRegistry.cancel(ctx.orgId, convId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao encerrar debug.' });
    }
  });

  inboxRouter.post('/conversations/:id/takeover', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.status(404).json({ error: 'Supabase não conectado.' });
        return;
      }
      const convId = z.string().uuid().parse(req.params.id);
      const updated = await ctx.inboxRepo.takeover(ctx.orgId, convId, 'agent_operator');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha no takeover.' });
    }
  });

  inboxRouter.post('/conversations/:id/release', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.status(404).json({ error: 'Supabase não conectado.' });
        return;
      }
      const convId = z.string().uuid().parse(req.params.id);
      const updated = await ctx.inboxRepo.release(ctx.orgId, convId, 'agent_operator');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha no release.' });
    }
  });

  inboxRouter.patch('/conversations/:id/stage', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.status(404).json({ error: 'Supabase não conectado.' });
        return;
      }
      const convId = z.string().uuid().parse(req.params.id);
      const stage = normalizeConversationStage(req.body.stage);
      const updated = await ctx.inboxRepo.updateStage(ctx.orgId, convId, stage as any, 'agent_operator');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao atualizar estágio.' });
    }
  });

  inboxRouter.post('/conversations/:id/messages', async (req, res) => {
    try {
      const ctx = await getInboxContext(req.query.organizationId as string);
      if (!ctx) {
        res.status(404).json({ error: 'Supabase não conectado.' });
        return;
      }
      const convId = z.string().uuid().parse(req.params.id);
      const content = (req.body?.content || '').trim();
      if (!content) {
        res.status(400).json({ error: 'Conteúdo da mensagem é obrigatório.' });
        return;
      }

      const conv = await ctx.inboxRepo.getConversation(ctx.orgId, convId);
      if (!conv) {
        res.status(404).json({ error: 'Conversa não encontrada.' });
        return;
      }

      // 1. Salva a mensagem humana no Supabase
      const msg = await ctx.inboxRepo.sendHumanMessage({
        organizationId: ctx.orgId,
        connectionId: conv.connection_id,
        conversationId: conv.id,
        content,
        actorId: 'agent_operator',
      });

      // 2. Dispara a mensagem no WhatsApp via Evolution API
      try {
        let instanceName = conv.connection?.name || 'whatsapp';
        const { data: connRecord } = await ctx.db
          .from('connections')
          .select('name, provider_instance_id')
          .eq('id', conv.connection_id)
          .maybeSingle();

        if (connRecord) {
          instanceName = connRecord.provider_instance_id || connRecord.name || instanceName;
        }

        const phone = conv.lead?.phone;
        if (phone) {
          const settings = standaloneStore.getSettings();
          const evoClient = getEvoClient(settings.evolutionServerUrl, settings.evolutionApiKey);
          await evoClient.sendTextMessage(instanceName, phone, content);
          logger.info({ instanceName, phone, textLength: content.length }, 'Mensagem manual do inbox enviada ao WhatsApp');
        }
      } catch (evoErr: any) {
        logger.warn({ err: evoErr.message }, 'Falha ao enviar mensagem do inbox para o WhatsApp');
      }

      res.status(201).json(msg);
    } catch (err: any) {
      logger.error({ err }, 'Erro ao enviar mensagem no inbox');
      res.status(500).json({ error: err.message || 'Falha ao enviar mensagem.' });
    }
  });

  app.use('/api/inbox', inboxRouter);

  // --- SETTINGS STANDALONE ---
  app.get('/api/settings', (_req, res) => {
    const settings = standaloneStore.getSettings();
    const mask = (val?: string) => {
      if (!val || val.length <= 8) return val ? '••••••••' : '';
      return `${val.slice(0, 7)}...${val.slice(-4)}`;
    };
    res.json({
      openaiApiKeyConfigured: Boolean(settings.openaiApiKey),
      openaiApiKeyMasked: mask(settings.openaiApiKey),
      openaiModel: settings.openaiModel,
      evolutionServerUrl: settings.evolutionServerUrl,
      evolutionApiKeyMasked: mask(settings.evolutionApiKey),
      publicApiUrl: settings.publicApiUrl,
    });
  });

  app.post('/api/settings', (req, res) => {
    try {
      const { openaiApiKey, openaiModel, evolutionServerUrl, evolutionApiKey, publicApiUrl } = req.body;
      const patch: any = {};
      if (typeof openaiApiKey === 'string' && openaiApiKey.trim()) patch.openaiApiKey = openaiApiKey.trim();
      if (typeof openaiModel === 'string' && openaiModel.trim()) patch.openaiModel = openaiModel.trim();
      if (typeof evolutionServerUrl === 'string' && evolutionServerUrl.trim()) patch.evolutionServerUrl = evolutionServerUrl.trim();
      if (typeof evolutionApiKey === 'string' && evolutionApiKey.trim()) patch.evolutionApiKey = evolutionApiKey.trim();
      if (typeof publicApiUrl === 'string' && publicApiUrl.trim()) patch.publicApiUrl = publicApiUrl.trim();

      const updated = standaloneStore.updateSettings(patch);
      res.json({ ok: true, settings: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao salvar configurações.' });
    }
  });

  app.post('/api/settings/test-openai', async (req, res) => {
    try {
      const key = (req.body?.apiKey || standaloneStore.getSettings().openaiApiKey || config.openaiApiKey || '').trim();
      if (!key) {
        res.status(400).json({ ok: false, error: 'Chave da OpenAI não informada.' });
        return;
      }
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) {
        res.json({ ok: true, message: 'Chave da OpenAI válida e conectada com sucesso!' });
      } else {
        const errText = await resp.text();
        res.status(400).json({ ok: false, error: `OpenAI recusou a chave (${resp.status}): ${errText}` });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Falha ao testar conexão.' });
    }
  });

  // =========================================================================
  // CONEXÕES EXTERNAS & INTEGRAÇÕES MODULARES (Google Calendar, CRMs, etc.)
  // =========================================================================

  app.get('/api/integrations', (_req, res) => {
    try {
      const integrations = standaloneStore.listIntegrations();
      // Sanitiza credenciais sensíveis antes de enviar ao frontend
      const sanitized = integrations.map(item => ({
        id: item.id,
        provider: item.provider,
        name: item.name,
        status: item.status,
        accountEmail: item.accountEmail,
        connectedAt: item.connectedAt,
        updatedAt: item.updatedAt,
        hasRefreshToken: Boolean(item.credentials?.refresh_token),
        hasAccessToken: Boolean(item.credentials?.access_token),
        metadata: item.metadata || {},
      }));
      res.json(sanitized);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao listar integrações.' });
    }
  });

  app.get('/api/integrations/google/auth-url', (req, res) => {
    try {
      const clientId = (req.query.clientId as string || process.env.GOOGLE_CLIENT_ID || '').trim();
      const redirectUri = (req.query.redirectUri as string || `${req.protocol}://${req.get('host')}/api/integrations/google/callback`).trim();

      if (!clientId) {
        res.status(400).json({ error: 'Client ID do Google não configurado. Informe o Client ID nas configurações de Integrações.' });
        return;
      }

      const scopes = [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ].join(' ');

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
      });

      const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.json({ url, redirectUri });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao gerar URL de autorização Google.' });
    }
  });

  app.post('/api/integrations/google/callback', async (req, res) => {
    try {
      const { code, clientId, clientSecret, redirectUri } = req.body;
      const cId = (clientId || process.env.GOOGLE_CLIENT_ID || '').trim();
      const cSecret = (clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();
      const rUri = (redirectUri || `${req.protocol}://${req.get('host')}/api/integrations/google/callback`).trim();

      if (!code) {
        res.status(400).json({ error: 'Código de autorização (code) ausente.' });
        return;
      }
      if (!cId || !cSecret) {
        res.status(400).json({ error: 'Google Client ID e Client Secret são necessários para concluir a autenticação.' });
        return;
      }

      // Troca code por access_token e refresh_token
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cId,
          client_secret: cSecret,
          redirect_uri: rUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      const tokens = await tokenResp.json();
      if (!tokenResp.ok || tokens.error) {
        res.status(400).json({ error: tokens.error_description || tokens.error || 'Falha ao trocar código por token no Google.' });
        return;
      }

      // Busca dados do usuário (email da conta conectada)
      let accountEmail = '';
      try {
        const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userinfoResp.ok) {
          const userinfo = await userinfoResp.json();
          accountEmail = userinfo.email || '';
        }
      } catch {
        // Fallback silencioso
      }

      const integrationId = 'google_calendar_primary';
      const saved = standaloneStore.saveIntegration({
        id: integrationId,
        provider: 'google_calendar',
        name: accountEmail ? `Google Calendar (${accountEmail})` : 'Google Calendar',
        status: 'connected',
        accountEmail,
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credentials: {
          client_id: cId,
          client_secret: cSecret,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        },
      });

      res.json({
        ok: true,
        message: 'Google Calendar conectado com sucesso!',
        integration: {
          id: saved.id,
          name: saved.name,
          accountEmail: saved.accountEmail,
          status: saved.status,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Erro no callback do Google Calendar');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha na autenticação com o Google.' });
    }
  });

  // Conexão direta / manual (com credentials JSON ou tokens)
  app.post('/api/integrations/google/connect', async (req, res) => {
    try {
      const { clientId, clientSecret, refreshToken, accessToken, accountEmail } = req.body;
      if (!refreshToken && !accessToken) {
        res.status(400).json({ error: 'Informe ao menos um Refresh Token ou Access Token válido.' });
        return;
      }

      const integrationId = 'google_calendar_primary';
      const saved = standaloneStore.saveIntegration({
        id: integrationId,
        provider: 'google_calendar',
        name: accountEmail ? `Google Calendar (${accountEmail})` : 'Google Calendar',
        status: 'connected',
        accountEmail: accountEmail || 'Conta Google Conectada',
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credentials: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          access_token: accessToken,
        },
      });

      res.json({ ok: true, integration: saved });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao salvar integração.' });
    }
  });

  app.delete('/api/integrations/:id', (req, res) => {
    try {
      const success = standaloneStore.deleteIntegration(req.params.id);
      res.json({ ok: success });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao desconectar integração.' });
    }
  });

  app.get('/api/integrations/google/calendars', async (_req, res) => {
    try {
      const integration = standaloneStore.getIntegrationByProvider('google_calendar');
      if (!integration || integration.status !== 'connected' || !integration.credentials) {
        res.status(404).json({ error: 'Nenhuma conexão ativa com o Google Calendar encontrada.' });
        return;
      }

      const client = new GoogleCalendarClient(globalThis.fetch, integration.credentials);
      const calendars = await client.listCalendarList();
      res.json(calendars);
    } catch (err) {
      logger.error({ err }, 'Falha ao listar calendários do Google');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao listar calendários da conta conectada.' });
    }
  });

  // --- INSTANCE WEBHOOK WITH STRICT TEST MODE PROTECTION ---
  const processStandaloneEvents = async (
    instanceName: string,
    events: Array<NonNullable<ReturnType<typeof parseEvolutionWebhook>>>,
    options: {
      bypassQueue?: boolean;
      messagesAlreadySaved?: boolean;
      isCurrent?: () => Promise<boolean>;
      flowSnapshot?: StoredFlow;
    } = {},
  ): Promise<{ status: string; [key: string]: unknown }> => {
    try {
      const event = events[events.length - 1];
      if (!event) {
        return { status: 'ignored_non_message' };
      }
      if (event.fromMe) {
        // Cross-instance routing: if sent TO another connected instance,
        // re-process as inbound on that instance
        if (config.supabaseUrl && config.serviceRoleKey && event.textContent) {
          const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
          const { data: otherConns } = await db
            .from('connections')
            .select('provider_instance_id, phone')
            .eq('provider', 'evolution')
            .neq('provider_instance_id', instanceName)
            .not('phone', 'is', null);

          const destPhone = event.phone;
          const target = otherConns?.find(c => c.phone && c.provider_instance_id && isPhoneNumberMatch(destPhone, c.phone));

          if (target?.provider_instance_id) {
            const { data: thisConn } = await db
              .from('connections')
              .select('phone')
              .eq('provider_instance_id', instanceName)
              .eq('provider', 'evolution')
              .maybeSingle();

            if (thisConn?.phone) {
              const routedEvent = { ...event, fromMe: false, phone: thisConn.phone.replace(/\D/g, '') };
              logger.info({ from: instanceName, to: target.provider_instance_id, sender: routedEvent.phone }, 'Cross-instance routing: re-routing fromMe as inbound');
              return processStandaloneEvents(target.provider_instance_id, [routedEvent]);
            }
          }
        }
        return { status: 'ignored_from_me' };
      }
      if (!event.textContent && !event.mediaUrl) {
        return { status: 'ignored_empty_message' };
      }

      // 1. Persist to Supabase FIRST (before flow check) so inbox always has the message
      let organizationId = 'standalone-org';
      let connectionId: string = instanceName;
      let leadId = `lead_${event.phone.replace(/\D/g, '')}`;
      let conversationId = `conv_${event.phone.replace(/\D/g, '')}`;
      let convRepo: ConversationRepository | null = null;
      let leadRecord: { id: string; phone: string; name: string | null; memory: Record<string, unknown> } | null = null;
      let convRecord: { id: string; stage: string; bot_paused: boolean; handled_by: string } | null = null;

      if (config.supabaseUrl && config.serviceRoleKey) {
        try {
          const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
          convRepo = new ConversationRepository(db);

          // Find connection by provider_instance_id
          const { data: existingConn } = await db
            .from('connections')
            .select('id, organization_id')
            .eq('provider_instance_id', instanceName)
            .eq('provider', 'evolution')
            .maybeSingle();

          let dbConnectionId: string | null = null;

          if (existingConn) {
            organizationId = existingConn.organization_id;
            dbConnectionId = existingConn.id;
          } else {
            // Find first organization and auto-create connection
            const { data: org } = await db
              .from('organizations')
              .select('id')
              .limit(1)
              .maybeSingle();

            let orgId: string | null = org?.id ?? null;

            // Auto-create default org if none exists
            if (!orgId) {
              const { data: newOrg, error: orgErr } = await db
                .from('organizations')
                .insert({ name: 'SDR Flow' })
                .select('id')
                .single();
              if (newOrg) {
                orgId = newOrg.id;
                logger.info({ orgId: newOrg.id }, 'Organização padrão auto-criada no Supabase');
              } else {
                logger.error({ err: orgErr }, 'Falha ao auto-criar organização no Supabase');
              }
            }

            if (orgId) {
              organizationId = orgId;
              const { data: newConn, error: connErr } = await db
                .from('connections')
                .insert({
                  organization_id: orgId,
                  name: instanceName,
                  provider: 'evolution',
                  status: 'connected',
                  provider_instance_id: instanceName,
                })
                .select()
                .single();

              if (newConn) {
                dbConnectionId = newConn.id;
                logger.info({ instanceName, connectionId: newConn.id, orgId }, 'Conexão auto-criada no Supabase para instância standalone');
              } else {
                logger.error({ instanceName, err: connErr }, 'Falha ao auto-criar conexão no Supabase');
              }
            }
          }

          if (dbConnectionId) {
            connectionId = dbConnectionId;
            const lead = await convRepo.findOrCreateLead(organizationId, event.phone, event.senderName);
            leadId = lead.id;
            leadRecord = { id: lead.id, phone: lead.phone, name: lead.name, memory: (lead.memory as Record<string, unknown>) || {} };
            const conversation = await convRepo.findOrCreateConversation(organizationId, dbConnectionId, lead.id);
            conversationId = conversation.id;
            convRecord = { id: conversation.id, stage: conversation.stage, bot_paused: conversation.bot_paused, handled_by: conversation.handled_by };

            // Save each provider event before acknowledging the webhook. Buffered
            // execution reuses these rows instead of inserting duplicates.
            if (!options.messagesAlreadySaved) {
              for (const incoming of events) {
                await convRepo.saveMessage({
                  organizationId,
                  connectionId: dbConnectionId,
                  conversationId: conversation.id,
                  direction: 'INBOUND',
                  sender: 'lead',
                  content: incoming.textContent,
                  messageType: incoming.messageType,
                  providerMessageId: incoming.messageId,
                });
              }
            }
            logger.info({ instanceName, phone: event.phone, conversationId: conversation.id }, 'Mensagem inbound salva no Supabase');
          }
        } catch (dbErr: any) {
          logger.error({ err: dbErr?.message || dbErr, instanceName, phone: event.phone }, 'Falha ao persistir mensagem no Supabase');
          convRepo = null;
        }
      } else {
        logger.warn({ instanceName }, 'Supabase não configurado — mensagens não serão salvas no inbox');
      }

      // 2. Check for active flow
      const activeFlow = options.flowSnapshot || standaloneStore.getActiveFlowForInstance(instanceName);
      if (!activeFlow) {
        conversationDebugRegistry.failArmed(organizationId, conversationId, {
          severity: 'error',
          code: 'no_active_flow',
          message: `A mensagem chegou, mas não há fluxo ativo para a instância "${instanceName}".`,
        });
        logger.info({ instanceName }, 'Mensagem salva no inbox mas não há fluxo ativo para esta instância');
        return { status: 'no_active_flow', instanceName, messageSaved: !!convRepo };
      }

      // 3. STRICT TEST MODE GATE
      const testMode = activeFlow.graph.testMode;
      if (testMode?.enabled) {
        const authorized = testMode.phone || '';
        const match = isPhoneNumberMatch(event.phone, authorized);
        if (!match) {
          conversationDebugRegistry.failArmed(organizationId, conversationId, {
            severity: 'error',
            code: 'blocked_by_test_mode',
            message: `A mensagem foi bloqueada pelo modo teste, autorizado apenas para ${authorized}.`,
          });
          logger.warn(
            { sender: event.phone, authorized, instanceName },
            '[MODO TESTE BLOQUEIO] Mensagem de número não autorizado descartada com segurança total.'
          );
          return {
            status: 'blocked_by_test_mode',
            reason: `Modo Teste ativado apenas para ${authorized}. Mensagem de ${event.phone} descartada.`,
          };
        }
        logger.info(
          { sender: event.phone, authorized, instanceName },
          '[MODO TESTE PERMISSÃO] Mensagem de número autorizado aceita para execução.'
        );
      }

      const windowSeconds = bufferWindowSeconds(activeFlow.graph);
      if (turnQueue && !options.bypassQueue && windowSeconds > 0) {
        try {
          const queued = await turnQueue.enqueue({
            kind: 'standalone',
            target: instanceName,
            conversationKey: `${organizationId}:${conversationId}`,
            windowSeconds,
            event,
            metadata: { flowSnapshot: activeFlow },
          });
          return {
            status: 'queued',
            conversationId,
            generation: queued.generation,
            delayMs: queued.delayMs,
          };
        } catch (queueErr) {
          logger.warn({ err: queueErr instanceof Error ? queueErr.message : String(queueErr), instanceName, conversationId }, 'Redis indisponível — processando mensagem sem buffer');
        }
      }

      // 4. Execute Flow for Authorized Inbound Message
      const executionId = crypto.randomUUID();
      const debugFlow: DebugFlowSnapshot = {
        id: activeFlow.id,
        name: activeFlow.name,
        version: `v${activeFlow.publishedVersion || 1}`,
        nodes: activeFlow.graph.nodes.map(node => ({ id: node.id, type: node.type, label: node.label || node.type })),
        graph: activeFlow.graph,
      };
      conversationDebugRegistry.claim({ organizationId, conversationId, executionId, flow: debugFlow });
      const emitExecutionEvent = (event: Parameters<typeof wsServer.broadcast>[0]) => {
        wsServer.broadcast(conversationDebugRegistry.record({ ...event, conversationId }));
      };
      const flowCtx: FlowContext = {
        organizationId,
        connectionId,
        leadId,
        conversationId,
        executionId,
        flowVersionId: `v${activeFlow.publishedVersion || 1}`,
        lead: leadRecord
          ? { id: leadRecord.id, phone: leadRecord.phone, name: leadRecord.name || event.senderName || 'Contato WhatsApp', memory: leadRecord.memory }
          : { id: leadId, phone: event.phone, name: event.senderName || 'Contato WhatsApp', memory: {} },
        conversation: convRecord
          ? { id: convRecord.id, stage: convRecord.stage, bot_paused: convRecord.bot_paused, handled_by: convRecord.handled_by as any }
          : { id: conversationId, stage: 'NOVO', bot_paused: false, handled_by: 'AI' },
        messages: events.map((incoming, index) => ({
          id: incoming.messageId || `${executionId}-${index}`,
          text: incoming.textContent,
          fromMe: false,
          type: incoming.messageType,
          mediaUrl: incoming.mediaUrl,
        })),
        variables: {},
        tokens: { input: 0, output: 0 },
      };

      const settings = standaloneStore.getSettings();
      const evoClient = getEvoClient(settings.evolutionServerUrl, settings.evolutionApiKey);
      const effectiveApiKey = settings.openaiApiKey || config.openaiApiKey;
      const effectiveModel = settings.openaiModel || config.openaiModel || 'gpt-4.1-mini';

      const capturedConvRepo = convRepo;
      const capturedConnectionId = connectionId;
      const assertCurrentTurn = async () => {
        if (options.isCurrent && !(await options.isCurrent())) throw new Error(SUPERSEDED_TURN_ERROR);
      };
      const standaloneCalendar = createCalendarProvider(config);
      const guardedCalendar = standaloneCalendar
        ? {
            async getCalendarName(...args: Parameters<NonNullable<FlowServices['calendar']>['getCalendarName']>) { await assertCurrentTurn(); return standaloneCalendar.getCalendarName(...args); },
            async listEvents(...args: Parameters<NonNullable<FlowServices['calendar']>['listEvents']>) { await assertCurrentTurn(); return standaloneCalendar.listEvents(...args); },
            async createEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['createEvent']>) { await assertCurrentTurn(); return standaloneCalendar.createEvent(...args); },
            async updateEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['updateEvent']>) { await assertCurrentTurn(); return standaloneCalendar.updateEvent(...args); },
            async cancelEvent(...args: Parameters<NonNullable<FlowServices['calendar']>['cancelEvent']>) { await assertCurrentTurn(); return standaloneCalendar.cancelEvent(...args); },
          }
        : undefined;
      const services: FlowServices = {
        llm: effectiveApiKey
          ? new OpenAIProvider({ apiKey: effectiveApiKey, model: effectiveModel, timeoutMs: settings.openaiTimeoutMs || 60000 })
          : new MockLLMProvider(),
        messaging: {
          async sendText(_connId, phone, text) {
            await assertCurrentTurn();
            logger.info({ instanceName, phone, textLength: text.length }, 'Enviando resposta WhatsApp via Evolution API');
            const sendRes = await evoClient.sendTextMessage(instanceName, phone, text);
            const msgId = sendRes.messageId || crypto.randomUUID();
            if (capturedConvRepo) {
              try {
                await capturedConvRepo.saveMessage({
                  organizationId,
                  connectionId: capturedConnectionId,
                  conversationId,
                  direction: 'OUTBOUND',
                  sender: 'ai',
                  content: text,
                  messageType: 'text',
                  providerMessageId: msgId,
                });
              } catch (e) { logger.warn({ err: e }, 'Falha ao salvar mensagem outbound no Supabase'); }
            }
            return { messageId: msgId };
          },
          async sendMedia() { await assertCurrentTurn(); return { messageId: crypto.randomUUID() }; },
          async sendTemplate() { await assertCurrentTurn(); return { messageId: crypto.randomUUID() }; },
        },
        calendar: guardedCalendar,
        fetch: async (...args) => { await assertCurrentTurn(); return globalThis.fetch(...args); },
        db: {
          async updateLead(_org, lid, patch) {
            if (capturedConvRepo) {
              try { await capturedConvRepo.updateLead(_org, lid, patch); } catch {}
            }
          },
          async updateConversation(_org, cid, patch) {
            if (capturedConvRepo) {
              try { await capturedConvRepo.updateConversation(_org, cid, patch); } catch {}
            }
          },
          async saveMessage(_org, cId, cvId, msg) {
            if (capturedConvRepo) {
              try {
                const res = await capturedConvRepo.saveMessage({
                  organizationId: _org,
                  connectionId: cId,
                  conversationId: cvId,
                  direction: msg.direction,
                  sender: msg.sender,
                  content: msg.content,
                  messageType: msg.messageType,
                  providerMessageId: msg.providerMessageId,
                });
                return { id: res.id };
              } catch {}
            }
            return { id: crypto.randomUUID() };
          },
          async syncDeal(_org, lid, deal) {
            if (capturedConvRepo) {
              try {
                const res = await capturedConvRepo.syncDeal(_org, lid, deal);
                return { id: res.id };
              } catch {}
            }
            return { id: crypto.randomUUID() };
          },
          async getMessages(_org, convId, limit) {
            if (!capturedConvRepo) return [];
            return capturedConvRepo.getMessages(_org, convId, limit);
          },
          async searchKnowledge(_org, collection, query, limit, threshold) {
            const hits = standaloneStore.searchKnowledge(query, {
              collection: collection === 'default' ? undefined : collection,
              limit: limit || 5,
              threshold: typeof threshold === 'number' ? threshold : 0.2,
            });
            return hits.map(h => ({
              text: `[${h.collection.toUpperCase()}] ${h.title}: ${h.content}`,
              collection: h.collection,
              title: h.title,
              similarity: h.similarity,
            }));
          },
        },
        now: () => new Date(),
      };

      emitExecutionEvent({
        type: 'execution:started',
        executionId,
        organizationId,
        flowId: activeFlow.id,
        timestamp: new Date().toISOString(),
        payload: { conversationId, instanceName, sender: event.phone },
      });

      const result = await executeFlow(activeFlow.graph, flowCtx, services, {
        hooks: {
          onStepStart: async step => {
            emitExecutionEvent({
              type: 'step:start',
              executionId,
              organizationId,
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: step,
            });
          },
          onStepComplete: async step => {
            emitExecutionEvent({
              type: 'step:complete',
              executionId,
              organizationId,
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: step,
            });
          },
          onStepError: async step => {
            emitExecutionEvent({
              type: 'step:failed',
              executionId,
              organizationId,
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: step,
            });
          },
        },
      });

      const nodeLabel = (nodeId: string) =>
        activeFlow.graph.nodes.find((n: any) => n.id === nodeId)?.label || nodeId;
      const debugIssues: Array<{ severity: 'warning' | 'error'; code: string; message: string; nodeId?: string }> = [];

      if (result.status === 'failed' && result.error === SUPERSEDED_TURN_ERROR) {
        conversationDebugRegistry.supersede(executionId);
        logger.info({ instanceName, conversationId, executionId }, 'Execução substituída por mensagens mais recentes antes do envio');
        return { status: 'superseded', executionId, conversationId };
      }

      if (result.status === 'failed') {
        const failedStep = result.steps[result.steps.length - 1];
        logger.error(
          { instanceName, phone: event.phone, executionId, error: result.error, steps: result.steps },
          'Falha na execução do fluxo — mensagem não foi enviada de volta ao WhatsApp'
        );
        if (failedStep) {
          emitExecutionEvent({
            type: 'step:failed',
            executionId,
            organizationId,
            flowId: activeFlow.id,
            timestamp: new Date().toISOString(),
            payload: { sequence: failedStep.sequence, nodeId: failedStep.nodeId, error: result.error || 'Erro desconhecido' },
          });
        }
        if (convRepo) {
          try {
            await convRepo.saveMessage({
              organizationId,
              connectionId,
              conversationId,
              direction: 'OUTBOUND',
              sender: 'system',
              content: `⚠️ O fluxo falhou no bloco "${failedStep ? nodeLabel(failedStep.nodeId) : '?'}": ${result.error || 'erro desconhecido'}`,
              messageType: 'text',
            });
          } catch (e) {
            logger.warn({ err: e }, 'Falha ao salvar mensagem de erro do sistema no Supabase');
          }
        }
      } else {
        const sentSomething = result.steps.some(
          step => step.nodeType.startsWith('output.') && (step.output as any)?.sent
        );
        if (!sentSomething) {
          const lastStep = result.steps[result.steps.length - 1];
          debugIssues.push({
            severity: 'warning',
            code: 'no_message_sent',
            message: 'O fluxo terminou sem enviar uma mensagem. Verifique as portas de saída do último bloco.',
            nodeId: lastStep?.nodeId,
          });
          logger.warn(
            {
              instanceName,
              phone: event.phone,
              executionId,
              status: result.status,
              lastNode: lastStep ? { id: lastStep.nodeId, type: lastStep.nodeType, output: lastStep.output } : null,
              steps: result.steps,
            },
            'Fluxo terminou sem enviar mensagem — provável porta sem conexão (ex: guard.response_policy → rewrite/blocked)'
          );
          if (lastStep) {
            emitExecutionEvent({
              type: 'step:failed',
              executionId,
              organizationId,
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: {
                sequence: lastStep.sequence,
                nodeId: lastStep.nodeId,
                error: 'Fluxo terminou aqui sem enviar mensagem — verifique se todas as portas de saída deste bloco estão conectadas.',
              },
            });
          }
          if (convRepo) {
            try {
              await convRepo.saveMessage({
                organizationId,
                connectionId,
                conversationId,
                direction: 'OUTBOUND',
                sender: 'system',
                content: `⚠️ O fluxo terminou no bloco "${lastStep ? nodeLabel(lastStep.nodeId) : '?'}" sem enviar mensagem. Verifique se todas as saídas desse bloco estão conectadas.`,
                messageType: 'text',
              });
            } catch (e) {
              logger.warn({ err: e }, 'Falha ao salvar mensagem de erro do sistema no Supabase');
            }
          }
        }
      }

      emitExecutionEvent({
        type: 'execution:completed',
        executionId,
        organizationId,
        flowId: activeFlow.id,
        timestamp: new Date().toISOString(),
        payload: { status: result.status, steps: result.steps.length, tokens: result.tokens },
      });
      conversationDebugRegistry.finish(executionId, result, debugIssues);

      return { ok: true, executionId, status: result.status };
    } catch (err) {
      logger.error({ err }, 'Erro ao processar webhook da instância Evolution');
      return { status: 'error', error: err instanceof Error ? err.message : 'Falha no processamento do webhook' };
    }
  };

  processStandaloneBufferedTurn = turn => processStandaloneEvents(turn.target, turn.events, {
    bypassQueue: true,
    messagesAlreadySaved: true,
    isCurrent: turn.isCurrent,
    flowSnapshot: turn.metadata?.flowSnapshot as StoredFlow | undefined,
  });

  const _instancePhoneCache = new Map<string, string>();
  app.post('/api/webhooks/evolution/instance/:instanceName', async (req, res) => {
    // Lazy-sync instance phone from webhook sender field (ownerJid)
    const senderJid: string | undefined = req.body?.sender || req.body?.destination;
    const instName = req.params.instanceName;
    if (senderJid && typeof senderJid === 'string' && senderJid.includes('@') && config.supabaseUrl && config.serviceRoleKey) {
      const senderPhone = senderJid.replace(/@.*$/, '');
      if (senderPhone && _instancePhoneCache.get(instName) !== senderPhone) {
        _instancePhoneCache.set(instName, senderPhone);
        const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
        await db.from('connections').update({ phone: senderPhone }).eq('provider_instance_id', instName).eq('provider', 'evolution').then(() => {});
      }
    }

    const event = parseEvolutionWebhook(req.body);
    if (!event) {
      res.status(200).json({ status: 'ignored_non_message' });
      return;
    }
    const result = await processStandaloneEvents(instName, [event]);
    res.status(result.status === 'error' ? 500 : 200).json(result);
  });

  // Webhooks
  async function webhookCredentials(id: string, provider: 'evolution' | 'meta') {
    if (!config.supabaseUrl || !config.serviceRoleKey) return null;
    const db = serviceDatabase(config.supabaseUrl, config.serviceRoleKey);
    const { data } = await db.from('connections').select('id').eq('id', id).eq('provider', provider).maybeSingle();
    return data ? new ConnectionRepository(db).getConnectionCredentials(id) : null;
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
    const event = parseEvolutionWebhook(req.body);
    if (!event) { res.status(400).json({ error: 'Payload de webhook inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Supabase não configurado para webhooks.' }); return; }
    const credentials = await webhookCredentials(connectionId.data, 'evolution') as EvolutionCredentials | null;
    if (!secretMatches(req.get('x-webhook-token'), credentials?.webhookToken)) { res.sendStatus(401); return; }
    const result = await processInboundWebhook(connectionId.data, event, config, { turnQueue });
    const failed = result.status === 'error' || result.flowStatus === 'failed';
    res.status(failed ? 500 : 200).json({ ok: !failed, result });
  });

  app.post('/api/webhooks/meta/:connectionId', async (req, res) => {
    const connectionId = z.uuid().safeParse(req.params.connectionId);
    if (!connectionId.success) { res.status(400).json({ error: 'ID de conexão inválido.' }); return; }
    if (!config.supabaseUrl || !config.serviceRoleKey) { res.status(503).json({ error: 'Supabase não configurado para webhooks.' }); return; }
    const credentials = await webhookCredentials(connectionId.data, 'meta') as MetaCredentials | null;
    if (!verifyMetaSignature((req as typeof req & { rawBody?: Buffer }).rawBody || Buffer.alloc(0), req.get('x-hub-signature-256'), credentials?.appSecret)) { res.sendStatus(401); return; }
    const event = parseMetaWebhook(req.body);
    if (!event) { res.status(200).json({ ok: true, result: { status: 'ignored', reason: 'non_message_event' } }); return; }
    const result = await processInboundWebhook(connectionId.data, event, config, { turnQueue });
    const failed = result.status === 'error' || result.flowStatus === 'failed';
    res.status(failed ? 500 : 200).json({ ok: !failed, result });
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

  // Fallback for standalone org knowledge requests
  app.use('/api/organizations/:organizationId/knowledge', (req, res, next) => {
    const orgId = req.params.organizationId;
    if (!config.supabaseUrl || !config.anonKey || orgId === 'undefined' || orgId === 'standalone-org' || orgId === 'null') {
      knowledgeRouter(req, res, next);
      return;
    }
    next();
  });

  // Fallback for standalone org inbox requests
  app.use('/api/organizations/:organizationId/inbox', (req, res, next) => {
    const orgId = req.params.organizationId;
    const authHeader = req.get('authorization') || '';
    if (!config.supabaseUrl || !config.anonKey || orgId === 'undefined' || orgId === 'standalone-org' || orgId === 'null' || !authHeader) {
      inboxRouter(req, res, next);
      return;
    }
    next();
  });

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
      res.locals.organizationId = organizationId.data;
      res.locals.userId = `api_key:${verification.keyId}`;
      res.locals.role = verification.role;
      res.locals.scopes = verification.scopes || [];
      res.locals.authType = 'api_key';
      res.locals.db = adminDb;
      res.locals.serviceDb = adminDb;
      res.locals.flows = new FlowRepository(adminDb, organizationId.data);
      res.locals.executions = new ExecutionRepository(adminDb);
      res.locals.orgs = orgRepo;
      res.locals.connections = new ConnectionRepository(adminDb);
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
    res.locals.organizationId = organizationId.data;
    res.locals.userId = user.id;
    res.locals.role = membership.data.role;
    res.locals.scopes = ['*'];
    res.locals.authType = 'jwt';
    res.locals.db = db;
    res.locals.flows = new FlowRepository(db, organizationId.data);
    res.locals.executions = new ExecutionRepository(db);
    res.locals.orgs = new OrganizationRepository(db);
    res.locals.connections = new ConnectionRepository(db);
    res.locals.knowledge = new KnowledgeRepository(db);
    res.locals.summaries = new SummaryRepository(db);
    res.locals.inbox = new InboxRepository(db);
    res.locals.metrics = new MetricsRepository(db);
    next();
  });

  orgRoutes.use(orgRateLimiter.middleware());

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
    const validation = validateGraph(req.body);
    if (!validation.valid || !validation.graph) { res.status(422).json(validation); return; }
    if (!config.serviceRoleKey) { res.status(503).json({ error: 'Publicação requer a chave de serviço configurada no servidor.' }); return; }
    const db = serviceDatabase(config.supabaseUrl!, config.serviceRoleKey);
    const { data, error } = await db.rpc('publish_flow', { p_org: res.locals.organizationId as string, p_flow: flowId, p_actor: res.locals.userId as string, p_graph: validation.graph });
    if (error) throw error; res.status(201).json(data);
  });

  orgRoutes.get('/executions', checkScope('executions:read'), async (_req, res) => {
    const list = await (res.locals.executions as ExecutionRepository).listExecutions(res.locals.organizationId as string);
    res.json(list);
  });

  orgRoutes.get('/executions/:executionId', checkScope('executions:read'), async (req, res) => {
    const executionId = z.uuid().parse(req.params.executionId);
    const execRepo = res.locals.executions as ExecutionRepository;
    const execution = await execRepo.getExecution(executionId, res.locals.organizationId as string);
    if (!execution) { res.status(404).json({ error: 'Execução não encontrada.' }); return; }
    const steps = await execRepo.getExecutionSteps(executionId, res.locals.organizationId as string);
    res.json({ execution, steps });
  });

  orgRoutes.post('/executions/:executionId/replay', checkScope('executions:write'), async (req, res) => {
    const executionId = z.uuid().parse(req.params.executionId);
    const execRepo = res.locals.executions as ExecutionRepository;
    const execution = await execRepo.getExecution(executionId, res.locals.organizationId as string);
    if (!execution) { res.status(404).json({ error: 'Execução não encontrada.' }); return; }
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

    const result = await inboxRepo.listConversations(orgId, {
      stage,
      connectionId,
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
    res.json({ session: conversationDebugRegistry.get(orgId, convId) });
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
    res.json({ session: conversationDebugRegistry.cancel(orgId, convId) });
  });

  orgRoutes.post('/inbox/conversations/:id/takeover', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;

    const updated = await inboxRepo.takeover(orgId, convId, userId);
    res.json(updated);
  });

  orgRoutes.post('/inbox/conversations/:id/release', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;

    const updated = await inboxRepo.release(orgId, convId, userId);
    res.json(updated);
  });

  orgRoutes.post('/inbox/conversations/:id/assign', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const inboxRepo = res.locals.inbox as InboxRepository;
    const convId = z.string().uuid().parse(req.params.id);
    const userId = res.locals.userId as string;
    const body = z.object({ assignedUserId: z.string().uuid().nullable() }).parse(req.body);

    const updated = await inboxRepo.assign(orgId, convId, body.assignedUserId, userId);
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
    res.json(updated);
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
    res.status(201).json(msg);
  });

  // --- METRICS & EXPORT ROUTES ---
  orgRoutes.get('/metrics/dashboard', async (req, res) => {
    const orgId = res.locals.organizationId as string;
    const metricsRepo = res.locals.metrics as MetricsRepository;
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;

    const data = await metricsRepo.getDashboardMetrics(orgId, { startDate, endDate });
    res.json(data);
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
    const result = await AlertMonitor.evaluateAlerts(db, orgId);
    res.json(result);
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

  // Sync Evolution instance phones on startup
  if (config.supabaseUrl && config.serviceRoleKey) {
    (async () => {
      try {
        const client = getEvoClient();
        const instances = await client.fetchInstances();
        const db = serviceDatabase(config.supabaseUrl!, config.serviceRoleKey!);
        for (const inst of instances) {
          const name = inst.instance?.instanceName || inst.name || inst.instanceName;
          const ownerJid: string | undefined = inst.instance?.ownerJid || inst.ownerJid;
          if (!name || !ownerJid) continue;
          const phone = ownerJid.replace(/@.*$/, '');
          if (!phone) continue;
          await db
            .from('connections')
            .update({ phone })
            .eq('provider_instance_id', name)
            .eq('provider', 'evolution');
        }
        logger.info('Evolution instance phones synced from ownerJid');
      } catch (err) {
        logger.warn({ err }, 'Failed to sync Evolution instance phones on startup');
      }
    })();
  }

  return app;
}
