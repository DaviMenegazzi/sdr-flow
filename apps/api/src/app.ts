import express, { type ErrorRequestHandler, type Express } from 'express';
import { z } from 'zod';
import {
  FlowRepository,
  ExecutionRepository,
  OrganizationRepository,
  ConnectionRepository,
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
import { catalog, validateGraph, replayFlow, runPlayground, executeFlow, MockLLMProvider, type FlowServices } from '@sdr/flow';
import { parseEvolutionWebhook, parseMetaWebhook, processInboundWebhook } from './webhook.js';
import { ConnectionManager } from './whatsapp/connection-manager.js';
import { EvolutionClient } from './whatsapp/evolution-client.js';
import { requestLogger, logger } from './telemetry/logger.js';
import { SentryService } from './telemetry/sentry.js';
import { orgRateLimiter, publicRateLimiter } from './rate-limit.js';
import { AlertMonitor } from './alerts/alert-monitor.js';
import { OpenAIProvider, type RuntimeConfig } from '@sdr/flow/server';
import { secretMatches, verifyMetaSignature } from './whatsapp/webhook-auth.js';
import { standaloneStore } from './storage.js';
import { wsServer } from './ws.js';

export interface ApiConfig extends RuntimeConfig {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  publicApiUrl?: string;
  evolutionServerUrl?: string;
  evolutionApiKey?: string;
}
export function createApp(config: ApiConfig = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb', verify: (req, _res, body) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(body); } }));
  app.use(requestLogger);
  app.get('/api/health', (_req, res) => {
    const memory = process.memoryUsage();
    res.json({
      status: 'ok',
      service: 'api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      persistenceConfigured: Boolean(config.supabaseUrl && config.anonKey),
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      },
    });
  });
  app.get('/api/catalog', (_req,res) => res.json(Object.values(catalog).map(({ schema: _schema, ...node }) => node)));
  app.post('/api/flows/validate', (req,res) => {
    const input = req.body && typeof req.body === 'object' && 'graph' in req.body ? req.body.graph : req.body;
    const result = validateGraph(input);
    res.status(result.valid ? 200 : 422).json(result);
  });

  // Direct WhatsApp & Evolution Endpoints (Standalone Mode)
  const getEvoClient = (serverUrl?: string, apiKey?: string) => {
    const url = serverUrl?.trim() || config.evolutionServerUrl || process.env.EVOLUTION_SERVER_URL || 'http://127.0.0.1:8080';
    const key = apiKey?.trim() || config.evolutionApiKey || process.env.EVOLUTION_API_KEY || 'EvolutionApiSecretKey_2026';
    return new EvolutionClient(url, key);
  };

  app.get('/api/connections/instances', async (req, res) => {
    try {
      const client = getEvoClient(req.query.serverUrl as string, req.query.apiKey as string);
      const instances = await client.fetchInstances();
      const mapped = instances.map((inst: any) => ({
        id: inst.id || inst.name,
        name: inst.name,
        provider: 'evolution' as const,
        status: inst.connectionStatus === 'open' ? 'connected' : inst.connectionStatus === 'connecting' ? 'connecting' : 'disconnected',
        phone: inst.number || (inst.ownerJid ? inst.ownerJid.replace(/@.*$/, '') : null),
        provider_instance_id: inst.name,
        created_at: inst.createdAt || new Date().toISOString(),
        profileName: inst.profileName,
        profilePicUrl: inst.profilePicUrl,
      }));
      res.json(mapped);
    } catch (err) {
      logger.error({ err }, 'Falha ao buscar instâncias da Evolution API');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao comunicar com Evolution API.' });
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
            async searchKnowledge() { return []; },
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

  // --- INSTANCE WEBHOOK WITH STRICT TEST MODE PROTECTION ---
  app.post('/api/webhooks/evolution/instance/:instanceName', async (req, res) => {
    try {
      const instanceName = req.params.instanceName;
      const event = parseEvolutionWebhook(req.body);
      if (!event) {
        res.status(200).json({ status: 'ignored_non_message' });
        return;
      }
      if (event.fromMe) {
        res.status(200).json({ status: 'ignored_from_me' });
        return;
      }
      if (!event.textContent && !event.mediaUrl) {
        res.status(200).json({ status: 'ignored_empty_message' });
        return;
      }

      const activeFlow = standaloneStore.getActiveFlowForInstance(instanceName);
      if (!activeFlow) {
        logger.info({ instanceName }, 'Mensagem recebida mas não há fluxo ativo para esta instância');
        res.status(200).json({ status: 'no_active_flow', instanceName });
        return;
      }

      // STRICT TEST MODE GATE
      const testMode = activeFlow.graph.testMode;
      if (testMode?.enabled) {
        const authorized = testMode.phone || '';
        const match = isPhoneNumberMatch(event.phone, authorized);
        if (!match) {
          logger.warn(
            { sender: event.phone, authorized, instanceName },
            '[MODO TESTE BLOQUEIO] Mensagem de número não autorizado descartada com segurança total.'
          );
          res.status(200).json({
            status: 'blocked_by_test_mode',
            reason: `Modo Teste ativado apenas para ${authorized}. Mensagem de ${event.phone} descartada.`,
          });
          return;
        }
        logger.info(
          { sender: event.phone, authorized, instanceName },
          '[MODO TESTE PERMISSÃO] Mensagem de número autorizado aceita para execução.'
        );
      }

      // Execute Flow for Authorized Inbound Message
      const executionId = crypto.randomUUID();
      const conversationId = `conv_${event.phone.replace(/\D/g, '')}`;
      const flowCtx: FlowContext = {
        organizationId: 'standalone-org',
        connectionId: instanceName,
        leadId: `lead_${event.phone.replace(/\D/g, '')}`,
        conversationId,
        executionId,
        flowVersionId: `v${activeFlow.publishedVersion || 1}`,
        lead: {
          id: `lead_${event.phone.replace(/\D/g, '')}`,
          phone: event.phone,
          name: event.senderName || 'Contato WhatsApp',
          memory: {},
        },
        conversation: {
          id: conversationId,
          stage: 'NOVO',
          bot_paused: false,
          handled_by: 'AI',
        },
        messages: [
          {
            id: event.messageId || executionId,
            text: event.textContent,
            fromMe: false,
            type: event.messageType,
            mediaUrl: event.mediaUrl,
          },
        ],
        variables: {},
        tokens: { input: 0, output: 0 },
      };

      const settings = standaloneStore.getSettings();
      const evoClient = getEvoClient(settings.evolutionServerUrl, settings.evolutionApiKey);
      const effectiveApiKey = settings.openaiApiKey || config.openaiApiKey;
      const effectiveModel = settings.openaiModel || config.openaiModel || 'gpt-4.1-mini';

      const services: FlowServices = {
        llm: effectiveApiKey
          ? new OpenAIProvider({ apiKey: effectiveApiKey, model: effectiveModel, timeoutMs: settings.openaiTimeoutMs || 60000 })
          : new MockLLMProvider(),
        messaging: {
          async sendText(_connId, phone, text) {
            logger.info({ instanceName, phone, textLength: text.length }, 'Enviando resposta WhatsApp via Evolution API');
            const sendRes = await evoClient.sendTextMessage(instanceName, phone, text);
            return { messageId: sendRes.messageId || crypto.randomUUID() };
          },
          async sendMedia() { return { messageId: crypto.randomUUID() }; },
          async sendTemplate() { return { messageId: crypto.randomUUID() }; },
        },
        db: {
          async updateLead() {},
          async updateConversation() {},
          async saveMessage() { return { id: crypto.randomUUID() }; },
          async syncDeal() { return { id: crypto.randomUUID() }; },
        },
        now: () => new Date(),
      };

      wsServer.broadcast({
        type: 'execution:started',
        executionId,
        organizationId: 'standalone-org',
        flowId: activeFlow.id,
        timestamp: new Date().toISOString(),
        payload: { conversationId, instanceName, sender: event.phone },
      });

      const result = await executeFlow(activeFlow.graph, flowCtx, services, {
        hooks: {
          onStepStart: async step => {
            wsServer.broadcast({
              type: 'step:start',
              executionId,
              organizationId: 'standalone-org',
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: step,
            });
          },
          onStepComplete: async step => {
            wsServer.broadcast({
              type: 'step:complete',
              executionId,
              organizationId: 'standalone-org',
              flowId: activeFlow.id,
              timestamp: new Date().toISOString(),
              payload: step,
            });
          },
        },
      });

      res.status(200).json({ ok: true, executionId, status: result.status });
    } catch (err) {
      logger.error({ err }, 'Erro ao processar webhook da instância Evolution');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Falha no processamento do webhook' });
    }
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
    const result = await processInboundWebhook(connectionId.data, event, config);
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
    const result = await processInboundWebhook(connectionId.data, event, config);
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
            const hits = await knowledgeRepo.search(orgId, queryEmb, { collection, limit, threshold });
            return hits.map(h => `[${h.collection.toUpperCase()}] ${h.title}: ${h.content}`);
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
  return app;
}
