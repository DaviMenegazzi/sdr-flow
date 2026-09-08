import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { FlowExecutionEvent } from '@sdr/shared';
import pino from 'pino';

const logger = pino({ name: 'api:ws' });

interface ClientSubscription {
  ws: WebSocket;
  organizationId?: string;
  flowId?: string;
  executionId?: string;
}

export class ExecutionWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientSubscription>();

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      const clientSub: ClientSubscription = { ws };
      this.clients.add(clientSub);

      logger.info({ clientCount: this.clients.size }, 'WebSocket client connected');

      ws.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'subscribe') {
            if (msg.organizationId) clientSub.organizationId = msg.organizationId;
            if (msg.flowId) clientSub.flowId = msg.flowId;
            if (msg.executionId) clientSub.executionId = msg.executionId;
            ws.send(JSON.stringify({ type: 'subscribed', ...msg }));
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

      ws.send(JSON.stringify({ type: 'connected', authenticated: Boolean(token) }));
    });

    return this;
  }

  broadcast(event: FlowExecutionEvent) {
    if (!this.wss) return;
    const payload = JSON.stringify(event);

    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      // Filter by organization if subscription has it
      if (client.organizationId && client.organizationId !== event.organizationId) {
        continue;
      }
      // Filter by execution if subscription has it
      if (client.executionId && client.executionId !== event.executionId) {
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
