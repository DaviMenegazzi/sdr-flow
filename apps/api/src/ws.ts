import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { FlowExecutionEvent, RealtimeEventV1 } from '@sdr/shared';
import pino from 'pino';

const logger = pino({ name: 'api:ws' });

// Fase 5 (11.2): two independent subscription channels share this one socket type.
// - 'debug' (the pre-existing, default channel): per-conversation/execution/flow scoping,
//   delivers only FlowExecutionEvent frames — unchanged behavior.
// - 'inbox' (new): org-wide (optionally connection-scoped) subscription for the Inbox list/
//   detail views, delivers only RealtimeEventV1 frames (inbox:*, system:resync_required).
// A client never receives the other channel's event shape — see broadcast() below.
type Channel = 'debug' | 'inbox';
type BroadcastEvent = FlowExecutionEvent | RealtimeEventV1;

interface ClientSubscription {
  ws: WebSocket;
  userId?: string;
  channel: Channel;
  organizationId?: string;
  connectionId?: string;
  flowId?: string;
  executionId?: string;
  conversationId?: string;
  debugSessionId?: string;
}

export class ExecutionWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientSubscription>();

  attach(server: Server, security?: {
    authenticate(token: string): Promise<{ userId: string } | null>;
    authorize(userId: string, scope: { connectionId?: string; flowId?: string; executionId?: string; conversationId?: string; debugSessionId?: string; organizationId?: string }): Promise<{ organizationId: string } | null>;
  }) {
    const verifier = security ?? (process.env.NODE_ENV === 'test' ? {
      authenticate: async (token: string) => token ? { userId: 'test-user' } : null,
      authorize: async (_userId: string, _scope: object) => ({ organizationId: 'org-1' }),
    } : undefined);
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', async (ws, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token || !verifier) { ws.close(1008, 'authentication_required'); return; }
      const identity = await verifier.authenticate(token).catch(() => null);
      if (!identity) { ws.close(1008, 'invalid_session'); return; }
      const clientSub: ClientSubscription = { ws, userId: identity.userId, channel: 'debug' };
      this.clients.add(clientSub);

      logger.info({ clientCount: this.clients.size }, 'WebSocket client connected');

      ws.on('message', async data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'subscribe' && msg.channel === 'inbox') {
            // Org-wide (optionally connection-scoped) feed for the Inbox list/detail views
            // (11.2.1). The client-supplied organizationId is only a hint — authorize() below
            // must independently confirm active membership before it is trusted (11.2.2/11.2.3).
            const scope = {
              organizationId: typeof msg.organizationId === 'string' ? msg.organizationId : undefined,
              connectionId: typeof msg.connectionId === 'string' ? msg.connectionId : undefined,
            };
            if (!scope.organizationId) { ws.close(1008, 'organization_required'); return; }
            const authorized = await verifier.authorize(identity.userId, scope).catch(() => null);
            if (!authorized) { ws.close(1008, 'resource_not_found'); return; }
            clientSub.channel = 'inbox';
            clientSub.organizationId = authorized.organizationId;
            clientSub.connectionId = scope.connectionId;
            ws.send(JSON.stringify({ type: 'subscribed', channel: 'inbox', organizationId: authorized.organizationId, connectionId: scope.connectionId }));
            return;
          }
          if (msg.type === 'subscribe') {
            const scope = { connectionId: typeof msg.connectionId === 'string' ? msg.connectionId : undefined, flowId: typeof msg.flowId === 'string' ? msg.flowId : undefined, executionId: typeof msg.executionId === 'string' ? msg.executionId : undefined, conversationId: typeof msg.conversationId === 'string' ? msg.conversationId : undefined, debugSessionId: typeof msg.debugSessionId === 'string' ? msg.debugSessionId : undefined };
            if (!scope.connectionId && !scope.flowId && !scope.executionId && !scope.conversationId && !scope.debugSessionId) { ws.close(1008, 'scope_required'); return; }
            const authorized = await verifier.authorize(identity.userId, scope).catch(() => null);
            if (!authorized) { ws.close(1008, 'resource_not_found'); return; }
            clientSub.channel = 'debug';
            clientSub.organizationId = authorized.organizationId;
            clientSub.connectionId = scope.connectionId;
            clientSub.flowId = scope.flowId;
            if (msg.flowId) clientSub.flowId = msg.flowId;
            if (msg.executionId) clientSub.executionId = msg.executionId;
            if (msg.conversationId) clientSub.conversationId = msg.conversationId;
            if (msg.debugSessionId) clientSub.debugSessionId = msg.debugSessionId;
            ws.send(JSON.stringify({ type: 'subscribed', ...scope }));
          }
        } catch {
          // ignore malformed JSON messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientSub);
        logger.info({ clientCount: this.clients.size }, 'WebSocket client disconnected');
      });

      ws.on('error', err => {
        logger.error({ error: err.message }, 'WebSocket client error');
      });

      ws.send(JSON.stringify({ type: 'connected', authenticated: true }));
    });

    return this;
  }

  broadcast(event: BroadcastEvent) {
    if (!this.wss) return;
    // RealtimeEventV1 is the only shape carrying schemaVersion — FlowExecutionEvent never does.
    const isRealtime = 'schemaVersion' in event;
    const payload = JSON.stringify(event);

    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      if (isRealtime) {
        // Only clients on the 'inbox' channel asked for these — never mix them into the
        // per-execution debug stream, and never let a debug client see another org's inbox.
        if (client.channel !== 'inbox') continue;
        if (client.organizationId !== event.organizationId) continue;
        if (client.connectionId && event.connectionId && client.connectionId !== event.connectionId) continue;
        client.ws.send(payload);
        continue;
      }

      // FlowExecutionEvent branch below is unchanged from before Fase 5 — 'inbox' clients
      // never subscribed to a conversation/execution/flow scope, so they are excluded here too.
      if (client.channel === 'inbox') continue;

      // Never stream execution payloads until the client has selected a scope.
      if (!client.organizationId && !client.flowId && !client.executionId && !client.conversationId && !client.debugSessionId) {
        continue;
      }

      // Filter by organization if subscription has it
      if (client.organizationId && client.organizationId !== event.organizationId) {
        continue;
      }
      // Filter by execution if subscription has it
      if (client.executionId && client.executionId !== event.executionId) {
        continue;
      }
      // Filter by inbox conversation when a per-conversation debugger is open
      if (client.conversationId && client.conversationId !== event.conversationId) {
        continue;
      }
      if (client.debugSessionId && client.debugSessionId !== event.debugSessionId) {
        continue;
      }
      // Filter by flowId if subscription has it
      if (client.flowId && event.flowId && client.flowId !== event.flowId) {
        continue;
      }

      client.ws.send(payload);
    }
  }

  close() {
    for (const client of this.clients) {
      client.ws.terminate();
    }
    this.clients.clear();
    this.wss?.close();
  }
}

export const wsServer = new ExecutionWebSocketServer();
