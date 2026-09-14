import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { ExecutionWebSocketServer } from '../apps/api/src/ws.js';
import type { FlowExecutionEvent, RealtimeEventV1 } from '../packages/shared/src/index.js';

// Fase 5 (11.2/11.6.3): the 'inbox' channel is org-scoped and must never leak into, or receive
// from, the pre-existing per-conversation 'debug' channel used by the agent debugger.
describe('WebSocket Inbox Channel', () => {
  let server: Server;
  let wsServer: ExecutionWebSocketServer;
  let port: number;

  // Simulates organization_members: user-a belongs to org-1 only.
  const membership: Record<string, string[]> = { 'user-a': ['org-1'] };

  beforeAll(async () => {
    server = createServer();
    wsServer = new ExecutionWebSocketServer();
    wsServer.attach(server, {
      authenticate: async token => (token === 'test-jwt' ? { userId: 'user-a' } : null),
      authorize: async (userId, scope) => {
        if (scope.organizationId) {
          return membership[userId]?.includes(scope.organizationId) ? { organizationId: scope.organizationId } : null;
        }
        return { organizationId: 'org-1' };
      },
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 3001;
        resolve();
      });
    });
  });

  afterAll(async () => {
    wsServer.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  function connect(): Promise<WebSocket> {
    return new Promise(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-jwt`);
      ws.on('open', () => resolve(ws));
    });
  }

  it('delivers inbox:* events only to clients subscribed on the matching organization', async () => {
    const ws = await connect();
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-1' }));
    await new Promise(r => setTimeout(r, 30));
    expect(messages.some(m => m.type === 'subscribed' && m.channel === 'inbox')).toBe(true);

    const event: RealtimeEventV1 = {
      schemaVersion: 1,
      type: 'inbox:message.created',
      eventId: '00000000-0000-4000-8000-000000000010',
      organizationId: 'org-1',
      conversationId: '00000000-0000-4000-8000-000000000011',
      occurredAt: new Date().toISOString(),
      payload: { content: 'oi' },
    };
    wsServer.broadcast(event);
    await new Promise(r => setTimeout(r, 30));

    expect(messages.some(m => m.type === 'inbox:message.created')).toBe(true);
    ws.close();
  });

  it('rejects an inbox subscription for an organization the user is not a member of', async () => {
    const ws = await connect();
    const closeCode = new Promise<number>(resolve => ws.on('close', code => resolve(code)));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-2' }));
    expect(await closeCode).toBe(1008);
  });

  it('never leaks inbox events across organizations', async () => {
    const ws = await connect();
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-1' }));
    await new Promise(r => setTimeout(r, 30));

    wsServer.broadcast({
      schemaVersion: 1,
      type: 'inbox:conversation.updated',
      eventId: '00000000-0000-4000-8000-000000000020',
      organizationId: 'org-9-other-tenant',
      occurredAt: new Date().toISOString(),
    } as RealtimeEventV1);
    await new Promise(r => setTimeout(r, 30));

    expect(messages.some(m => m.type === 'inbox:conversation.updated')).toBe(false);
    ws.close();
  });

  it('does not deliver FlowExecutionEvent frames to an inbox-channel client', async () => {
    const ws = await connect();
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-1' }));
    await new Promise(r => setTimeout(r, 30));

    const execEvent: FlowExecutionEvent = {
      type: 'step:start',
      executionId: 'exec-1',
      organizationId: 'org-1',
      timestamp: new Date().toISOString(),
    };
    wsServer.broadcast(execEvent);
    await new Promise(r => setTimeout(r, 30));

    expect(messages.some(m => m.type === 'step:start')).toBe(false);
    ws.close();
  });

  it('does not deliver inbox:* frames to a debug-channel (conversation-scoped) client', async () => {
    const ws = await connect();
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'subscribe', conversationId: 'conv-a' }));
    await new Promise(r => setTimeout(r, 30));

    wsServer.broadcast({
      schemaVersion: 1,
      type: 'inbox:message.created',
      eventId: '00000000-0000-4000-8000-000000000030',
      organizationId: 'org-1',
      conversationId: 'conv-a',
      occurredAt: new Date().toISOString(),
    } as RealtimeEventV1);
    await new Promise(r => setTimeout(r, 30));

    expect(messages.some(m => m.type === 'inbox:message.created')).toBe(false);
    ws.close();
  });

  it('scopes to a single connectionId when the client narrows the inbox subscription', async () => {
    const ws = await connect();
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-1', connectionId: 'conn-a' }));
    await new Promise(r => setTimeout(r, 30));

    wsServer.broadcast({
      schemaVersion: 1,
      type: 'inbox:conversation.updated',
      eventId: '00000000-0000-4000-8000-000000000040',
      organizationId: 'org-1',
      connectionId: 'conn-b',
      occurredAt: new Date().toISOString(),
    } as RealtimeEventV1);
    await new Promise(r => setTimeout(r, 20));
    expect(messages.some(m => m.eventId === '00000000-0000-4000-8000-000000000040')).toBe(false);

    wsServer.broadcast({
      schemaVersion: 1,
      type: 'inbox:conversation.updated',
      eventId: '00000000-0000-4000-8000-000000000041',
      organizationId: 'org-1',
      connectionId: 'conn-a',
      occurredAt: new Date().toISOString(),
    } as RealtimeEventV1);
    await new Promise(r => setTimeout(r, 20));
    expect(messages.some(m => m.eventId === '00000000-0000-4000-8000-000000000041')).toBe(true);

    ws.close();
  });
});
