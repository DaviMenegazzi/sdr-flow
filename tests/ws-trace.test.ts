import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { ExecutionWebSocketServer } from '../apps/api/src/ws.js';
import type { FlowExecutionEvent } from '../packages/shared/src/index.js';

describe('WebSocket Execution Streaming', () => {
  let server: Server;
  let wsServer: ExecutionWebSocketServer;
  let port: number;

  beforeAll(async () => {
    server = createServer();
    wsServer = new ExecutionWebSocketServer();
    wsServer.attach(server);

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

  it('streams execution events to subscribed clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-jwt`);

    const messages: any[] = [];
    ws.on('message', data => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>(resolve => ws.on('open', () => resolve()));

    // Subscribe to flow
    const flowId = '00000000-0000-4000-8000-000000000001';
    ws.send(JSON.stringify({ type: 'subscribe', flowId }));

    await new Promise(r => setTimeout(r, 50));

    // Broadcast an execution step
    const event: FlowExecutionEvent = {
      type: 'step:start',
      executionId: '00000000-0000-4000-8000-000000000002',
      organizationId: '00000000-0000-4000-8000-000000000003',
      flowId,
      timestamp: new Date().toISOString(),
      payload: { sequence: 1, nodeId: 'start', nodeType: 'trigger.message_received' },
    };

    wsServer.broadcast(event);

    await new Promise(r => setTimeout(r, 50));

    const receivedStep = messages.find(m => m.type === 'step:start');
    expect(receivedStep).toBeDefined();
    expect(receivedStep.flowId).toBe(flowId);
    expect(receivedStep.payload.nodeId).toBe('start');

    ws.close();
  });

  it('isolates inbox debug events by conversation', async () => {
    const first = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const second = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const firstMessages: any[] = [];
    const secondMessages: any[] = [];
    first.on('message', data => firstMessages.push(JSON.parse(data.toString())));
    second.on('message', data => secondMessages.push(JSON.parse(data.toString())));
    await Promise.all([
      new Promise<void>(resolve => first.on('open', resolve)),
      new Promise<void>(resolve => second.on('open', resolve)),
    ]);

    first.send(JSON.stringify({ type: 'subscribe', conversationId: 'conv-a' }));
    second.send(JSON.stringify({ type: 'subscribe', conversationId: 'conv-b' }));
    await new Promise(resolve => setTimeout(resolve, 30));

    wsServer.broadcast({
      type: 'execution:started',
      executionId: 'exec-a',
      organizationId: 'org-1',
      conversationId: 'conv-a',
      debugSessionId: 'debug-a',
      timestamp: new Date().toISOString(),
    });
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(firstMessages.some(message => message.debugSessionId === 'debug-a')).toBe(true);
    expect(secondMessages.some(message => message.debugSessionId === 'debug-a')).toBe(false);
    first.close();
    second.close();
  });
});
